import { ParseError } from "@/errors";
import { read as readLrc, writeAlignedRows } from "@/formats/lrc";
import { read as readLys, write as writeLys } from "@/formats/lys";
import { readTag, writeTags } from "@/internal/lyric-tags";
import { prepare } from "@/internal/projections";
import { readOffset, shiftTimes, splitLines } from "@/internal/timestamps";
import { checkLines, checkText, checkWrite } from "@/internal/write-check";
import type {
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
  ReadOptions,
  WriteOptions,
} from "@/types";

type SectionKind = "lyrics" | "pronunciation" | "translation";

interface LqeSection {
  attributes: Map<string, string>;
  body: string[];
  kind: SectionKind;
}

interface TranslationTarget {
  line: LyricsLine;
  track: "b" | "p";
}

interface TranslationRow {
  begin: number;
  text: string;
}

const containerMark = "[Lyricify Quick Export]";
const sectionHeader = /^\[([A-Za-z]+):\s*(.*)\]$/u;
const lrcRow = /^(?:\[\d+:\d{1,2}(?:[.:]\d{1,3})?\])+/u;
const lysRow = /^\[\d+\]/u;
const languageTag = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u;
const lrcReservedStamp = /<\d+:\d{1,2}(?:[.:]\d{1,3})?>/u;
const lysReservedStamp = /\(\d+,\d+\)/u;
const offsetTag = /^\[offset:.*\]$/iu;
const supportedMetadata = new Set(["al", "ar", "au", "by", "offset", "ti"]);
const wrappingParens = /^(?:\((.*)\)|（(.*)）)$/su;

export const capabilities = {
  agents: "alignment",
  backing: true,
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
  translation: true,
} satisfies FormatCapabilities;

function isSection(name: string | undefined): name is SectionKind {
  return (
    name === "lyrics" || name === "pronunciation" || name === "translation"
  );
}

function matchHeader(line: string): [string, string] | null {
  const header = sectionHeader.exec(line);
  if (!header) {
    return null;
  }
  return [header[0], header[0].slice(1, header[0].indexOf(":"))];
}

function readPreamble(lines: string[], firstLine: number) {
  const metadata = new Map<string, string>();
  let version: string | undefined;
  for (const [lineIndex, raw] of lines.entries()) {
    if (lineIndex <= firstLine) {
      continue;
    }
    const header = matchHeader(raw.trim());
    const name = header ? header[1].toLowerCase() : undefined;
    if (isSection(name)) {
      return { lineIndex, metadata, version };
    }
    if (raw.trim().length === 0) {
      continue;
    }
    const tag = readTag(raw);
    if (!tag) {
      throw new ParseError(`unsupported lqe header on line ${lineIndex + 1}`);
    }
    if (tag.name === "version") {
      if (version !== undefined) {
        throw new ParseError("lqe contains duplicate version tags");
      }
      version = tag.text.trim();
      continue;
    }
    if (supportedMetadata.has(tag.name)) {
      metadata.set(tag.name, tag.text);
      continue;
    }
    throw new ParseError(`unsupported lqe header on line ${lineIndex + 1}`);
  }
  return { lineIndex: lines.length, metadata, version };
}

function readSection(header: string, kind: SectionKind, lineNumber: number) {
  const attributes = new Map<string, string>();
  for (const rawAttribute of header
    .slice(header.indexOf(":") + 1, -1)
    .trim()
    .split(",")) {
    const separator = rawAttribute.indexOf("@");
    if (separator < 1 || separator === rawAttribute.length - 1) {
      throw new ParseError(
        `malformed lqe section header on line ${lineNumber}`
      );
    }
    const key = rawAttribute.slice(0, separator).trim().toLowerCase();
    const value = rawAttribute.slice(separator + 1).trim();
    if (attributes.has(key)) {
      throw new ParseError(
        `duplicate lqe ${key} attribute on line ${lineNumber}`
      );
    }
    attributes.set(key, value);
  }
  return { attributes, body: [], kind };
}

function readSections(lines: string[], firstLine: number) {
  const sections: LqeSection[] = [];
  let section: LqeSection | undefined;
  for (const [lineIndex, raw] of lines.entries()) {
    if (lineIndex < firstLine) {
      continue;
    }
    const header = matchHeader(raw.trim());
    if (header) {
      const name = header[1].toLowerCase();
      if (isSection(name)) {
        section = readSection(header[0], name, lineIndex + 1);
        sections.push(section);
        continue;
      }
      if (!supportedMetadata.has(name)) {
        throw new ParseError(
          `unsupported lqe section on line ${lineIndex + 1}`
        );
      }
    }
    if (section) {
      section.body.push(raw);
    } else if (raw.trim().length > 0) {
      throw new ParseError(`malformed lqe content on line ${lineIndex + 1}`);
    }
  }
  return sections;
}

function checkBody(lines: string[], row: RegExp, kind: string) {
  for (const [lineIndex, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || row.test(trimmed)) {
      continue;
    }
    if (!offsetTag.test(trimmed)) {
      throw new ParseError(`malformed lqe ${kind} row ${lineIndex + 1}`);
    }
  }
}

function readTranslation(section: LqeSection) {
  if (
    (section.attributes.size !== 1 && section.attributes.size !== 2) ||
    section.attributes.get("format")?.toLowerCase() !== "lrc" ||
    [...section.attributes.keys()].some(
      (key) => key !== "format" && key !== "language"
    )
  ) {
    throw new ParseError("lqe translation must use LRC format");
  }
  const language = section.attributes.get("language") ?? "und";
  if (!languageTag.test(language)) {
    throw new ParseError("lqe translation language is invalid");
  }
  const body = section.body.filter((line) => !offsetTag.test(line.trim()));
  checkBody(body, lrcRow, "translation");
  return {
    language,
    lines: readLrc(body.join("\n"), { expandRepeats: true }).lines,
  };
}

function addTranslation(
  section: LqeSection,
  targets: Map<number, TranslationTarget[]>,
  assigned: Map<LyricsLine, Set<string>>
) {
  const { language, lines } = readTranslation(section);
  const consumed = new Map<number, number>();
  for (const translationLine of lines) {
    const queue = targets.get(translationLine.begin);
    const index = consumed.get(translationLine.begin) ?? 0;
    const target = queue?.at(index);
    if (target === undefined) {
      throw new ParseError(
        `lqe translation tag ${translationLine.begin} has no lyric track`
      );
    }
    consumed.set(translationLine.begin, index + 1);
    const track = `${language}:${target.track}`;
    const lineTracks = assigned.get(target.line) ?? new Set<string>();
    if (lineTracks.has(track)) {
      throw new ParseError(
        `lqe has duplicate ${language} translation for tag ${translationLine.begin}`
      );
    }
    lineTracks.add(track);
    assigned.set(target.line, lineTracks);
    const existing = target.line.translations?.[language];
    const text = translationLine.p.map((syllable) => syllable.text).join("");
    const wrapped = wrappingParens.exec(text);
    target.line.translations = {
      ...target.line.translations,
      [language]: {
        p: existing === undefined ? "" : existing.p,
        ...(existing?.b !== undefined && { b: existing.b }),
        ...(target.track === "p"
          ? { p: text }
          : { b: wrapped ? wrapped[0].slice(1, -1) : text }),
      },
    };
  }
}

function readTracks(
  sections: LqeSection[],
  metadata: Map<string, string>
): LyricsDocument {
  const lyricSections = sections.filter((section) => section.kind === "lyrics");
  const lyricSection = lyricSections.at(0);
  if (!lyricSection || lyricSections.length !== 1) {
    throw new ParseError("lqe must contain exactly one lyrics section");
  }
  if (
    lyricSection.attributes.size !== 1 ||
    lyricSection.attributes.get("format")?.toLowerCase() !== "lyricify syllable"
  ) {
    throw new ParseError("lqe lyrics must use Lyricify Syllable format");
  }
  const metadataLines = [...metadata]
    .filter(([tag]) => tag !== "offset")
    .map(([tag, value]) => `[${tag}:${value}]`);
  checkBody(lyricSection.body, lysRow, "lyrics");
  const doc = readLys(
    [
      ...metadataLines,
      ...lyricSection.body.filter((line) => !offsetTag.test(line.trim())),
    ].join("\n")
  );
  const targets = new Map<number, TranslationTarget[]>();
  for (const line of doc.lines) {
    const primaryBegin = line.p[0]?.begin;
    if (primaryBegin !== undefined) {
      const queue = targets.get(primaryBegin) ?? [];
      queue.push({ line, track: "p" });
      targets.set(primaryBegin, queue);
    }
    const backingBegin = line.b[0]?.begin;
    if (backingBegin !== undefined) {
      const queue = targets.get(backingBegin) ?? [];
      queue.push({ line, track: "b" });
      targets.set(backingBegin, queue);
    }
  }
  const assigned = new Map<LyricsLine, Set<string>>();
  for (const section of sections) {
    if (section.kind === "translation") {
      addTranslation(section, targets, assigned);
    }
  }
  const languages = [
    ...new Set(
      doc.lines.flatMap((line) => Object.keys(line.translations ?? {}))
    ),
  ];
  return {
    ...doc,
    ...(languages.length > 0 && {
      translationTracks: Object.fromEntries(
        languages.map((language) => [language, { kind: "subtitle" }])
      ),
    }),
  };
}

export function read(text: string, options: ReadOptions = {}): LyricsDocument {
  if (options.expandRepeats) {
    throw new Error("expandRepeats is available for lrc input");
  }
  const lines = splitLines(text);
  const firstLine = lines.findIndex((line) => line.trim().length > 0);
  if (lines.at(firstLine)?.trim() !== containerMark) {
    throw new ParseError("input is missing the lqe container header");
  }
  const { lineIndex, metadata, version } = readPreamble(lines, firstLine);
  if (version !== "1.0") {
    throw new ParseError("lqe version must be 1.0");
  }
  const doc = readTracks(readSections(lines, lineIndex), metadata);
  const offsetText = metadata.get("offset");
  const offset = offsetText === undefined ? 0 : readOffset(offsetText, "lqe");
  return shiftTimes(doc, offset, "lqe");
}

function addRow(
  rows: TranslationRow[],
  syllables: LyricsLine["p"],
  text: string,
  lineId: string,
  track: "backing" | "primary"
) {
  const firstSyllable = syllables.at(0);
  if (!firstSyllable) {
    if (text.length > 0 || track === "backing") {
      throw new Error(
        `lqe cannot place ${track} translation for line ${lineId}`
      );
    }
    return;
  }
  rows.push({
    begin: firstSyllable.begin,
    text: track === "backing" ? `(${text})` : text,
  });
}

function translationDoc(doc: LyricsDocument, language: string): LyricsDocument {
  const rows: TranslationRow[] = [];
  for (const line of doc.lines) {
    const translation = line.translations?.[language];
    addRow(rows, line.p, translation?.p ?? "", line.id, "primary");
    if (translation?.b !== undefined) {
      addRow(rows, line.b, translation.b, line.id, "backing");
    }
  }
  return {
    agents: [],
    lines: rows.map((row, lineIndex) => {
      const end = rows[lineIndex + 1]?.begin ?? row.begin + 5000;
      return {
        agent: null,
        b: [],
        begin: row.begin,
        end,
        id: `l${lineIndex}`,
        p: [
          {
            begin: row.begin,
            end,
            id: `l${lineIndex}w0`,
            text: row.text,
          },
        ],
      };
    }),
    meta: {},
    timing: "line",
    version: 1,
  };
}

function checkDoc(doc: LyricsDocument) {
  checkLines(doc, "lqe");
  checkWrite(doc, "lqe", capabilities);
  if (
    Object.values(doc.translationTracks ?? {}).some(
      (track) => track.kind === "replacement"
    )
  ) {
    throw new Error("lqe cannot represent replacement translations");
  }
  if (
    Object.values(doc.translationTracks ?? {}).some(
      (track) => track.automaticallyCreated !== undefined
    )
  ) {
    throw new Error("lqe cannot represent automaticallyCreated translations");
  }
  if (
    Object.keys(doc.translationTracks ?? {}).some(
      (language) =>
        !doc.lines.some((line) => line.translations?.[language] !== undefined)
    )
  ) {
    throw new Error("lqe cannot represent an empty translation track");
  }
  for (const line of doc.lines) {
    for (const syllable of [...line.p, ...line.b]) {
      checkText(syllable.text, "lqe", lysReservedStamp);
    }
    for (const translation of Object.values(line.translations ?? {})) {
      checkText(translation.p, "lqe", lrcReservedStamp);
      if (translation.b !== undefined) {
        checkText(translation.b, "lqe", lrcReservedStamp);
      }
    }
    if (line.p.length === 0 && line.b.length > 0) {
      throw new Error(`lqe cannot preserve backing-only line ${line.id}`);
    }
  }
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const doc = prepare(source, capabilities, "lqe", options);
  checkDoc(doc);
  const sections = [
    containerMark,
    "[version:1.0]",
    ...writeTags(doc.meta, "lqe", "author-first"),
    "",
    "[lyrics: format@Lyricify Syllable]",
    writeLys({
      ...doc,
      lines: doc.lines.map((line) => ({
        agent: line.agent,
        b: line.b,
        begin: line.begin,
        end: line.end,
        id: line.id,
        p: line.p,
      })),
      meta: {},
    })
      .split("\n")
      .slice(1)
      .join("\n"),
  ];
  const languages = [
    ...new Set(
      doc.lines.flatMap((line) => Object.keys(line.translations ?? {}))
    ),
  ].sort();
  for (const language of languages) {
    if (!languageTag.test(language)) {
      throw new Error(`invalid lqe translation language ${language}`);
    }
    sections.push(
      "",
      `[translation: ${
        language === "und" ? "" : `language@${language}, `
      }format@LRC]`,
      writeAlignedRows(translationDoc(doc, language))
        .split("\n")
        .slice(1)
        .join("\n")
    );
  }
  return sections.join("\n");
}
