/**
 * QRC, QQ Music's word-by-word lyrics format.
 * by Tencent / QQ Music
 *
 * [12000,3320]Hel(12000,400)lo(12400,300) world(12700,600)
 */

import { ParseError } from "../errors";
import { readTimedWords, type TimedWord } from "../internal/timed-words";
import { checkTime, splitLines, toInt } from "../internal/timestamps";
import { checkWrite } from "../internal/write-check";
import type {
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
  LyricsMeta,
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

const metaTag = /^\[([A-Za-z]+):(.*)\]$/u;
const lineHeader = /^\[(\d+),(\d+)\](.*)$/u;
const signPrefix = /^[+-]/u;

export const capabilities = {
  agents: false,
  backing: true,
  pronunciation: false,
  translation: false,
  wordTiming: true,
} satisfies FormatCapabilities;

function readOffset(offsetText: string | undefined): number | undefined {
  if (offsetText === undefined) {
    return;
  }
  const sign = offsetText.startsWith("-") ? -1 : 1;
  return (
    sign *
    toInt(
      signPrefix.test(offsetText) ? offsetText.slice(1) : offsetText,
      "qrc offset"
    )
  );
}

function readMeta(tags: Map<string, string>): LyricsMeta {
  const album = tags.get("al");
  const artist = tags.get("ar");
  const offset = readOffset(tags.get("offset"));
  const songwriter = tags.get("au");
  const title = tags.get("ti");
  return {
    ...(album !== undefined && { album }),
    ...(artist !== undefined && { artist }),
    ...(offset !== undefined && { offset }),
    ...(songwriter !== undefined && { songwriters: [songwriter] }),
    ...(title !== undefined && { title }),
  };
}

function isWrapped(words: TimedWord[]): boolean {
  const lyric = words.map((word) => word.text).join("");
  return (
    (lyric.startsWith("(") && lyric.endsWith(")")) ||
    (lyric.startsWith("（") && lyric.endsWith("）"))
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
  track: "b" | "w",
  offset: number
): Syllable[] {
  return words.map((word, wordIndex) => ({
    begin: word.begin - offset,
    end: word.end - offset,
    id: `${lineId}${track}${wordIndex}`,
    text: word.text,
  }));
}

function readRows(text: string, tags: Map<string, string>): QrcRow[] {
  const rows: QrcRow[] = [];
  for (const [lineIndex, raw] of splitLines(text).entries()) {
    const metadata = metaTag.exec(raw.trim());
    if (metadata) {
      const colon = metadata[0].indexOf(":");
      tags.set(
        metadata[0].slice(1, colon).toLowerCase(),
        metadata[0].slice(colon + 1, -1).trim()
      );
      continue;
    }
    const header = lineHeader.exec(raw);
    if (!header) {
      if (raw.trim().length > 0 && raw.startsWith("[")) {
        throw new ParseError(`malformed qrc line ${lineIndex + 1}`);
      }
      continue;
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
    rows.push({
      begin,
      end: begin + duration,
      words,
      wrapped: isWrapped(words),
    });
  }
  if (rows.length === 0) {
    throw new ParseError("input contains no recognizable qrc lyric lines");
  }
  return rows;
}

function makeLines(rows: QrcRow[], offset: number): LyricsLine[] {
  const lines: LyricsLine[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const isBacking =
      row.wrapped &&
      !rows[rowIndex - 1]?.wrapped &&
      !rows[rowIndex + 1]?.wrapped;
    if (isBacking && lines.length > 0) {
      const mainLine = lines.at(-1);
      if (!mainLine) {
        throw new ParseError(`qrc line ${rowIndex + 1} has no primary line`);
      }
      mainLine.begin = Math.min(mainLine.begin, row.begin - offset);
      mainLine.end = Math.max(mainLine.end, row.end - offset);
      mainLine.b.push(
        ...makeTrack(unwrapWords(row.words), mainLine.id, "b", offset)
      );
      continue;
    }

    const lineId = `l${rowIndex}`;
    lines.push({
      agent: null,
      b: isBacking
        ? makeTrack(unwrapWords(row.words), lineId, "b", offset)
        : [],
      begin: row.begin - offset,
      end: row.end - offset,
      id: lineId,
      p: isBacking ? [] : makeTrack(row.words, lineId, "w", offset),
    });
  }
  return lines;
}

export function read(text: string, options: ReadOptions = {}): LyricsDocument {
  if (options.expandRepeats) {
    throw new Error("expandRepeats is available for lrc input");
  }
  const tags = new Map<string, string>();
  const rows = readRows(text, tags);
  const meta = readMeta(tags);
  return {
    agents: [],
    lines: makeLines(rows, meta.offset ?? 0),
    meta,
    timing: "word",
    version: 1,
  };
}

function writeMeta(meta: LyricsMeta): string[] {
  if (meta.songwriters && meta.songwriters.length > 1) {
    throw new Error("qrc cannot represent multiple songwriters");
  }
  return [
    ...(meta.title === undefined ? [] : [`[ti:${meta.title}]`]),
    ...(meta.artist === undefined ? [] : [`[ar:${meta.artist}]`]),
    ...(meta.album === undefined ? [] : [`[al:${meta.album}]`]),
    "[by:]",
    ...(meta.offset === undefined ? [] : [`[offset:${meta.offset}]`]),
    ...(meta.songwriters?.[0] === undefined
      ? []
      : [`[au:${meta.songwriters[0]}]`]),
  ];
}

function writeWords(
  syllables: Syllable[],
  offset: number,
  wrap: boolean
): string {
  return syllables
    .map((syllable, index) => {
      const duration = syllable.end - syllable.begin;
      checkTime(duration, `syllable ${syllable.id} duration`);
      checkTime(syllable.begin + offset, `syllable ${syllable.id} start`);
      const prefix = wrap && index === 0 ? "(" : "";
      const suffix = wrap && index === syllables.length - 1 ? ")" : "";
      return `${prefix}${syllable.text}${suffix}(${syllable.begin + offset},${duration})`;
    })
    .join("");
}

function writeRow(
  begin: number,
  end: number,
  syllables: Syllable[],
  offset: number,
  wrap: boolean
): string {
  const duration = end - begin;
  checkTime(duration, "qrc line duration");
  checkTime(begin + offset, "qrc line start");
  return `[${begin + offset},${duration}]${writeWords(
    syllables,
    offset,
    wrap
  )}`;
}

export function write(doc: LyricsDocument, options: WriteOptions = {}): string {
  if (Object.keys(options).length > 0) {
    throw new Error("qrc write options are unsupported");
  }
  checkWrite(doc, "qrc", capabilities);
  const offset = doc.meta.offset ?? 0;
  const lyricRows = doc.lines.flatMap((line) => {
    const rows =
      line.p.length > 0 || line.b.length === 0
        ? [writeRow(line.begin, line.end, line.p, offset, false)]
        : [];
    if (line.b.length > 0) {
      const backingBegin = Math.min(
        ...line.b.map((syllable) => syllable.begin)
      );
      const backingEnd = Math.max(...line.b.map((syllable) => syllable.end));
      rows.push(writeRow(backingBegin, backingEnd, line.b, offset, true));
    }
    return rows;
  });
  return [...writeMeta(doc.meta), ...lyricRows].join("\n");
}
