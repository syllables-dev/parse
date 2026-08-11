/**
 * QRC, QQ Music's word-by-word lyrics format.
 * by Tencent / QQ Music
 *
 * [12000,3320]Hel(12000,400)lo (12400,300)world(12700,600)
 */

import { ParseError } from "../errors";
import { readTag, writeTags } from "../internal/lyric-tags";
import { prepare } from "../internal/projection";
import { readTimedWords, type TimedWord } from "../internal/timed-words";
import {
  checkTime,
  readOffset,
  shiftTimes,
  splitLines,
  toInt,
} from "../internal/timestamps";
import { checkLines, checkText, checkWrite } from "../internal/write-check";
import type {
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
  ReadOptions,
  Syllable,
  WriteOptions,
} from "../types";

interface QrcRow {
  begin: number;
  end: number;
  words: TimedWord[];
  wrapped: boolean;
}

interface QrcWriteRow {
  lineIndex: number;
  track: "b" | "p";
  wrapped: boolean;
}

interface QrcWriteLine {
  b: QrcWriteRow[];
  p: QrcWriteRow[];
}

const lineHeader = /^\[(\d+),(\d+)\](.*)$/u;
const reservedStamp = /\(\d+,\d+\)/u;

export const capabilities = {
  agents: false,
  backing: true,
  metadata: {
    album: true,
    artist: true,
    author: true,
    songwriters: true,
    title: true,
  },
  pronunciation: false,
  translation: false,
  wordTiming: true,
} satisfies FormatCapabilities;

function isWrapped(text: string) {
  return (
    (text.startsWith("(") && text.endsWith(")")) ||
    (text.startsWith("（") && text.endsWith("）"))
  );
}

function unwrapWords(words: TimedWord[]): TimedWord[] {
  return words.map((word, index) => ({
    ...word,
    text: word.text.slice(
      index === 0 ? 1 : 0,
      index === words.length - 1 ? -1 : undefined
    ),
  }));
}

function makeTrack(
  words: TimedWord[],
  lineId: string,
  track: "b" | "w"
): Syllable[] {
  return words.map((word, wordIndex) => ({
    begin: word.begin,
    end: word.end,
    id: `${lineId}${track}${wordIndex}`,
    text: word.text,
  }));
}

function readRow(
  raw: string,
  lineIndex: number,
  tags: Map<string, string>
): QrcRow | null {
  const tag = readTag(raw);
  if (tag) {
    tags.set(tag.name, tag.text);
    return null;
  }
  const header = lineHeader.exec(raw);
  if (!header) {
    if (raw.trim().length > 0 && raw.startsWith("[")) {
      throw new ParseError(`malformed qrc line ${lineIndex + 1}`);
    }
    return null;
  }

  const comma = header[0].indexOf(",");
  const close = header[0].indexOf("]");
  const begin = toInt(
    header[0].slice(1, comma),
    `qrc line ${lineIndex + 1} start`
  );
  const duration = toInt(
    header[0].slice(comma + 1, close),
    `qrc line ${lineIndex + 1} duration`
  );
  if (!Number.isSafeInteger(begin + duration)) {
    throw new ParseError(
      `qrc line ${lineIndex + 1} end exceeds the safe integer range`
    );
  }
  const words = readTimedWords(
    header[0].slice(close + 1),
    lineIndex + 1,
    begin,
    begin + duration
  );
  return {
    begin,
    end: begin + duration,
    words,
    wrapped: isWrapped(words.map((word) => word.text).join("")),
  };
}

function makeLines(rows: QrcRow[]): LyricsLine[] {
  const lines: LyricsLine[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const isBacking =
      row.wrapped &&
      !rows[rowIndex - 1]?.wrapped &&
      !rows[rowIndex + 1]?.wrapped;
    const mainLine = lines.at(-1);
    if (isBacking && mainLine) {
      mainLine.begin = Math.min(mainLine.begin, row.begin);
      mainLine.end = Math.max(mainLine.end, row.end);
      mainLine.b.push(...makeTrack(unwrapWords(row.words), mainLine.id, "b"));
      continue;
    }

    const lineId = `l${rowIndex}`;
    lines.push({
      agent: null,
      b: isBacking ? makeTrack(unwrapWords(row.words), lineId, "b") : [],
      begin: row.begin,
      end: row.end,
      id: lineId,
      p: isBacking ? [] : makeTrack(row.words, lineId, "w"),
    });
  }
  return lines;
}

export function read(text: string, options: ReadOptions = {}): LyricsDocument {
  if (options.expandRepeats) {
    throw new Error("expandRepeats is available for lrc input");
  }
  const tags = new Map<string, string>();
  const rows: QrcRow[] = [];
  for (const [lineIndex, raw] of splitLines(text).entries()) {
    const row = readRow(raw, lineIndex, tags);
    if (row) {
      rows.push(row);
    }
  }
  if (rows.length === 0) {
    throw new ParseError("input contains no recognizable qrc lyric lines");
  }
  const album = tags.get("al");
  const artist = tags.get("ar");
  const author = tags.get("by");
  const offsetText = tags.get("offset");
  const offset = offsetText === undefined ? 0 : readOffset(offsetText, "qrc");
  const songwriter = tags.get("au");
  const title = tags.get("ti");
  const meta = {
    ...(album !== undefined && { album }),
    ...(artist !== undefined && { artist }),
    ...(author && { author }),
    ...(songwriter !== undefined && { songwriters: [songwriter] }),
    ...(title !== undefined && { title }),
  };
  return shiftTimes(
    {
      agents: [],
      lines: makeLines(rows),
      meta,
      timing: "word",
      version: 1,
    },
    offset,
    "qrc"
  );
}

function writeRow(
  begin: number,
  end: number,
  syllables: Syllable[],
  wrap: boolean
): string {
  const duration = end - begin;
  checkTime(duration, "qrc line duration");
  checkTime(begin, "qrc line start");
  return `[${begin},${duration}]${syllables
    .map((syllable, index) => {
      const syllableDuration = syllable.end - syllable.begin;
      checkTime(syllableDuration, `syllable ${syllable.id} duration`);
      checkTime(syllable.begin, `syllable ${syllable.id} start`);
      const prefix = wrap && index === 0 ? "(" : "";
      const suffix = wrap && index === syllables.length - 1 ? ")" : "";
      return `${prefix}${syllable.text}${suffix}(${syllable.begin},${syllableDuration})`;
    })
    .join("")}`;
}

function checkRows(rows: QrcWriteRow[], lineCount: number) {
  const lines: QrcWriteLine[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const backing =
      row.wrapped &&
      !rows[rowIndex - 1]?.wrapped &&
      !rows[rowIndex + 1]?.wrapped;
    const previous = lines.at(-1);
    if (backing && previous) {
      previous.b.push(row);
      continue;
    }
    lines.push({ b: backing ? [row] : [], p: backing ? [] : [row] });
  }
  if (
    lines.length !== lineCount ||
    lines.some(
      (line, lineIndex) =>
        line.p.some(
          (row) => row.lineIndex !== lineIndex || row.track !== "p"
        ) ||
        line.b.some((row) => row.lineIndex !== lineIndex || row.track !== "b")
    )
  ) {
    throw new Error("qrc cannot preserve lyric row ownership");
  }
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const doc = prepare(source, capabilities, "qrc", options);
  checkLines(doc, "qrc");
  checkWrite(doc, "qrc", capabilities);
  for (const line of doc.lines) {
    for (const syllable of [...line.p, ...line.b]) {
      checkText(syllable.text, "qrc", reservedStamp);
    }
  }
  const rowModel: QrcWriteRow[] = [];
  for (const [lineIndex, line] of doc.lines.entries()) {
    if (line.p.length > 0 || line.b.length === 0) {
      const lyric = line.p.map((syllable) => syllable.text).join("");
      rowModel.push({
        lineIndex,
        track: "p",
        wrapped: isWrapped(lyric),
      });
    }
    if (line.b.length > 0) {
      rowModel.push({ lineIndex, track: "b", wrapped: true });
    }
  }
  checkRows(rowModel, doc.lines.length);
  const lyricRows = doc.lines.flatMap((line) => {
    const rows =
      line.p.length > 0 || line.b.length === 0
        ? [writeRow(line.begin, line.end, line.p, false)]
        : [];
    if (line.b.length > 0) {
      const backingBegin = Math.min(
        ...line.b.map((syllable) => syllable.begin)
      );
      const backingEnd = Math.max(...line.b.map((syllable) => syllable.end));
      rows.push(writeRow(backingBegin, backingEnd, line.b, true));
    }
    return rows;
  });
  return [...writeTags(doc.meta, "qrc"), ...lyricRows].join("\n");
}
