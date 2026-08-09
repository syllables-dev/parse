import { ParseError } from "../errors";
import { splitLines } from "../internal/timestamps";
import { checkWrite } from "../internal/write-check";
import type {
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
  ReadOptions,
  WriteOptions,
} from "../types";
import { read as readLrc, write as writeLrc } from "./lrc";
import { read as readLys, write as writeLys } from "./lys";

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
const metadataHeader = /^\[([A-Za-z]+):(.*)\]$/u;
const lrcRow = /^(?:\[\d+:\d{1,2}(?:[.:]\d{1,3})?\])+/u;
const lysRow = /^\[\d+\]/u;
const languageTag = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u;
const offsetTag = /^\[offset:.*\]$/iu;
const supportedMetadata = new Set(["al", "ar", "au", "by", "offset", "ti"]);
const wrappingParens = /^(?:\((.*)\)|（(.*)）)$/su;

export const capabilities = {
  agents: true,
  backing: true,
  pronunciation: false,
  translation: true,
  wordTiming: true,
} satisfies FormatCapabilities;

function isSection(name: string | undefined): name is SectionKind {
  return (
    name === "lyrics" || name === "pronunciation" || name === "translation"
  );
}

function readPreamble(lines: string[], firstLine: number) {
  const metadata = new Map<string, string>();
  let version: string | undefined;
  for (
    let lineIndex = firstLine + 1;
    lineIndex < lines.length;
    lineIndex += 1
  ) {
    const raw = lines[lineIndex] ?? "";
    const header = sectionHeader.exec(raw.trim());
    const name = header
      ? header[0].slice(1, header[0].indexOf(":")).toLowerCase()
      : undefined;
    if (isSection(name)) {
      return { lineIndex, metadata, version };
    }
    if (raw.trim().length === 0) {
      continue;
    }
    const tag = metadataHeader.exec(raw.trim());
    if (tag) {
      const colon = tag[0].indexOf(":");
      const tagName = tag[0].slice(1, colon).toLowerCase();
      const value = tag[0].slice(colon + 1, -1).trim();
      if (tagName === "version") {
        if (version !== undefined) {
          throw new ParseError("lqe contains duplicate version tags");
        }
        version = value;
        continue;
      }
      if (supportedMetadata.has(tagName)) {
        metadata.set(tagName, value);
        continue;
      }
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
  for (let lineIndex = firstLine; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex] ?? "";
    const header = sectionHeader.exec(raw.trim());
    if (header) {
      const colon = header[0].indexOf(":");
      const name = header[0].slice(1, colon).toLowerCase();
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
    const header = metadataHeader.exec(trimmed);
    const tag = header
      ? header[0].slice(1, header[0].indexOf(":")).toLowerCase()
      : undefined;
    if (!(tag && supportedMetadata.has(tag))) {
      throw new ParseError(`malformed lqe ${kind} row ${lineIndex + 1}`);
    }
  }
}

function addTranslation(
  section: LqeSection,
  targets: Map<number, TranslationTarget | null>,
  assigned: Map<LyricsLine, Set<string>>
) {
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
  for (const translationLine of readLrc(body.join("\n"), {
    expandRepeats: true,
  }).lines) {
    const target = targets.get(translationLine.begin);
    if (target === undefined) {
      throw new ParseError(
        `lqe translation tag ${translationLine.begin} has no lyric track`
      );
    }
    if (target === null) {
      throw new ParseError(
        `lqe translation tag ${translationLine.begin} is ambiguous`
      );
    }
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
        p: existing?.p ?? "",
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
  const doc = readLys([...metadataLines, ...lyricSection.body].join("\n"));
  const targets = new Map<number, TranslationTarget | null>();
  for (const line of doc.lines) {
    const primaryBegin = line.p[0]?.begin;
    if (primaryBegin !== undefined) {
      targets.set(
        primaryBegin,
        targets.has(primaryBegin) ? null : { line, track: "p" }
      );
    }
    const backingBegin = line.b[0]?.begin;
    if (backingBegin !== undefined) {
      targets.set(
        backingBegin,
        targets.has(backingBegin) ? null : { line, track: "b" }
      );
    }
  }
  const assigned = new Map<LyricsLine, Set<string>>();
  for (const section of sections) {
    if (section.kind === "translation") {
      addTranslation(section, targets, assigned);
    }
  }
  return doc;
}

export function read(text: string, options: ReadOptions = {}): LyricsDocument {
  if (options.expandRepeats) {
    throw new Error("expandRepeats is available for lrc input");
  }
  const lines = splitLines(text);
  const firstLine = lines.findIndex((line) => line.trim().length > 0);
  if (firstLine < 0 || lines[firstLine]?.trim() !== containerMark) {
    throw new ParseError("input is missing the lqe container header");
  }
  const { lineIndex, metadata, version } = readPreamble(lines, firstLine);
  if (version !== "1.0") {
    throw new ParseError("lqe version must be 1.0");
  }
  return readTracks(readSections(lines, lineIndex), metadata);
}

function addRow(
  rows: TranslationRow[],
  syllables: LyricsLine["p"],
  text: string | undefined,
  lineId: string,
  track: "backing" | "primary"
) {
  if (text === undefined) {
    return;
  }
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
    if (!translation) {
      continue;
    }
    addRow(rows, line.p, translation.p, line.id, "primary");
    addRow(rows, line.b, translation.b, line.id, "backing");
  }
  rows.sort((left, right) => left.begin - right.begin);
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    if (rows[rowIndex]?.begin === rows[rowIndex - 1]?.begin) {
      throw new Error(
        `lqe cannot disambiguate translation tag ${rows[rowIndex]?.begin}`
      );
    }
  }
  return {
    agents: [],
    lines: rows.map((row, lineIndex) => ({
      agent: null,
      b: [],
      begin: row.begin,
      end: rows[lineIndex + 1]?.begin ?? row.begin + 5000,
      id: `l${lineIndex}`,
      p: [
        {
          begin: row.begin,
          end: rows[lineIndex + 1]?.begin ?? row.begin + 5000,
          id: `l${lineIndex}w0`,
          text: row.text,
        },
      ],
    })),
    meta: {},
    timing: "line",
    version: 1,
  };
}

export function write(doc: LyricsDocument, options: WriteOptions = {}): string {
  if (Object.keys(options).length > 0) {
    throw new Error("lqe write options are unsupported");
  }
  checkWrite(doc, "lqe", capabilities);
  const sections = [
    containerMark,
    "[version:1.0]",
    "[by:]",
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
      writeLrc(translationDoc(doc, language)).split("\n").slice(1).join("\n")
    );
  }
  return sections.join("\n");
}
