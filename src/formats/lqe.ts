/**
 * LQE (Lyricify Quick Export), Lyricify's container for a lyric track and its translations.
 * by Lyricify / WXRIW
 *
 * [Lyricify Quick Export]
 * [version:1.0]
 *
 * [lyrics: format@Lyricify Syllable]
 * [4]Hel(12000,400)lo(12400,600)
 *
 * [translation: language@fr, format@LRC]
 * [00:12.000]Bonjour
 */

import { ParseError } from "@/errors";
import { read as readLrc } from "@/formats/lrc";
import { read as readLys } from "@/formats/lys";
import { fittedLines, rangeLosses, writeRows } from "@/formats/lys/rows";
import { isLanguageTag } from "@/internal/language-tag";
import {
  projectedTagMeta,
  readTag,
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
import { projectedLines } from "@/internal/projections/line";
import {
  clockStamp,
  readOffset,
  shiftTimes,
  splitLines,
  writeStamp,
} from "@/internal/timestamps";
import { checkLines, checkText, checkWrite } from "@/internal/write-check";
import type {
  ConversionLoss,
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
  LyricsTranslation,
  LyricsTranslationTrack,
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

export const containerMark = "[Lyricify Quick Export]";
const sectionHeader = /^\[([A-Za-z]+):\s*(.*)\]$/u;
const lrcRow = new RegExp(String.raw`^(?:\[${clockStamp}\])+`, "u");
const lysRow = /^\[\d+\]/u;
const lrcReservedStamp = new RegExp(`<${clockStamp}>`, "u");
const offsetTag = /^\[offset:.*\]$/iu;
// by parses as a tag so it is not a malformed line, then goes nowhere: the schema has no author
const supportedMetadata = new Set(["al", "ar", "au", "by", "offset", "ti"]);

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
  if (!isLanguageTag(language)) {
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
    target.line.translations = {
      ...target.line.translations,
      [language]: {
        p: existing === undefined ? "" : existing.p,
        ...(existing?.b !== undefined && { b: existing.b }),
        ...(target.track === "p" ? { p: text } : { b: text }),
      },
    };
  }
}

function languagesOf(lines: LyricsLine[]) {
  return [
    ...new Set(lines.flatMap((line) => Object.keys(line.translations ?? {}))),
  ];
}

function subtitleTracks(lines: LyricsLine[]) {
  const languages = languagesOf(lines);
  if (languages.length === 0) {
    return;
  }
  return Object.fromEntries(
    languages.map((language): [string, LyricsTranslationTrack] => [
      language,
      { kind: "subtitle" },
    ])
  );
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
  const translationTracks = subtitleTracks(doc.lines);
  return {
    ...doc,
    ...(translationTracks !== undefined && { translationTracks }),
  };
}

export function read(text: string): LyricsDocument {
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
  return shiftTimes(doc, readOffset(metadata.get("offset"), "lqe"), "lqe");
}

function placementProblems(line: LyricsLine, translation: LyricsTranslation) {
  return [
    ...(line.p.length === 0 && translation.p.length > 0
      ? [`lqe cannot place primary translation for line ${line.id}`]
      : []),
    ...(translation.b !== undefined && line.b.length === 0
      ? [`lqe cannot place backing translation for line ${line.id}`]
      : []),
  ];
}

function translationProblems(doc: LyricsDocument) {
  const tracks = Object.values(doc.translationTracks ?? {});
  const languages = new Set(languagesOf(doc.lines));
  return [
    ...(tracks.some((track) => track.kind === "replacement")
      ? ["lqe cannot represent replacement translations"]
      : []),
    ...(tracks.some((track) => track.automaticallyCreated !== undefined)
      ? ["lqe cannot represent automaticallyCreated translations"]
      : []),
    ...(Object.keys(doc.translationTracks ?? {}).some(
      (language) => !languages.has(language)
    )
      ? ["lqe cannot represent an empty translation track"]
      : []),
    ...doc.lines.flatMap((line) =>
      Object.values(line.translations ?? {}).flatMap((translation) =>
        placementProblems(line, translation)
      )
    ),
  ];
}

export function losses(doc: LyricsDocument): ConversionLoss[] {
  return findLosses(doc, capabilities, (lyric) => [
    ...tagProblems(lyric.meta, "lqe").map((problem) => problem.loss),
    ...rangeLosses(lyric),
    ...lostIf(
      "translations",
      lyric.lines.some(
        (line) => line.p.length === 0 && line.translations !== undefined
      ) ||
        translationProblems({ ...lyric, lines: fittedLines(lyric) }).length > 0
    ),
  ]);
}

function placedTranslations(line: LyricsLine): LyricsLine {
  const { translations } = line;
  if (translations === undefined) {
    return line;
  }
  return {
    ...line,
    translations: Object.fromEntries(
      Object.entries(translations).map(([language, translation]) => [
        language,
        {
          ...(translation.b !== undefined &&
            line.b.length > 0 && { b: translation.b }),
          p: translation.p,
        },
      ])
    ),
  };
}

function project(doc: LyricsDocument): LyricsDocument {
  const lines = projectedLines(
    { ...doc, lines: fittedLines(doc) },
    capabilities,
    keepsWordTiming(doc, capabilities)
  ).map(placedTranslations);
  const { translationTracks: _, ...projected } = projectedDocument(
    doc,
    capabilities,
    lines,
    projectedTagMeta(doc.meta)
  );
  const translationTracks = subtitleTracks(lines);
  return {
    ...projected,
    ...(translationTracks !== undefined && { translationTracks }),
  };
}

function translationRows(doc: LyricsDocument, language: string) {
  return doc.lines.flatMap((line) => {
    const translation = line.translations?.[language];
    const [primary] = line.p;
    const [backing] = line.b;
    return [
      ...(primary === undefined
        ? []
        : [`[${writeStamp(primary.begin)}]${translation?.p ?? ""}`]),
      ...(backing === undefined || translation?.b === undefined
        ? []
        : [`[${writeStamp(backing.begin)}]${translation.b}`]),
    ];
  });
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const doc = prepare(source, options, "lqe", losses, project);
  checkLines(doc, "lqe");
  checkWrite(doc, "lqe", capabilities);
  const [problem] = translationProblems(doc);
  if (problem !== undefined) {
    throw new Error(problem);
  }
  for (const line of doc.lines) {
    for (const translation of Object.values(line.translations ?? {})) {
      checkText(translation.p, "lqe", lrcReservedStamp);
      if (translation.b !== undefined) {
        checkText(translation.b, "lqe", lrcReservedStamp);
      }
    }
  }
  const rows = writeRows(doc, "lqe");
  const sections = [
    containerMark,
    "[version:1.0]",
    ...writeTags(doc.meta, tagProblems(doc.meta, "lqe")),
    "",
    "[lyrics: format@Lyricify Syllable]",
    ...rows,
  ];
  for (const language of languagesOf(doc.lines).sort()) {
    if (!isLanguageTag(language)) {
      throw new Error(`invalid lqe translation language ${language}`);
    }
    sections.push(
      "",
      `[translation: ${
        language === "und" ? "" : `language@${language}, `
      }format@LRC]`,
      ...translationRows(doc, language)
    );
  }
  return sections.join("\n");
}
