/**
 * LRC (lyrics), plain line-timed lyrics.
 * by the community; de-facto standard since the late-1990s MP3 player era
 *
 * [ti:Title]
 * [ar:Artist]
 *
 * [00:12.00]Hello world
 * [00:15.30][01:02.10]repeated chorus line
 */

import { ParseError } from "@/errors";
import { trimLineEdges } from "@/internal/edge-whitespace";
import {
  checkUnreadRow,
  projectedTagMeta,
  readTag,
  readTagMeta,
  tagProblems,
  writeTags,
} from "@/internal/lyric-tags";
import {
  findLosses,
  keepsWordTiming,
  lostIf,
  prepare,
  projectedDocument,
} from "@/internal/projections";
import {
  alreadyWrapped,
  primaryProblem,
  projectedLine,
  track,
} from "@/internal/projections/line";
import { checkWordOrder } from "@/internal/syllable-bounds";
import {
  clockStamp,
  lastLineMs,
  readClock,
  shiftTimes,
  splitLines,
  writeStamp,
} from "@/internal/timestamps";
import { checkLines, checkText, checkWrite } from "@/internal/write-check";
import type {
  ConversionLoss,
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
  ReadOptions,
  WriteOptions,
} from "@/types";

interface LrcRow {
  begin: number;
  body: string;
  order: number;
}

const lineStamp = new RegExp(String.raw`\[${clockStamp}\]`, "gy");
const wordStamp = new RegExp(`<${clockStamp}>`, "gu");
const reservedStamp = new RegExp(`<${clockStamp}>`, "u");

export const capabilities = {
  agents: false,
  backing: false,
  metadata: {
    album: true,
    artist: true,
    songwriters: true,
    title: true,
  },
  pronunciation: false,
  timing: { line: true, static: false, word: false },
  trackGenerated: false,
  trackKind: false,
  translation: false,
} satisfies FormatCapabilities;

function readWords(body: string, lineEnd: number) {
  const markers = [...body.matchAll(wordStamp)];
  const first = markers.at(0);
  if (!first) {
    return [];
  }
  if (first.index !== 0) {
    throw new ParseError("enhanced lrc text must begin with a word timestamp");
  }
  return markers.map((marker, index) => {
    const next = markers[index + 1];
    return {
      begin: readClock(marker[0]),
      end: next ? readClock(next[0]) : lineEnd,
      text: body.slice(
        marker.index + marker[0].length,
        next === undefined ? body.length : next.index
      ),
    };
  });
}

function readRows(
  text: string,
  tags: Map<string, string>,
  expandRepeats: boolean
): LrcRow[] {
  const rows: LrcRow[] = [];
  for (const [lineIndex, raw] of splitLines(text).entries()) {
    const tag = readTag(raw);
    if (tag) {
      tags.set(tag.name, tag.text);
      continue;
    }
    const stamps = [...raw.matchAll(lineStamp)];
    const last = stamps.at(-1);
    if (last === undefined) {
      checkUnreadRow(raw, "lrc", lineIndex);
      continue;
    }
    const body = raw.slice(last.index + last[0].length);
    for (const stamp of expandRepeats ? stamps : stamps.slice(0, 1)) {
      rows.push({ begin: readClock(stamp[0]), body, order: lineIndex });
    }
  }
  if (rows.length === 0) {
    throw new ParseError("input contains no recognizable lrc lyric lines");
  }
  rows.sort(
    (left, right) => left.begin - right.begin || left.order - right.order
  );
  return rows;
}

function makeLines(rows: LrcRow[]) {
  let wordTimed = false;
  const lines = rows.map((row, lineIndex) => {
    const sourceEnd = rows[lineIndex + 1]?.begin ?? row.begin + lastLineMs;
    const words = readWords(row.body, sourceEnd);
    wordTimed ||= words.length > 0;
    return {
      agent: null,
      b: [],
      begin: row.begin,
      end: sourceEnd,
      id: `l${lineIndex}`,
      p:
        words.length > 0
          ? words.map((word, wordIndex) => ({
              begin: word.begin,
              end: word.end,
              id: `l${lineIndex}w${wordIndex}`,
              text: word.text,
            }))
          : [
              {
                begin: row.begin,
                end: sourceEnd,
                id: `l${lineIndex}w0`,
                text: row.body,
              },
            ],
    };
  });
  return { lines, wordTimed };
}

export function read(text: string, options: ReadOptions = {}): LyricsDocument {
  const tags = new Map<string, string>();
  const rows = readRows(text, tags, options.expandRepeats ?? false);
  const { meta, offset } = readTagMeta(tags, "lrc");
  const { lines, wordTimed } = makeLines(rows);
  checkWordOrder(lines, "lrc");
  return shiftTimes(
    {
      agents: [],
      lines: lines.map(trimLineEdges),
      meta,
      timing: wordTimed ? "word" : "line",
      version: 1,
    },
    offset,
    "lrc"
  );
}

// lrc infers each line end from the next line start, so any other end is rewritten
function lineProblem(lines: LyricsLine[], line: LyricsLine, lineIndex: number) {
  if (line.end !== (lines[lineIndex + 1]?.begin ?? line.begin + lastLineMs)) {
    return `the end time of line ${line.id}`;
  }
  return primaryProblem(line);
}

function lineLosses(doc: LyricsDocument): ConversionLoss[] {
  return lostIf(
    "lineRange",
    doc.lines.some((line, lineIndex) => {
      const earlier = doc.lines[lineIndex - 1];
      return (
        (earlier !== undefined && line.begin <= earlier.begin) ||
        lineProblem(doc.lines, line, lineIndex) !== undefined
      );
    })
  );
}

export function losses(doc: LyricsDocument): ConversionLoss[] {
  return findLosses(doc, capabilities, (lyric) => [
    ...tagProblems(lyric.meta, "lrc").map((problem) => problem.loss),
    ...lineLosses(lyric),
  ]);
}

function foldedText(line: LyricsLine, primary: string) {
  const backing = line.b
    .map((syllable) => syllable.text)
    .join("")
    .trim();
  if (backing.length === 0) {
    return primary;
  }
  const wrapped = alreadyWrapped(backing) ? backing : `(${backing})`;
  return primary.trim().length === 0
    ? wrapped
    : `${primary.trimEnd()} ${wrapped}`;
}

function project(doc: LyricsDocument): LyricsDocument {
  const wordTimed = keepsWordTiming(doc, capabilities);
  const ordered = doc.lines
    .map((line, order) => ({ line, order }))
    .sort(
      (left, right) =>
        left.line.begin - right.line.begin || left.order - right.order
    );
  const lines = ordered.map(({ line }, lineIndex) => {
    const { begin } = line;
    const end = ordered[lineIndex + 1]?.line.begin ?? begin + lastLineMs;
    const [primary] = track(line.p, { ...line, begin, end });
    return {
      ...projectedLine(line, capabilities, wordTimed),
      begin,
      end,
      p: [
        {
          begin,
          end,
          id: primary?.id ?? `${line.id}w0`,
          text: foldedText(line, primary?.text ?? ""),
        },
      ],
    };
  });
  return projectedDocument(
    doc,
    capabilities,
    lines,
    projectedTagMeta(doc.meta)
  );
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const doc = prepare(source, options, "lrc", losses, project);
  checkLines(doc, "lrc");
  checkWrite(doc, "lrc", capabilities);
  for (const [lineIndex, line] of doc.lines.entries()) {
    const problem = lineProblem(doc.lines, line, lineIndex);
    if (problem !== undefined) {
      throw new Error(`lrc cannot represent ${problem}`);
    }
    for (const syllable of line.p) {
      checkText(syllable.text, "lrc", reservedStamp);
    }
  }
  return [
    ...writeTags(doc.meta, tagProblems(doc.meta, "lrc")),
    ...doc.lines.map(
      (line) =>
        `[${writeStamp(line.begin)}]${line.p
          .map((syllable) => syllable.text)
          .join("")}`
    ),
  ].join("\n");
}
