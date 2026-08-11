/**
 * LYS (Lyricify Syllable), Lyricify's word-by-word format.
 * by Lyricify / WXRIW
 *
 * [4]Hel(12000,400)lo (12400,300)world(12700,600)
 */

import { ParseError } from "../../errors";
import { readTag, writeTags } from "../../internal/lyric-tags";
import { prepare } from "../../internal/projection";
import {
  foldSpacers,
  readTimedWords,
  type TimedWord,
} from "../../internal/timed-words";
import {
  checkTime,
  readOffset,
  shiftTimes,
  splitLines,
  toInt,
} from "../../internal/timestamps";
import { checkLines, checkText, checkWrite } from "../../internal/write-check";
import type {
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
  LyricsMeta,
  ReadOptions,
  Syllable,
  WriteOptions,
} from "../../types";
import { lysSideLines } from "./agents";

interface LysRow {
  agent: string | null;
  begin: number;
  end: number;
  property: number;
  words: TimedWord[];
  wrapped: boolean;
}

const lineHeader = /^\[(\d+)\](.*)$/u;
const reservedStamp = /\(\d+,\d+\)/u;
const whitespace = /^\s+$/u;
const leftAgentId = "v1";
const rightAgentId = "v2";

export const capabilities = {
  agents: "alignment",
  backing: true,
  metadata: {
    album: true,
    apple: false,
    artist: true,
    author: true,
    songwriters: true,
    title: true,
  },
  pronunciation: false,
  trackGenerated: false,
  trackKind: false,
  translation: false,
  wordTiming: true,
} satisfies FormatCapabilities;

function makeTrack(
  words: TimedWord[],
  lineId: string,
  track: "b" | "w",
  firstIndex = 0
): Syllable[] {
  return words.map((word, wordIndex) => ({
    begin: word.begin,
    end: word.end,
    id: `${lineId}${track}${firstIndex + wordIndex}`,
    text: word.text,
  }));
}

function readRow(
  raw: string,
  lineIndex: number,
  tags: Map<string, string>
): LysRow | null {
  const tag = readTag(raw);
  if (tag) {
    tags.set(tag.name, tag.text);
    return null;
  }
  const header = lineHeader.exec(raw);
  if (!header) {
    if (raw.trim().length > 0 && raw.startsWith("[")) {
      throw new ParseError(`malformed lys line ${lineIndex + 1}`);
    }
    return null;
  }
  const close = header[0].indexOf("]");
  const property = toInt(
    header[0].slice(1, close),
    `lys line ${lineIndex + 1} property`
  );
  if (property > 8) {
    throw new ParseError(`lys line ${lineIndex + 1} has an unknown property`);
  }
  const body = header[0].slice(close + 1);
  if (whitespace.test(body)) {
    throw new ParseError(`lys line ${lineIndex + 1} has no timed syllables`);
  }
  const words = foldSpacers(
    readTimedWords(body, lineIndex + 1, 0, 0),
    "lys",
    lineIndex + 1,
    (word) => word.begin === 0 && word.end === 0
  );
  if (words.length === 0) {
    throw new ParseError(`lys line ${lineIndex + 1} has no timed syllables`);
  }
  const lyric = words.map((word) => word.text).join("");
  let agent: string | null = null;
  if (property === 1 || property === 4 || property === 7) {
    agent = leftAgentId;
  } else if (property === 2 || property === 5 || property === 8) {
    agent = rightAgentId;
  }
  return {
    agent,
    begin: Math.min(...words.map((word) => word.begin)),
    end: Math.max(...words.map((word) => word.end)),
    property,
    words,
    wrapped:
      (lyric.startsWith("(") && lyric.endsWith(")")) ||
      (lyric.startsWith("（") && lyric.endsWith("）")),
  };
}

function makeLines(rows: LysRow[]): LyricsLine[] {
  const lines: LyricsLine[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const inferredBacking =
      row.property <= 2 &&
      row.wrapped &&
      !rows[rowIndex - 1]?.wrapped &&
      !rows[rowIndex + 1]?.wrapped;
    const isBacking = row.property >= 6 || inferredBacking;
    const words =
      isBacking && row.wrapped
        ? row.words.map((word, wordIndex) => ({
            ...word,
            text: word.text.slice(
              wordIndex === 0 ? 1 : 0,
              wordIndex === row.words.length - 1 ? -1 : undefined
            ),
          }))
        : row.words;
    const mainLine = lines.at(-1);
    if (isBacking && mainLine?.agent === row.agent) {
      mainLine.begin = Math.min(mainLine.begin, row.begin);
      mainLine.end = Math.max(mainLine.end, row.end);
      mainLine.b.push(...makeTrack(words, mainLine.id, "b", mainLine.b.length));
      continue;
    }

    const lineId = `l${rowIndex}`;
    lines.push({
      agent: row.agent,
      b: isBacking ? makeTrack(words, lineId, "b") : [],
      begin: row.begin,
      end: row.end,
      id: lineId,
      p: isBacking ? [] : makeTrack(words, lineId, "w"),
    });
  }
  return lines;
}

export function read(text: string, options: ReadOptions = {}): LyricsDocument {
  if (options.expandRepeats) {
    throw new Error("expandRepeats is available for lrc input");
  }
  const tags = new Map<string, string>();
  const rows: LysRow[] = [];
  for (const [lineIndex, raw] of splitLines(text).entries()) {
    const row = readRow(raw, lineIndex, tags);
    if (row) {
      rows.push(row);
    }
  }
  if (rows.length === 0) {
    throw new ParseError("input contains no recognizable lys lyric lines");
  }
  const offsetText = tags.get("offset");
  const offset = offsetText === undefined ? 0 : readOffset(offsetText, "lys");
  const lines = makeLines(rows);
  const album = tags.get("al");
  const artist = tags.get("ar");
  const author = tags.get("by");
  const songwriter = tags.get("au");
  const title = tags.get("ti");
  const agents: LyricsDocument["agents"] = [];
  const hasLeftAgent = lines.some((line) => line.agent === leftAgentId);
  const hasRightAgent = lines.some((line) => line.agent === rightAgentId);
  if (hasLeftAgent) {
    agents.push({ id: leftAgentId, type: "person" });
  }
  if (hasRightAgent) {
    agents.push({
      id: rightAgentId,
      type: hasLeftAgent ? "person" : "other",
    });
  }
  const meta: LyricsMeta = {
    ...(album !== undefined && { album }),
    ...(artist !== undefined && { artist }),
    ...(author && { author }),
    ...(songwriter !== undefined && { songwriters: [songwriter] }),
    ...(title !== undefined && { title }),
  };
  return shiftTimes(
    {
      agents,
      lines,
      meta,
      timing: "word",
      version: 1,
    },
    offset,
    "lys"
  );
}

function writeRow(property: number, syllables: Syllable[], wrap: boolean) {
  return `[${property}]${syllables
    .map((syllable, wordIndex) => {
      const duration = syllable.end - syllable.begin;
      checkTime(duration, `syllable ${syllable.id} duration`);
      const prefix = wrap && wordIndex === 0 ? "(" : "";
      const suffix = wrap && wordIndex === syllables.length - 1 ? ")" : "";
      return `${prefix}${syllable.text}${suffix}(${syllable.begin},${duration})`;
    })
    .join("")}`;
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const prepared = prepare(source, capabilities, "lys", options);
  const doc = {
    ...prepared,
    lines: prepared.lines.filter(
      (line) => line.p.length > 0 || line.b.length > 0
    ),
  };
  checkLines(doc, "lys");
  checkWrite(doc, "lys", capabilities);
  for (const line of doc.lines) {
    for (const syllable of [...line.p, ...line.b]) {
      checkText(syllable.text, "lys", reservedStamp);
    }
  }
  for (const line of doc.lines) {
    if (line.p.length === 0 && line.b.length > 0) {
      throw new Error(`lys cannot preserve backing-only line ${line.id}`);
    }
  }
  const lyricRows: string[] = [];
  for (const [line, side] of lysSideLines(doc)) {
    const syllables = [...line.p, ...line.b];
    const begin = Math.min(...syllables.map((syllable) => syllable.begin));
    const end = Math.max(...syllables.map((syllable) => syllable.end));
    if (begin !== line.begin || end !== line.end) {
      throw new Error(`lys cannot represent the range of line ${line.id}`);
    }
    if (line.p.length > 0) {
      lyricRows.push(writeRow(side + 3, line.p, false));
    }
    if (line.b.length > 0) {
      lyricRows.push(writeRow(side + 6, line.b, true));
    }
  }
  return [...writeTags(doc.meta, "lys"), ...lyricRows].join("\n");
}
