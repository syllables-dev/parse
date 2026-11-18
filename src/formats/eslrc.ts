/**
 * ESLRC, ESLyric's word-timed LRC flavor.
 * by ESLyric (foobar2000 lyrics component)
 *
 * [00:00.000]Hel[00:00.500]lo[00:01.000]
 */

import { ParseError } from "@/errors";
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
  prepare,
  projectedDocument,
} from "@/internal/projections";
import { projectedLines } from "@/internal/projections/line";
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
  WriteOptions,
} from "@/types";

interface EslrcMarker {
  begin: number;
  text: string;
}

interface EslrcRow {
  first: EslrcMarker;
  following: EslrcMarker[];
}

const stamp = new RegExp(String.raw`\[${clockStamp}\]`, "gu");
const reservedStamp = new RegExp(String.raw`\[${clockStamp}\]`, "u");

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
  timing: { line: false, static: false, word: true },
  trackGenerated: false,
  trackKind: false,
  translation: false,
} satisfies FormatCapabilities;

function readRows(text: string, tags: Map<string, string>): EslrcRow[] {
  const rows: EslrcRow[] = [];
  for (const [lineIndex, physicalLine] of splitLines(text).entries()) {
    const tag = readTag(physicalLine);
    if (tag) {
      tags.set(tag.name, tag.text);
      continue;
    }
    const matches = [...physicalLine.matchAll(stamp)];
    const firstAt = matches.at(0)?.index;
    const [first, ...following] = matches.map((marker, markerIndex) => {
      const next = matches[markerIndex + 1];
      return {
        begin: readClock(marker[0]),
        text: physicalLine.slice(
          marker.index + marker[0].length,
          next === undefined ? physicalLine.length : next.index
        ),
      };
    });
    if (!first) {
      checkUnreadRow(physicalLine, "eslrc", lineIndex);
      continue;
    }
    if (firstAt !== 0) {
      throw new ParseError(
        `eslrc line ${lineIndex + 1} must start with a timestamp`
      );
    }
    rows.push({ first, following });
  }
  if (rows.length === 0) {
    throw new ParseError("input contains no recognizable eslrc lyric lines");
  }
  return rows;
}

function makeLines(rows: EslrcRow[]) {
  return rows.map((row, lineIndex) => {
    const markers = [row.first, ...row.following];
    const lastMarker = row.following.at(-1);
    const explicitEnd =
      lastMarker?.text.length === 0 ? lastMarker.begin : undefined;
    const sourceEnd =
      explicitEnd ??
      rows[lineIndex + 1]?.first.begin ??
      row.first.begin + lastLineMs;
    const timedSegments = markers.flatMap((marker, markerIndex) => {
      if (marker.text.length === 0) {
        return [];
      }
      return [
        {
          begin: marker.begin,
          end: markers[markerIndex + 1]?.begin ?? sourceEnd,
          text: marker.text,
        },
      ];
    });
    const syllables =
      timedSegments.length > 0
        ? timedSegments
        : [
            {
              begin: row.first.begin,
              end: sourceEnd,
              text: "",
            },
          ];
    return {
      agent: null,
      b: [],
      begin: row.first.begin,
      end: sourceEnd,
      id: `l${lineIndex}`,
      p: syllables.map((syllable, syllableIndex) => ({
        ...syllable,
        id: `l${lineIndex}w${syllableIndex}`,
      })),
    };
  });
}

export function read(text: string): LyricsDocument {
  const tags = new Map<string, string>();
  const rows = readRows(text, tags);
  const { meta, offset } = readTagMeta(tags, "eslrc");
  return shiftTimes(
    {
      agents: [],
      lines: makeLines(rows),
      meta,
      timing: "word",
      version: 1,
    },
    offset,
    "eslrc"
  );
}

export function losses(doc: LyricsDocument): ConversionLoss[] {
  return findLosses(doc, capabilities, (lyric) =>
    tagProblems(lyric.meta, "eslrc").map((problem) => problem.loss)
  );
}

function project(doc: LyricsDocument): LyricsDocument {
  return projectedDocument(
    doc,
    capabilities,
    projectedLines(doc, capabilities, keepsWordTiming(doc, capabilities)),
    projectedTagMeta(doc.meta)
  );
}

function writeLine(line: LyricsLine) {
  const emptySyllables = line.p.filter(
    (syllable) => syllable.text.length === 0
  );
  if (
    emptySyllables.length > 0 &&
    !(
      line.p.length === 1 &&
      emptySyllables[0]?.begin === line.begin &&
      emptySyllables[0]?.end === line.end
    )
  ) {
    throw new Error(
      `eslrc cannot represent empty syllables in line ${line.id}`
    );
  }
  let currentTime = line.begin;
  let serialized = `[${writeStamp(line.begin)}]`;
  for (const syllable of line.p) {
    if (syllable.begin !== currentTime) {
      serialized += `[${writeStamp(syllable.begin)}]`;
    }
    serialized += `${syllable.text}[${writeStamp(syllable.end)}]`;
    currentTime = syllable.end;
  }
  if (currentTime !== line.end) {
    serialized += `[${writeStamp(line.end)}]`;
  }
  return serialized;
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const doc = prepare(source, options, "eslrc", losses, project);
  checkLines(doc, "eslrc");
  checkWrite(doc, "eslrc", capabilities);
  for (const line of doc.lines) {
    for (const syllable of line.p) {
      checkText(syllable.text, "eslrc", reservedStamp);
    }
  }
  return [
    ...writeTags(doc.meta, tagProblems(doc.meta, "eslrc")),
    ...doc.lines.map(writeLine),
  ].join("\n");
}
