/**
 * LYL (Lyricify Lines), Lyricify's line-by-line format.
 * by Lyricify / WXRIW
 *
 * [type:LyricifyLines]
 * [54260,57380]Stop and stare
 */

import { ParseError } from "@/errors";
import { readTag, writeTags } from "@/internal/lyric-tags";
import { prepare } from "@/internal/projections";
import {
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

interface LylRow {
  begin: number;
  end: number;
  text: string;
}

const lineHeader = /^\[(\d+),(\d+)\]/u;
const reservedStamp = /\[\d+,\d+\]/u;
const typeName = "LyricifyLines";

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

function readRows(text: string, tags: Map<string, string>): LylRow[] {
  const rows: LylRow[] = [];
  for (const [lineIndex, raw] of splitLines(text).entries()) {
    const tag = readTag(raw);
    if (tag) {
      tags.set(tag.name, tag.text);
      continue;
    }
    const header = lineHeader.exec(raw);
    if (!header) {
      if (raw.trim().length > 0 && raw.startsWith("[")) {
        throw new ParseError(`malformed lyl line ${lineIndex + 1}`);
      }
      continue;
    }
    const separator = header[0].indexOf(",");
    const begin = toInt(
      header[0].slice(1, separator),
      `lyl line ${lineIndex + 1} start`
    );
    const end = toInt(
      header[0].slice(separator + 1, -1),
      `lyl line ${lineIndex + 1} end`
    );
    if (end < begin) {
      throw new ParseError(`lyl line ${lineIndex + 1} ends before it starts`);
    }
    rows.push({ begin, end, text: raw.slice(header[0].length) });
  }
  if (rows.length === 0) {
    throw new ParseError("input contains no recognizable lyl lyric lines");
  }
  return rows;
}

export function read(text: string, options: ReadOptions = {}): LyricsDocument {
  if (options.expandRepeats) {
    throw new Error("expandRepeats is available for lrc input");
  }
  const tags = new Map<string, string>();
  const rows = readRows(text, tags);
  const declaredType = tags.get("type");
  if (
    declaredType !== undefined &&
    declaredType.toLowerCase() !== typeName.toLowerCase()
  ) {
    throw new ParseError(`lyl declares the unknown type ${declaredType}`);
  }
  const offsetText = tags.get("offset");
  const offset = offsetText === undefined ? 0 : readOffset(offsetText, "lyl");
  const songwriter = tags.get("au");
  const meta = {
    ...(tags.has("al") && { album: tags.get("al") }),
    ...(tags.has("ar") && { artist: tags.get("ar") }),
    ...(songwriter !== undefined && { songwriters: [songwriter] }),
    ...(tags.has("ti") && { title: tags.get("ti") }),
  };
  return shiftTimes(
    {
      agents: [],
      lines: rows.map((row, lineIndex) => ({
        agent: null,
        b: [],
        begin: row.begin,
        end: row.end,
        id: `l${lineIndex}`,
        p: [
          {
            begin: row.begin,
            end: row.end,
            id: `l${lineIndex}w0`,
            text: row.text,
          },
        ],
      })),
      meta,
      timing: "line",
      version: 1,
    },
    offset,
    "lyl"
  );
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const prepared = prepare(source, capabilities, "lyl", options);
  const doc = { ...prepared, lines: prepared.lines.filter(hasLyricText) };
  checkLines(doc, "lyl");
  checkWrite(doc, "lyl", capabilities);
  for (const line of doc.lines) {
    if (line.end < line.begin) {
      throw new Error(
        `lyl cannot represent the inverted range of line ${line.id}`
      );
    }
    if (line.p.length > 1) {
      throw new Error(
        `lyl cannot represent the primary syllable count of line ${line.id}`
      );
    }
    if (
      line.p.some(
        (syllable) => syllable.begin !== line.begin || syllable.end !== line.end
      )
    ) {
      throw new Error(
        `lyl cannot represent the primary syllable range of line ${line.id}`
      );
    }
    for (const syllable of line.p) {
      checkText(syllable.text, "lyl", reservedStamp);
    }
  }
  return [
    `[type:${typeName}]`,
    ...writeTags(doc.meta, "lyl"),
    ...doc.lines.map(
      (line) =>
        `[${line.begin},${line.end}]${line.p
          .map((syllable) => syllable.text)
          .join("")}`
    ),
  ].join("\n");
}
