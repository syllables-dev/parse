import { ParseError } from "../../errors";
import type { XmlElement, XmlNode } from "../../internal/xml";
import type { LyricsDocument, LyricsLine } from "../../types";
import { checkTrack, readWords, splitRuns, untimed, unwrap } from "./lines";
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

function single(children: XmlElement[], local: string) {
  const matches = children.filter((child) => is(child, local, itunesUri));
  if (matches.length > 1) {
    throw new ParseError("duplicate ttml metadata container");
  }
  return matches[0];
}

function readAudioOffset(children: XmlElement[]) {
  const audio = single(children, "audio");
  if (!audio) {
    return;
  }
  checkAttrs(audio, [
    key(null, "lyricOffset"),
    key(null, "role"),
    key(null, "spatial"),
  ]);
  if (elements(audio).length > 0) {
    throw new ParseError("ttml audio metadata must be empty");
  }
  const lyricOffset = attr(audio, "lyricOffset", null);
  if (lyricOffset === undefined) {
    return;
  }
  const sign = lyricOffset.charAt(0);
  return (
    (sign === "-" ? -1 : 1) *
    readTime(
      sign === "-" || sign === "+" ? lyricOffset.slice(1) : lyricOffset,
      "ttml lyric offset"
    )
  );
}

function readApple(metadata: XmlElement): Omit<TtmlHead, "agents"> {
  const apple = single(elements(metadata), "iTunesMetadata");
  if (!apple) {
    return { songwriters: [], translations: [], transliterations: [] };
  }
  checkAttrs(apple, [key(null, "leadingSilence")]);
  const leading = attr(apple, "leadingSilence", null);
  if (leading !== undefined) {
    readTime(leading, "ttml leading silence");
  }
  const children = elements(apple);
  const allowed = ["translations", "transliterations", "songwriters", "audio"];
  if (
    children.some(
      (child) => !allowed.some((local) => is(child, local, itunesUri))
    )
  ) {
    throw new ParseError("unsupported Apple lyric metadata element");
  }
  const writerBlock = single(children, "songwriters");
  if (writerBlock) {
    checkAttrs(writerBlock, []);
  }
  const songwriters = (writerBlock ? elements(writerBlock) : []).map(
    (writer) => {
      if (!is(writer, "songwriter", itunesUri)) {
        throw new ParseError(`unsupported songwriter child <${writer.name}>`);
      }
      checkAttrs(writer, [key(itunesUri, "artistId")]);
      return text(writer);
    }
  );
  const offset = readAudioOffset(children);
  return {
    ...(offset === undefined ? {} : { offset }),
    songwriters,
    translations: children.filter((child) =>
      is(child, "translations", itunesUri)
    ),
    transliterations: children.filter((child) =>
      is(child, "transliterations", itunesUri)
    ),
  };
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
  const agents: LyricsDocument["agents"] = [];
  const ids = new Set<string>();
  for (const declaration of elements(metadata)) {
    if (is(declaration, "agent", ttmUri)) {
      agents.push(readAgent(declaration, ids));
    }
  }
  return { agents, ...readApple(metadata) };
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

function readCreated(track: XmlElement) {
  const value = attr(track, "automaticallyCreated", null);
  return value === undefined ? undefined : value === "true";
}

function addTranslation(
  textLine: XmlElement,
  language: string,
  automaticallyCreated: boolean | undefined,
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
  const backing =
    runs.backing === null ? undefined : untimed(runs.backing, line.agent);
  if (
    backing !== undefined &&
    !(backing.startsWith("(") && backing.endsWith(")"))
  ) {
    throw new ParseError("ttml backing text requires wrapping parentheses");
  }
  line.translations = {
    ...line.translations,
    [language]: {
      ...(automaticallyCreated === undefined ? {} : { automaticallyCreated }),
      ...(backing === undefined ? {} : { b: backing.slice(1, -1) }),
      p: untimed(runs.primary, line.agent),
    },
  };
}

export function readTranslations(
  containers: XmlElement[],
  lines: LyricsLine[]
) {
  const lineById = new Map(lines.map((line) => [line.id, line]));
  for (const container of containers) {
    checkAttrs(container, []);
    for (const translation of elements(container)) {
      if (!is(translation, "translation", itunesUri)) {
        throw new ParseError(
          `unsupported translation element <${translation.name}>`
        );
      }
      checkAttrs(translation, [
        key(null, "automaticallyCreated"),
        key(null, "type"),
        key(xmlUri, "lang"),
      ]);
      const kind = needAttr(translation, "type", null);
      if (kind !== "subtitle" && kind !== "replacement") {
        throw new ParseError(`unsupported ttml translation type ${kind}`);
      }
      const language = locale(translation);
      const automaticallyCreated = readCreated(translation);
      for (const textLine of elements(translation)) {
        addTranslation(textLine, language, automaticallyCreated, lineById);
      }
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
  automaticallyCreated: boolean | undefined,
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
      ...(automaticallyCreated === undefined ? {} : { automaticallyCreated }),
      b:
        runs.backing === null
          ? []
          : readPronTrack(runs.backing, line, offset, `${prefix}b`, true),
      p: readPronTrack(runs.primary, line, offset, `${prefix}w`, false),
    },
  };
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
      if (!is(transliteration, "transliteration", itunesUri)) {
        throw new ParseError(
          `unsupported transliteration element <${transliteration.name}>`
        );
      }
      checkAttrs(transliteration, [
        key(null, "automaticallyCreated"),
        key(xmlUri, "lang"),
      ]);
      const language = locale(transliteration);
      const automaticallyCreated = readCreated(transliteration);
      for (const textLine of elements(transliteration)) {
        addPron(
          textLine,
          language,
          trackIndex,
          automaticallyCreated,
          lineById,
          offset
        );
      }
      trackIndex += 1;
    }
  }
}
