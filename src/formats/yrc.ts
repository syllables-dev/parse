/**
 * YRC, NetEase Cloud Music's word-by-word lyrics format.
 * by NetEase / Cloud Music (NCM)
 *
 * [12000,3320](12000,400,0)Hel(12400,300,0)lo (12700,600,0)world
 */

import { ParseError } from "@/errors";
import {
  checkUnreadRow,
  normalizedTagText,
  projectedTagMeta,
  readTag,
  readTagMeta,
  songwriterProblems,
  textProblems,
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
  readRowHeader,
  readYrcWords,
  toSyllables,
  yrcMark,
} from "@/internal/timed-words";
import { checkTime, shiftTimes, splitLines } from "@/internal/timestamps";
import { checkLines, checkText, checkWrite } from "@/internal/write-check";
import type {
  ConversionLoss,
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
  LyricsMeta,
  WriteOptions,
} from "@/types";

const creditLabel = /^(?:作词|作詞|作曲)\s*[:：]\s*/u;
const lineBreak = /[\r\n]/u;

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

function readLines(
  text: string,
  songwriters: string[],
  tags: Map<string, string>
): LyricsLine[] {
  const lines: LyricsLine[] = [];
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
    const row = readRowHeader(raw, "yrc", lineIndex);
    if (!row) {
      checkUnreadRow(raw, "yrc", lineIndex);
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
          readYrcWords(row.body, lineIndex + 1, row.begin, row.end),
          "yrc",
          lineIndex + 1
        ),
        `${id}w`
      ),
    });
  }
  if (lines.length === 0) {
    throw new ParseError("input contains no recognizable yrc lyric lines");
  }
  return lines;
}

export function read(text: string): LyricsDocument {
  const songwriters: string[] = [];
  const tags = new Map<string, string>();
  const lines = readLines(text, songwriters, tags);
  const { meta, offset } = readTagMeta(tags, "yrc");
  for (const songwriter of meta.songwriters ?? []) {
    if (!songwriters.includes(songwriter)) {
      songwriters.push(songwriter);
    }
  }
  return shiftTimes(
    {
      agents: [],
      lines,
      meta: {
        ...meta,
        ...(songwriters.length > 0 && { songwriters }),
      },
      timing: "word",
      version: 1,
    },
    offset,
    "yrc"
  );
}

function metaProblems(meta: LyricsMeta) {
  const { songwriters } = meta;
  const many = songwriters !== undefined && songwriters.length > 1;
  return [
    ...textProblems(meta, "yrc"),
    ...(songwriters === undefined
      ? []
      : songwriterProblems(
          [
            [
              songwriters.length === 0,
              "cannot represent an empty songwriter list",
            ],
            [
              songwriters.some((name) => name.length === 0),
              "cannot represent an empty songwriter name",
            ],
            [
              many && songwriters.some((name) => name.includes("/")),
              "cannot preserve this songwriter name",
            ],
            [
              many && new Set(songwriters).size !== songwriters.length,
              "requires unique songwriter names",
            ],
          ],
          "yrc"
        )),
  ];
}

export function losses(doc: LyricsDocument): ConversionLoss[] {
  return findLosses(doc, capabilities, (lyric) =>
    metaProblems(lyric.meta).map((problem) => problem.loss)
  );
}

function projectedSongwriters(meta: LyricsMeta) {
  const { songwriters } = meta;
  const [first] = songwriters ?? [];
  if (songwriters === undefined || first === undefined) {
    return;
  }
  if (songwriters.length > 1 && metaProblems({ songwriters }).length === 0) {
    return songwriters;
  }
  const clean = songwriters.find(
    (name) =>
      name.length > 0 &&
      name.trim() === name &&
      !name.includes("/") &&
      !lineBreak.test(name)
  );
  const selected =
    songwriters.length === 1
      ? normalizedTagText(first)
      : normalizedTagText(clean ?? first).replaceAll("/", "");
  return selected.length === 0 ? undefined : [selected];
}

function project(doc: LyricsDocument): LyricsDocument {
  const { songwriters, ...meta } = projectedTagMeta(doc.meta);
  const projected = projectedSongwriters(doc.meta);
  return projectedDocument(
    doc,
    capabilities,
    projectedLines(doc, capabilities, keepsWordTiming(doc, capabilities)),
    { ...meta, ...(projected !== undefined && { songwriters: projected }) }
  );
}

function writeRow(line: LyricsLine) {
  const duration = line.end - line.begin;
  checkTime(duration, `line ${line.id} duration`);
  return `[${line.begin},${duration}]${line.p
    .map((syllable) => {
      const syllableDuration = syllable.end - syllable.begin;
      checkTime(syllableDuration, `syllable ${syllable.id} duration`);
      return `(${syllable.begin},${syllableDuration},0)${syllable.text}`;
    })
    .join("")}`;
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const doc = prepare(source, options, "yrc", losses, project);
  checkLines(doc, "yrc");
  checkWrite(doc, "yrc", capabilities);
  for (const line of doc.lines) {
    for (const syllable of line.p) {
      checkText(syllable.text, "yrc", yrcMark);
    }
  }
  const tags = writeTags(doc.meta, metaProblems(doc.meta));
  const { songwriters } = doc.meta;
  return [
    ...(songwriters !== undefined && songwriters.length > 1
      ? [
          JSON.stringify({
            c: [{ tx: "作词: " }, { tx: songwriters.join("/") }],
            t: 0,
          }),
        ]
      : []),
    ...tags,
    ...doc.lines.map(writeRow),
  ].join("\n");
}
