/**
 * LYS (Lyricify Syllable), Lyricify's word-by-word format.
 * by Lyricify / WXRIW
 *
 * [4]Hel(12000,400)lo (12400,300)world(12700,600)
 */

import { ParseError } from "@/errors";
import { fittedLines, rangeLosses, writeRows } from "@/formats/lys/rows";
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
  prepare,
  projectedDocument,
} from "@/internal/projections";
import { projectedLines } from "@/internal/projections/line";
import {
  foldSpacers,
  readTimedWords,
  type TimedWord,
  toSyllables,
} from "@/internal/timed-words";
import { shiftTimes, splitLines, toInt } from "@/internal/timestamps";
import { checkLines, checkWrite } from "@/internal/write-check";
import type {
  ConversionLoss,
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
  WriteOptions,
} from "@/types";

interface LysRow {
  agent: string | null;
  begin: number;
  end: number;
  property: number;
  words: TimedWord[];
  wrapped: boolean;
}

const lineHeader = /^\[(\d+)\](.*)$/u;
const whitespace = /^\s+$/u;
const leftAgentId = "v1";
const rightAgentId = "v2";

export const capabilities = {
  agents: "alignment",
  backing: true,
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
    checkUnreadRow(raw, "lys", lineIndex);
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
    lineIndex + 1
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
      mainLine.b.push(
        ...toSyllables(words, `${mainLine.id}b`, mainLine.b.length)
      );
      continue;
    }
    const lineId = `l${rowIndex}`;
    lines.push({
      agent: row.agent,
      b: isBacking ? toSyllables(words, `${lineId}b`) : [],
      begin: row.begin,
      end: row.end,
      id: lineId,
      p: isBacking ? [] : toSyllables(words, `${lineId}w`),
    });
  }
  return lines;
}

export function read(text: string): LyricsDocument {
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
  const lines = makeLines(rows);
  const { meta, offset } = readTagMeta(tags, "lys");
  const agents: LyricsDocument["agents"] = [];
  const hasLeftAgent = lines.some((line) => line.agent === leftAgentId);
  if (hasLeftAgent) {
    agents.push({ id: leftAgentId, type: "person" });
  }
  if (lines.some((line) => line.agent === rightAgentId)) {
    agents.push({
      id: rightAgentId,
      type: hasLeftAgent ? "person" : "other",
    });
  }
  return shiftTimes(
    {
      agents,
      lines: lines.map(trimLineEdges),
      meta,
      timing: "word",
      version: 1,
    },
    offset,
    "lys"
  );
}

export function losses(doc: LyricsDocument): ConversionLoss[] {
  return findLosses(doc, capabilities, (lyric) => [
    ...tagProblems(lyric.meta, "lys").map((problem) => problem.loss),
    ...rangeLosses(lyric),
  ]);
}

function project(doc: LyricsDocument): LyricsDocument {
  return projectedDocument(
    doc,
    capabilities,
    projectedLines(
      { ...doc, lines: fittedLines(doc) },
      capabilities,
      keepsWordTiming(doc, capabilities)
    ),
    projectedTagMeta(doc.meta)
  );
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const doc = prepare(source, options, "lys", losses, project);
  checkLines(doc, "lys");
  checkWrite(doc, "lys", capabilities);
  const rows = writeRows(doc, "lys");
  return [...writeTags(doc.meta, tagProblems(doc.meta, "lys")), ...rows].join(
    "\n"
  );
}
