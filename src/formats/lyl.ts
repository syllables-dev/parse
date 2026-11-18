/**
 * LYL (Lyricify Lines), Lyricify's line-by-line format.
 * by Lyricify / WXRIW
 *
 * [type:LyricifyLines]
 * [54260,57380]Stop and stare
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
  lostIf,
  prepare,
  projectedDocument,
} from "@/internal/projections";
import {
  backingLine,
  primaryProblem,
  projectedLine,
  track,
} from "@/internal/projections/line";
import { shiftTimes, splitLines, toInt } from "@/internal/timestamps";
import { checkLines, checkText, checkWrite } from "@/internal/write-check";
import type {
  ConversionLoss,
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
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
      checkUnreadRow(raw, "lyl", lineIndex);
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

export function read(text: string): LyricsDocument {
  const tags = new Map<string, string>();
  const rows = readRows(text, tags);
  const declaredType = tags.get("type");
  if (
    declaredType !== undefined &&
    declaredType.toLowerCase() !== typeName.toLowerCase()
  ) {
    throw new ParseError(`lyl declares the unknown type ${declaredType}`);
  }
  const { meta, offset } = readTagMeta(tags, "lyl");
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

// lyl writes an explicit line range, so only a primary track that disagrees with its line is lost
export function losses(doc: LyricsDocument): ConversionLoss[] {
  return findLosses(doc, capabilities, (lyric) => [
    ...tagProblems(lyric.meta, "lyl").map((problem) => problem.loss),
    ...lostIf(
      "lineRange",
      lyric.timing !== "word" &&
        lyric.lines.some((line) => primaryProblem(line) !== undefined)
    ),
  ]);
}

function collapsed(line: LyricsLine, wordTimed: boolean): LyricsLine {
  return {
    ...projectedLine(line, capabilities, wordTimed),
    p: track(line.p, line),
  };
}

function project(doc: LyricsDocument): LyricsDocument {
  const wordTimed = keepsWordTiming(doc, capabilities);
  const lines = doc.lines.flatMap((line) => {
    const primary = collapsed(line, wordTimed);
    const backing = backingLine(line, capabilities, wordTimed);
    if (backing === undefined) {
      return [primary];
    }
    const flattened = collapsed(backing, wordTimed);
    return backing.begin < line.begin
      ? [flattened, primary]
      : [primary, flattened];
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
  const doc = prepare(source, options, "lyl", losses, project);
  checkLines(doc, "lyl");
  checkWrite(doc, "lyl", capabilities);
  for (const line of doc.lines) {
    if (line.end < line.begin) {
      throw new Error(
        `lyl cannot represent the inverted range of line ${line.id}`
      );
    }
    const problem = primaryProblem(line);
    if (problem !== undefined) {
      throw new Error(`lyl cannot represent ${problem}`);
    }
    for (const syllable of line.p) {
      checkText(syllable.text, "lyl", reservedStamp);
    }
  }
  return [
    `[type:${typeName}]`,
    ...writeTags(doc.meta, tagProblems(doc.meta, "lyl")),
    ...doc.lines.map(
      (line) =>
        `[${line.begin},${line.end}]${line.p
          .map((syllable) => syllable.text)
          .join("")}`
    ),
  ].join("\n");
}
