import { ParseError } from "../../errors";
import type { XmlElement, XmlNode } from "../../internal/xml";
import type { LyricsDocument, LyricsLine } from "../../types";
import {
  checkTrack,
  readWords,
  splitRuns,
  untimed,
  unwrap,
  unwrapText,
} from "./lines";
import {
  attr,
  checkAttrs,
  elements,
  is,
  itunesUri,
  key,
  locale,
  needAttr,
  only,
  readOffset,
  readTime,
  text,
  ttmlUri,
  ttmUri,
  xmlUri,
} from "./profile";

export interface TtmlHead {
  agents: LyricsDocument["agents"];
  offset?: number;
  songwriters: string[];
  translations: XmlElement[];
  transliterations: XmlElement[];
}

function readAgent(declaration: XmlElement, ids: Set<string>) {
  checkAttrs(declaration, [
    key(null, "type"),
    key(itunesUri, "artistId"),
    key(xmlUri, "id"),
  ]);
  const id = needAttr(declaration, "id", xmlUri);
  if (id.length === 0 || ids.has(id)) {
    throw new ParseError(`invalid or duplicate ttml agent id ${id}`);
  }
  for (const name of elements(declaration)) {
    if (!is(name, "name", ttmUri)) {
      throw new ParseError(`unsupported agent child <${name.name}>`);
    }
    checkAttrs(name, [key(null, "type")]);
    text(name);
  }
  ids.add(id);
  return { id, type: needAttr(declaration, "type", null) };
}

function readAgents(metadata: XmlElement) {
  const agents: LyricsDocument["agents"] = [];
  const ids = new Set<string>();
  for (const declaration of elements(metadata)) {
    if (is(declaration, "agent", ttmUri)) {
      agents.push(readAgent(declaration, ids));
    }
  }
  return agents;
}

function readAudio(audio: XmlElement | undefined) {
  if (!audio) {
    return {};
  }
  checkAttrs(audio, [
    key(null, "lyricOffset"),
    key(null, "role"),
    key(null, "spatial"),
  ]);
  if (elements(audio).length > 0) {
    throw new ParseError("ttml audio metadata must be empty");
  }
  const value = attr(audio, "lyricOffset", null);
  return value === undefined ? {} : { offset: readOffset(value) };
}

function readWriters(container: XmlElement | undefined) {
  if (!container) {
    return [];
  }
  checkAttrs(container, []);
  return elements(container).map((writer) => {
    if (!is(writer, "songwriter", itunesUri)) {
      throw new ParseError(`unsupported songwriter child <${writer.name}>`);
    }
    checkAttrs(writer, [key(itunesUri, "artistId")]);
    return text(writer);
  });
}

function readAppleBody(apple: XmlElement): Omit<TtmlHead, "agents"> {
  const children = elements(apple);
  const writers = children.filter((child) =>
    is(child, "songwriters", itunesUri)
  );
  const audioBlocks = children.filter((child) => is(child, "audio", itunesUri));
  if (writers.length > 1 || audioBlocks.length > 1) {
    throw new ParseError("duplicate ttml metadata container");
  }
  const allowed = ["translations", "transliterations", "songwriters", "audio"];
  if (
    children.some(
      (child) => !allowed.some((local) => is(child, local, itunesUri))
    )
  ) {
    throw new ParseError("unsupported Apple lyric metadata element");
  }
  const [writerBlock] = writers;
  const [audio] = audioBlocks;
  return {
    ...readAudio(audio),
    songwriters: readWriters(writerBlock),
    translations: children.filter((child) =>
      is(child, "translations", itunesUri)
    ),
    transliterations: children.filter((child) =>
      is(child, "transliterations", itunesUri)
    ),
  };
}

function readApple(metadata: XmlElement): Omit<TtmlHead, "agents"> {
  const blocks = elements(metadata).filter((child) =>
    is(child, "iTunesMetadata", itunesUri)
  );
  if (blocks.length > 1) {
    throw new ParseError("ttml supports one iTunesMetadata block");
  }
  const [apple] = blocks;
  if (!apple) {
    return { songwriters: [], translations: [], transliterations: [] };
  }
  checkAttrs(apple, [key(null, "leadingSilence")]);
  const leading = attr(apple, "leadingSilence", null);
  if (leading !== undefined) {
    readTime(leading, "ttml leading silence");
  }
  return readAppleBody(apple);
}

export function readHead(root: XmlElement): TtmlHead {
  const head = only(root, "head", ttmlUri);
  checkAttrs(head, []);
  if (elements(head).some((child) => !is(child, "metadata", ttmlUri))) {
    throw new ParseError("ttml head supports one metadata child");
  }
  const metadata = only(head, "metadata", ttmlUri);
  checkAttrs(metadata, [key(itunesUri, "lyricGenId")]);
  for (const child of elements(metadata)) {
    if (
      !(is(child, "agent", ttmUri) || is(child, "iTunesMetadata", itunesUri))
    ) {
      throw new ParseError(`unsupported metadata element <${child.name}>`);
    }
  }
  return { agents: readAgents(metadata), ...readApple(metadata) };
}

function target(textLine: XmlElement, lineById: Map<string, LyricsLine>) {
  const direct = attr(textLine, "for", null);
  const legacy = attr(textLine, "key", itunesUri);
  if (direct !== undefined && legacy !== undefined && direct !== legacy) {
    throw new ParseError("conflicting ttml parallel text keys");
  }
  const id = direct ?? legacy;
  if (id === undefined) {
    throw new ParseError("ttml parallel text requires a line key");
  }
  const line = lineById.get(id);
  if (!line) {
    throw new ParseError(`ttml parallel text references unknown line ${id}`);
  }
  return line;
}

function addTranslation(
  textLine: XmlElement,
  language: string,
  lineById: Map<string, LyricsLine>
) {
  if (!is(textLine, "text", itunesUri)) {
    throw new ParseError(`unsupported translated child <${textLine.name}>`);
  }
  checkAttrs(textLine, [key(null, "for"), key(itunesUri, "key")]);
  const line = target(textLine, lineById);
  if (Object.hasOwn(line.translations ?? {}, language)) {
    throw new ParseError(
      `duplicate ${language} translation for line ${line.id}`
    );
  }
  const runs = splitRuns(textLine, line.agent);
  line.translations = {
    ...line.translations,
    [language]: {
      ...(runs.backing === null
        ? {}
        : { b: unwrapText(untimed(runs.backing, line.agent)) }),
      p: untimed(runs.primary, line.agent),
    },
  };
}

function readTranslation(
  translation: XmlElement,
  lineById: Map<string, LyricsLine>
) {
  if (!is(translation, "translation", itunesUri)) {
    throw new ParseError(
      `unsupported translation element <${translation.name}>`
    );
  }
  checkAttrs(translation, [key(null, "type"), key(xmlUri, "lang")]);
  const kind = needAttr(translation, "type", null);
  if (kind !== "subtitle" && kind !== "replacement") {
    throw new ParseError(`unsupported ttml translation type ${kind}`);
  }
  const language = locale(translation);
  for (const textLine of elements(translation)) {
    addTranslation(textLine, language, lineById);
  }
}

export function readTranslations(
  containers: XmlElement[],
  lines: LyricsLine[]
) {
  const lineById = new Map(lines.map((line) => [line.id, line]));
  for (const container of containers) {
    checkAttrs(container, []);
    for (const translation of elements(container)) {
      readTranslation(translation, lineById);
    }
  }
}

function readPronTrack(
  nodes: XmlNode[],
  line: LyricsLine,
  offset: number,
  idPrefix: string,
  backing: boolean
) {
  const syllables = readWords(
    nodes,
    line.begin,
    line.end,
    offset,
    idPrefix,
    line.agent
  );
  const track = backing ? unwrap(syllables) : syllables;
  checkTrack(track, line);
  return track;
}

function addPron(
  textLine: XmlElement,
  language: string,
  trackIndex: number,
  lineById: Map<string, LyricsLine>,
  offset: number
) {
  if (!is(textLine, "text", itunesUri)) {
    throw new ParseError(`unsupported transliterated child <${textLine.name}>`);
  }
  checkAttrs(textLine, [key(null, "for"), key(itunesUri, "key")]);
  const line = target(textLine, lineById);
  if (Object.hasOwn(line.pronunciations ?? {}, language)) {
    throw new ParseError(
      `duplicate ${language} pronunciation for line ${line.id}`
    );
  }
  const runs = splitRuns(textLine, line.agent);
  const prefix = `${line.id}r${trackIndex}`;
  line.pronunciations = {
    ...line.pronunciations,
    [language]: {
      b:
        runs.backing === null
          ? []
          : readPronTrack(runs.backing, line, offset, `${prefix}b`, true),
      p: readPronTrack(runs.primary, line, offset, `${prefix}w`, false),
    },
  };
}

function readPron(
  transliteration: XmlElement,
  trackIndex: number,
  lineById: Map<string, LyricsLine>,
  offset: number
) {
  if (!is(transliteration, "transliteration", itunesUri)) {
    throw new ParseError(
      `unsupported transliteration element <${transliteration.name}>`
    );
  }
  checkAttrs(transliteration, [key(xmlUri, "lang")]);
  const language = locale(transliteration);
  for (const textLine of elements(transliteration)) {
    addPron(textLine, language, trackIndex, lineById, offset);
  }
}

export function readProns(
  containers: XmlElement[],
  lines: LyricsLine[],
  offset: number
) {
  const lineById = new Map(lines.map((line) => [line.id, line]));
  let trackIndex = 0;
  for (const container of containers) {
    checkAttrs(container, []);
    for (const transliteration of elements(container)) {
      readPron(transliteration, trackIndex, lineById, offset);
      trackIndex += 1;
    }
  }
}
