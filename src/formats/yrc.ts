/**
 * YRC, NetEase Cloud Music's word-by-word lyrics format.
 * by NetEase / Cloud Music (NCM)
 *
 * [12000,3320](12000,400,0)Hel(12400,300,0)lo(12700,600,0) world
 */

import { ParseError } from "../errors";
import { readYrcWords, type TimedWord } from "../internal/timed-words";
import { checkTime, splitLines, toInt } from "../internal/timestamps";
import { checkWrite } from "../internal/write-check";
import type {
  FormatCapabilities,
  LyricsDocument,
  ReadOptions,
  Syllable,
  WriteOptions,
} from "../types";

interface YrcRow {
  begin: number;
  end: number;
  words: TimedWord[];
}

const lineHeader = /^\[(\d+),(\d+)\](.*)$/u;
const creditLabel = /^(?:作词|作詞|作曲)\s*[:：]\s*/u;

export const capabilities = {
  agents: false,
  backing: false,
  pronunciation: false,
  translation: false,
  wordTiming: true,
} satisfies FormatCapabilities;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCredits(raw: string, lineNumber: number): string[] {
  let preamble: unknown;
  try {
    preamble = JSON.parse(raw);
  } catch (cause) {
    throw new ParseError(`malformed yrc JSON preamble on line ${lineNumber}`, {
      cause,
    });
  }
  if (!(isRecord(preamble) && Array.isArray(preamble.c))) {
    throw new ParseError(`malformed yrc JSON preamble on line ${lineNumber}`);
  }
  const creditText = preamble.c
    .map((chunk) => {
      if (!isRecord(chunk) || typeof chunk.tx !== "string") {
        throw new ParseError(
          `malformed yrc JSON preamble on line ${lineNumber}`
        );
      }
      return chunk.tx;
    })
    .join("");
  if (!creditLabel.test(creditText)) {
    return [];
  }
  return creditText
    .replace(creditLabel, "")
    .split("/")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function readRows(text: string, songwriters: string[]): YrcRow[] {
  const rows: YrcRow[] = [];
  for (const [lineIndex, raw] of splitLines(text).entries()) {
    const trimmedStart = raw.trimStart();
    if (trimmedStart.startsWith("{")) {
      songwriters.push(
        ...readCredits(trimmedStart, lineIndex + 1).filter(
          (songwriter) => !songwriters.includes(songwriter)
        )
      );
      continue;
    }
    const header = lineHeader.exec(raw);
    if (!header) {
      if (raw.trim().length > 0 && raw.startsWith("[")) {
        throw new ParseError(`malformed yrc line ${lineIndex + 1}`);
      }
      continue;
    }
    const begin = toInt(header[1] ?? "", `yrc line ${lineIndex + 1} start`);
    const duration = toInt(
      header[2] ?? "",
      `yrc line ${lineIndex + 1} duration`
    );
    if (!Number.isSafeInteger(begin + duration)) {
      throw new ParseError(
        `yrc line ${lineIndex + 1} end exceeds the safe integer range`
      );
    }
    rows.push({
      begin,
      end: begin + duration,
      words: readYrcWords(
        header[3] ?? "",
        lineIndex + 1,
        begin,
        begin + duration
      ),
    });
  }
  if (rows.length === 0) {
    throw new ParseError("input contains no recognizable yrc lyric lines");
  }
  return rows;
}

export function read(text: string, options: ReadOptions = {}): LyricsDocument {
  if (options.expandRepeats) {
    throw new Error("expandRepeats is available for lrc input");
  }
  const songwriters: string[] = [];
  const rows = readRows(text, songwriters);
  return {
    agents: [],
    lines: rows.map((row, lineIndex) => ({
      agent: null,
      b: [],
      begin: row.begin,
      end: row.end,
      id: `l${lineIndex}`,
      p: row.words.map((word, wordIndex) => ({
        begin: word.begin,
        end: word.end,
        id: `l${lineIndex}w${wordIndex}`,
        text: word.text,
      })),
    })),
    meta: songwriters.length > 0 ? { songwriters } : {},
    timing: "word",
    version: 1,
  };
}

function writeWords(syllables: Syllable[]): string {
  return syllables
    .map((syllable) => {
      const duration = syllable.end - syllable.begin;
      checkTime(duration, `syllable ${syllable.id} duration`);
      return `(${syllable.begin},${duration},0)${syllable.text}`;
    })
    .join("");
}

export function write(doc: LyricsDocument, options: WriteOptions = {}): string {
  if (Object.keys(options).length > 0) {
    throw new Error("yrc write options are unsupported");
  }
  checkWrite(doc, "yrc", capabilities);
  if (
    doc.meta.title !== undefined ||
    doc.meta.artist !== undefined ||
    doc.meta.album !== undefined ||
    doc.meta.offset !== undefined
  ) {
    throw new Error(
      "yrc cannot represent title, artist, album, or offset metadata"
    );
  }
  if (doc.meta.songwriters?.some((name) => name.includes("/"))) {
    throw new Error("yrc cannot represent a slash inside a songwriter name");
  }
  const preamble = doc.meta.songwriters?.length
    ? [
        JSON.stringify({
          c: [{ tx: "作词: " }, { tx: doc.meta.songwriters.join("/") }],
          t: 0,
        }),
      ]
    : [];
  return [
    ...preamble,
    ...doc.lines.map((line) => {
      const duration = line.end - line.begin;
      checkTime(duration, `line ${line.id} duration`);
      return `[${line.begin},${duration}]${writeWords(line.p)}`;
    }),
  ].join("\n");
}
