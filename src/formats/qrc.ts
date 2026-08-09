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
    const lyric = words.map((word) => word.text).join("");
    rows.push({
      begin,
      end: begin + duration,
      words,
      wrapped:
        (lyric.startsWith("(") && lyric.endsWith(")")) ||
        (lyric.startsWith("（") && lyric.endsWith("）")),
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
  const album = tags.get("al");
  const artist = tags.get("ar");
  const offsetText = tags.get("offset");
  let offset: number | undefined;
  if (offsetText !== undefined) {
    const sign = offsetText.startsWith("-") ? -1 : 1;
    offset =
      sign *
      toInt(
        signPrefix.test(offsetText) ? offsetText.slice(1) : offsetText,
        "qrc offset"
      );
  }
  const songwriter = tags.get("au");
  const title = tags.get("ti");
  const meta = {
    ...(album !== undefined && { album }),
    ...(artist !== undefined && { artist }),
    ...(offset !== undefined && { offset }),
    ...(songwriter !== undefined && { songwriters: [songwriter] }),
    ...(title !== undefined && { title }),
  };
  return {
    agents: [],
    lines: makeLines(rows, meta.offset ?? 0),
    meta,
    timing: "word",
    version: 1,
  };
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
  return `[${begin + offset},${duration}]${syllables
    .map((syllable, index) => {
      const syllableDuration = syllable.end - syllable.begin;
      checkTime(syllableDuration, `syllable ${syllable.id} duration`);
      checkTime(syllable.begin + offset, `syllable ${syllable.id} start`);
      const prefix = wrap && index === 0 ? "(" : "";
      const suffix = wrap && index === syllables.length - 1 ? ")" : "";
      return `${prefix}${syllable.text}${suffix}(${syllable.begin + offset},${syllableDuration})`;
    })
    .join("")}`;
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
  if (doc.meta.songwriters && doc.meta.songwriters.length > 1) {
    throw new Error("qrc cannot represent multiple songwriters");
  }
  return [
    ...(doc.meta.title === undefined ? [] : [`[ti:${doc.meta.title}]`]),
    ...(doc.meta.artist === undefined ? [] : [`[ar:${doc.meta.artist}]`]),
    ...(doc.meta.album === undefined ? [] : [`[al:${doc.meta.album}]`]),
    "[by:]",
    ...(doc.meta.offset === undefined ? [] : [`[offset:${doc.meta.offset}]`]),
    ...(doc.meta.songwriters?.[0] === undefined
      ? []
      : [`[au:${doc.meta.songwriters[0]}]`]),
    ...lyricRows,
  ].join("\n");
}
