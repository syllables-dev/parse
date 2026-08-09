/**
 * LYS (Lyricify Syllable), Lyricify's word-by-word format.
 * by Lyricify / WXRIW
 *
 * [4]Hel(12000,400)lo (12400,300)world(12700,600)
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

interface LysRow {
  agent: string | null;
  begin: number;
  end: number;
  property: number;
  words: TimedWord[];
  wrapped: boolean;
}

const metaTag = /^\[([A-Za-z]+):(.*)\]$/u;
const lineHeader = /^\[(\d+)\](.*)$/u;
const whitespace = /^\s+$/u;
const propertyAgents = [null, "v1", "v2", null, "v1", "v2", null, "v1", "v2"];

export const capabilities = {
  agents: true,
  backing: true,
  pronunciation: false,
  translation: false,
  wordTiming: true,
} satisfies FormatCapabilities;

function makeTrack(
  words: TimedWord[],
  lineId: string,
  track: "b" | "w",
  firstIndex = 0
): Syllable[] {
  return words.map((word, wordIndex) => ({
    begin: word.begin,
    end: word.end,
    id: `${lineId}${track}${firstIndex + wordIndex}`,
    text: word.text,
  }));
}

function readRow(
  raw: string,
  lineIndex: number,
  tags: Map<string, string>
): LysRow | null {
  const metadata = metaTag.exec(raw.trim());
  if (metadata) {
    const colon = metadata[0].indexOf(":");
    tags.set(
      metadata[0].slice(1, colon).toLowerCase(),
      metadata[0].slice(colon + 1, -1).trim()
    );
    return null;
  }
  const header = lineHeader.exec(raw);
  if (!header) {
    if (raw.trim().length > 0 && raw.startsWith("[")) {
      throw new ParseError(`malformed lys line ${lineIndex + 1}`);
    }
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
  const words = readTimedWords(body, lineIndex + 1, 0, 0);
  if (words.length === 0) {
    throw new ParseError(`lys line ${lineIndex + 1} has no timed syllables`);
  }
  const lyric = words.map((word) => word.text).join("");
  return {
    agent: propertyAgents[property] ?? null,
    begin: Math.min(...words.map((word) => word.begin)),
    end: Math.max(...words.map((word) => word.end)),
    property,
    words,
    wrapped:
      (lyric.startsWith("(") && lyric.endsWith(")")) ||
      (lyric.startsWith("（") && lyric.endsWith("）")),
  };
}

function readRows(text: string, tags: Map<string, string>): LysRow[] {
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
  return rows;
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
      mainLine.b.push(...makeTrack(words, mainLine.id, "b", mainLine.b.length));
      continue;
    }

    const lineId = `l${rowIndex}`;
    lines.push({
      agent: row.agent,
      b: isBacking ? makeTrack(words, lineId, "b") : [],
      begin: row.begin,
      end: row.end,
      id: lineId,
      p: isBacking ? [] : makeTrack(words, lineId, "w"),
    });
  }
  return lines;
}

export function read(text: string, options: ReadOptions = {}): LyricsDocument {
  if (options.expandRepeats) {
    throw new Error("expandRepeats is available for lrc input");
  }
  const tags = new Map<string, string>();
  const lines = makeLines(readRows(text, tags));
  const album = tags.get("al");
  const artist = tags.get("ar");
  const songwriter = tags.get("au");
  const title = tags.get("ti");
  const agents: LyricsDocument["agents"] = [];
  if (lines.some((line) => line.agent === "v1")) {
    agents.push({ id: "v1", type: "person" });
  }
  if (lines.some((line) => line.agent === "v2")) {
    agents.push({ id: "v2", type: "person" });
  }
  const meta: LyricsMeta = {
    ...(album !== undefined && { album }),
    ...(artist !== undefined && { artist }),
    ...(songwriter !== undefined && { songwriters: [songwriter] }),
    ...(title !== undefined && { title }),
  };
  return {
    agents,
    lines,
    meta,
    timing: "word",
    version: 1,
  };
}

function writeWords(syllables: Syllable[], wrap: boolean): string {
  return syllables
    .map((syllable, wordIndex) => {
      const duration = syllable.end - syllable.begin;
      checkTime(duration, `syllable ${syllable.id} duration`);
      const prefix = wrap && wordIndex === 0 ? "(" : "";
      const suffix = wrap && wordIndex === syllables.length - 1 ? ")" : "";
      return `${prefix}${syllable.text}${suffix}(${syllable.begin},${duration})`;
    })
    .join("");
}

function writeRow(property: number, syllables: Syllable[], wrap: boolean) {
  return `[${property}]${writeWords(syllables, wrap)}`;
}

export function write(doc: LyricsDocument, options: WriteOptions = {}): string {
  if (Object.keys(options).length > 0) {
    throw new Error("lys write options are unsupported");
  }
  checkWrite(doc, "lys", capabilities);
  const agentIds = doc.agents.map((agent) => agent.id);
  if (agentIds.length > 2) {
    throw new Error("lys supports up to two vocal agents");
  }
  if (new Set(agentIds).size !== agentIds.length) {
    throw new Error("lys requires unique vocal agent ids");
  }
  if (
    doc.lines.some(
      (line) => line.agent !== null && !agentIds.includes(line.agent)
    )
  ) {
    throw new Error("lys lines must reference declared vocal agents");
  }
  const lyricRows = doc.lines.flatMap((line) => {
    const syllables = [...line.p, ...line.b];
    if (syllables.length === 0) {
      throw new Error(`lys cannot represent empty line ${line.id}`);
    }
    const begin = Math.min(...syllables.map((syllable) => syllable.begin));
    const end = Math.max(...syllables.map((syllable) => syllable.end));
    if (begin !== line.begin || end !== line.end) {
      throw new Error(`lys cannot represent the range of line ${line.id}`);
    }
    const side = line.agent === null ? 0 : agentIds.indexOf(line.agent) + 1;
    return [
      ...(line.p.length > 0 ? [writeRow(side + 3, line.p, false)] : []),
      ...(line.b.length > 0 ? [writeRow(side + 6, line.b, true)] : []),
    ];
  });
  return ["[by:]", ...lyricRows].join("\n");
}
