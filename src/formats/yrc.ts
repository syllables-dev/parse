/**
 * YRC, NetEase Cloud Music's word-by-word lyrics format.
 * by NetEase / Cloud Music (NCM)
 *
 * [12000,3320](12000,400,0)Hel(12400,300,0)lo (12700,600,0)world
 */

import { ParseError } from "@/errors";
import { checkMetaText, readTag } from "@/internal/lyric-tags";
import { prepare } from "@/internal/projections";
import {
  foldSpacers,
  readYrcWords,
  type TimedWord,
} from "@/internal/timed-words";
import {
  checkTime,
  readOffset,
  shiftTimes,
  splitLines,
  toInt,
} from "@/internal/timestamps";
import {
  checkLines,
  checkText,
  checkWrite,
  hasLyricText,
} from "@/internal/write-check";
import type {
  FormatCapabilities,
  LyricsDocument,
  ReadOptions,
  WriteOptions,
} from "@/types";

interface YrcRow {
  begin: number;
  end: number;
  words: TimedWord[];
}

const lineHeader = /^\[(\d+),(\d+)\](.*)$/u;
const reservedStamp = /\(\d+,\d+,-?\d+\)/u;
const creditLabel = /^(?:作词|作詞|作曲)\s*[:：]\s*/u;

export const capabilities = {
  agents: false,
  backing: false,
  metadata: {
    album: true,
    artist: true,
    author: true,
    songwriters: true,
    title: true,
  },
  pronunciation: false,
  timing: { line: false, static: false, word: true },
  trackGenerated: false,
  trackKind: false,
  translation: false,
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

function readRows(
  text: string,
  songwriters: string[],
  tags: Map<string, string>
): YrcRow[] {
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
    const tag = readTag(raw);
    if (tag) {
      tags.set(tag.name, tag.text);
      continue;
    }
    const header = lineHeader.exec(raw);
    if (!header) {
      if (raw.trim().length > 0 && raw.startsWith("[")) {
        throw new ParseError(`malformed yrc line ${lineIndex + 1}`);
      }
      continue;
    }
    const comma = header[0].indexOf(",");
    const close = header[0].indexOf("]");
    const begin = toInt(
      header[0].slice(1, comma),
      `yrc line ${lineIndex + 1} start`
    );
    const duration = toInt(
      header[0].slice(comma + 1, close),
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
      words: foldSpacers(
        readYrcWords(
          header[0].slice(close + 1),
          lineIndex + 1,
          begin,
          begin + duration
        ),
        "yrc",
        lineIndex + 1,
        (word) => word.begin === word.end
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
  const tags = new Map<string, string>();
  const rows = readRows(text, songwriters, tags);
  const taggedSongwriter = tags.get("au");
  if (
    taggedSongwriter !== undefined &&
    !songwriters.includes(taggedSongwriter)
  ) {
    songwriters.push(taggedSongwriter);
  }
  const album = tags.get("al");
  const artist = tags.get("ar");
  const author = tags.get("by");
  const offsetText = tags.get("offset");
  const offset = offsetText === undefined ? 0 : readOffset(offsetText, "yrc");
  const title = tags.get("ti");
  return shiftTimes(
    {
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
      meta: {
        ...(album !== undefined && { album }),
        ...(artist !== undefined && { artist }),
        ...(author && { author }),
        ...(songwriters.length > 0 && { songwriters }),
        ...(title !== undefined && { title }),
      },
      timing: "word",
      version: 1,
    },
    offset,
    "yrc"
  );
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const prepared = prepare(source, capabilities, "yrc", options);
  const doc = {
    ...prepared,
    lines: prepared.lines.filter(hasLyricText),
  };
  checkLines(doc, "yrc");
  checkWrite(doc, "yrc", capabilities);
  checkMetaText(doc.meta, "yrc");
  for (const line of doc.lines) {
    for (const syllable of line.p) {
      checkText(syllable.text, "yrc", reservedStamp);
    }
  }
  if (doc.meta.songwriters?.length === 0) {
    throw new Error("yrc cannot represent an empty songwriter list");
  }
  if (doc.meta.songwriters?.some((songwriter) => songwriter.length === 0)) {
    throw new Error("yrc cannot represent an empty songwriter name");
  }
  if (
    doc.meta.songwriters &&
    doc.meta.songwriters.length > 1 &&
    doc.meta.songwriters.some(
      (name) => name.length === 0 || name.trim() !== name || name.includes("/")
    )
  ) {
    throw new Error("yrc cannot preserve this songwriter name");
  }
  if (
    doc.meta.songwriters &&
    doc.meta.songwriters.length > 1 &&
    new Set(doc.meta.songwriters).size !== doc.meta.songwriters.length
  ) {
    throw new Error("yrc requires unique songwriter names");
  }
  const preamble =
    doc.meta.songwriters && doc.meta.songwriters.length > 1
      ? [
          JSON.stringify({
            c: [{ tx: "作词: " }, { tx: doc.meta.songwriters.join("/") }],
            t: 0,
          }),
        ]
      : [];
  return [
    ...preamble,
    ...(doc.meta.title === undefined ? [] : [`[ti:${doc.meta.title}]`]),
    ...(doc.meta.artist === undefined ? [] : [`[ar:${doc.meta.artist}]`]),
    ...(doc.meta.album === undefined ? [] : [`[al:${doc.meta.album}]`]),
    `[by:${doc.meta.author === undefined ? "" : doc.meta.author}]`,
    ...(doc.meta.songwriters?.length === 1
      ? [`[au:${doc.meta.songwriters[0]}]`]
      : []),
    ...doc.lines.map((line) => {
      const duration = line.end - line.begin;
      checkTime(duration, `line ${line.id} duration`);
      return `[${line.begin},${duration}]${line.p
        .map((syllable) => {
          const syllableDuration = syllable.end - syllable.begin;
          checkTime(syllableDuration, `syllable ${syllable.id} duration`);
          return `(${syllable.begin},${syllableDuration},0)${syllable.text}`;
        })
        .join("")}`;
    }),
  ].join("\n");
}
