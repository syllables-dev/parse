/**
 * QRC, QQ Music's word-by-word lyrics format.
 * by Tencent / QQ Music
 *
 * [12000,3320]Hel(12000,400)lo (12400,300)world(12700,600)
 */

import { ParseError } from "@/errors";
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
import { checkWordOrder } from "@/internal/syllable-bounds";
import {
  foldSpacers,
  readRowHeader,
  readTimedWords,
  suffixMark,
  toSyllables,
} from "@/internal/timed-words";
import { checkTime, shiftTimes, splitLines } from "@/internal/timestamps";
import { checkLines, checkText, checkWrite } from "@/internal/write-check";
import type {
  ConversionLoss,
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
  WriteOptions,
} from "@/types";

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

// qrc carries no backing marker, so brackets stay ordinary text and every row is a lyric line
function readLines(text: string, tags: Map<string, string>): LyricsLine[] {
  const lines: LyricsLine[] = [];
  for (const [lineIndex, raw] of splitLines(text).entries()) {
    const tag = readTag(raw);
    if (tag) {
      tags.set(tag.name, tag.text);
      continue;
    }
    const row = readRowHeader(raw, "qrc", lineIndex);
    if (!row) {
      checkUnreadRow(raw, "qrc", lineIndex);
      continue;
    }
    const id = `l${lines.length}`;
    lines.push({
      agent: null,
      b: [],
      begin: row.begin,
      end: row.end,
      id,
      p: toSyllables(
        foldSpacers(
          readTimedWords(row.body, lineIndex + 1, row.begin, row.end),
          "qrc",
          lineIndex + 1
        ),
        `${id}w`
      ),
    });
  }
  if (lines.length === 0) {
    throw new ParseError("input contains no recognizable qrc lyric lines");
  }
  return lines;
}

export function read(text: string): LyricsDocument {
  const tags = new Map<string, string>();
  const lines = readLines(text, tags);
  checkWordOrder(lines, "qrc");
  const { meta, offset } = readTagMeta(tags, "qrc");
  return shiftTimes(
    {
      agents: [],
      lines: lines.map(trimLineEdges),
      meta,
      timing: "word",
      version: 1,
    },
    offset,
    "qrc"
  );
}

export function losses(doc: LyricsDocument): ConversionLoss[] {
  return findLosses(doc, capabilities, (lyric) =>
    tagProblems(lyric.meta, "qrc").map((problem) => problem.loss)
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

function writeRow(line: LyricsLine): string {
  const duration = line.end - line.begin;
  checkTime(duration, "qrc line duration");
  checkTime(line.begin, "qrc line start");
  return `[${line.begin},${duration}]${line.p
    .map((syllable) => {
      const syllableDuration = syllable.end - syllable.begin;
      checkTime(syllableDuration, `syllable ${syllable.id} duration`);
      checkTime(syllable.begin, `syllable ${syllable.id} start`);
      return `${syllable.text}(${syllable.begin},${syllableDuration})`;
    })
    .join("")}`;
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const doc = prepare(source, options, "qrc", losses, project);
  checkLines(doc, "qrc");
  checkWrite(doc, "qrc", capabilities);
  for (const line of doc.lines) {
    for (const syllable of line.p) {
      checkText(syllable.text, "qrc", suffixMark);
    }
  }
  return [
    ...writeTags(doc.meta, tagProblems(doc.meta, "qrc")),
    ...doc.lines.map(writeRow),
  ].join("\n");
}
