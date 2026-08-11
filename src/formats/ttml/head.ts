import { ParseError } from "@/errors";
import {
  checkTrack,
  readWords,
  splitRuns,
  untimed,
  unwrap,
} from "@/formats/ttml/lines";
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
  readRange,
  readTime,
  text,
  ttmlUri,
  ttmUri,
  xmlUri,
} from "@/formats/ttml/profile";
import type { XmlElement, XmlNode } from "@/internal/xml";
import type {
  AppleLyrics,
  LyricsDocument,
  LyricsElementAttributes,
  LyricsLine,
  LyricsPronunciation,
  LyricsPronunciationReference,
  LyricsPronunciationTrack,
  LyricsTranslationTrack,
  Syllable,
} from "@/types";

export interface TtmlHead {
  agents: LyricsDocument["agents"];
  apple?: Pick<AppleLyrics, "audio" | "leadingSilence">;
  lyricGenerationId?: string;
  offset?: number;
  songwriterIds?: (string | undefined)[];
  songwriters: string[];
  translations: XmlElement[];
  transliterations: XmlElement[];
}

interface ParallelFields extends LyricsElementAttributes {
  begin?: number;
  end?: number;
  keepParentheses?: boolean;
}

const boolStart = /^[1-9TtYy]/u;

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
  let name: string | undefined;
  for (const child of elements(declaration)) {
    if (!is(child, "name", ttmUri)) {
      throw new ParseError(`unsupported agent child <${child.name}>`);
    }
    checkAttrs(child, [key(null, "type")]);
    if (name !== undefined) {
      throw new ParseError("ttml agent supports one name");
    }
    name = text(child);
  }
  ids.add(id);
  const artistId = attr(declaration, "artistId", itunesUri);
  return {
    ...(artistId === undefined ? {} : { artistId }),
    id,
    ...(name === undefined ? {} : { name }),
    type: attr(declaration, "type", null) ?? "",
  };
}

function single(children: XmlElement[], local: string) {
  const matches = children.filter((child) => is(child, local, itunesUri));
  if (matches.length > 1) {
    throw new ParseError("duplicate ttml metadata container");
  }
  return matches[0];
}

function readAudio(children: XmlElement[]) {
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
  const role = attr(audio, "role", null);
  const spatial = attr(audio, "spatial", null);
  const offset =
    lyricOffset === undefined
      ? undefined
      : (() => {
          const sign = lyricOffset.charAt(0);
          return (
            (sign === "-" ? -1 : 1) *
            readTime(
              sign === "-" || sign === "+" ? lyricOffset.slice(1) : lyricOffset,
              "ttml lyric offset"
            )
          );
        })();
  return {
    ...(offset === undefined ? {} : { offset }),
    ...(role === undefined ? {} : { role }),
    ...(spatial === undefined ? {} : { spatial: boolStart.test(spatial) }),
  };
}

function readApple(metadata: XmlElement): Omit<TtmlHead, "agents"> {
  const apple = single(elements(metadata), "iTunesMetadata");
  if (!apple) {
    return { songwriters: [], translations: [], transliterations: [] };
  }
  checkAttrs(apple, [key(null, "leadingSilence")]);
  const leading = attr(apple, "leadingSilence", null);
  const leadingSilence =
    leading === undefined
      ? undefined
      : readTime(leading, "ttml leading silence");
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
  const writers = (writerBlock ? elements(writerBlock) : []).map((writer) => {
    if (!is(writer, "songwriter", itunesUri)) {
      throw new ParseError(`unsupported songwriter child <${writer.name}>`);
    }
    checkAttrs(writer, [key(null, "artistId")]);
    return { artistId: attr(writer, "artistId", null), name: text(writer) };
  });
  const { offset, ...audio } = readAudio(children) ?? {};
  return {
    ...(audio.role === undefined &&
    audio.spatial === undefined &&
    leadingSilence === undefined
      ? {}
      : {
          apple: {
            ...(Object.keys(audio).length === 0 ? {} : { audio }),
            ...(leadingSilence === undefined ? {} : { leadingSilence }),
          },
        }),
    ...(offset === undefined ? {} : { offset }),
    songwriters: writers.map((writer) => writer.name),
    ...(writers.some((writer) => writer.artistId !== undefined)
      ? { songwriterIds: writers.map((writer) => writer.artistId) }
      : {}),
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
  const lyricGenerationId = attr(metadata, "lyricGenId", itunesUri);
  return {
    agents,
    ...(lyricGenerationId === undefined ? {} : { lyricGenerationId }),
    ...readApple(metadata),
  };
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

function parallelAttrs(
  textLine: XmlElement,
  line: LyricsLine,
  offset: number,
  agentIds: Set<string>
): ParallelFields {
  checkAttrs(textLine, [
    key(null, "begin"),
    key(null, "end"),
    key(null, "for"),
    key(null, "role"),
    key(ttmUri, "agent"),
    key(ttmUri, "role"),
    key(itunesUri, "key"),
    key(itunesUri, "parenthesis"),
  ]);
  const agent = attr(textLine, "agent", ttmUri);
  if (agent !== undefined && !agentIds.has(agent)) {
    throw new ParseError(`unknown ttml agent ${agent}`);
  }
  const namespacedRole = attr(textLine, "role", ttmUri);
  const plainRole = attr(textLine, "role", null);
  if (
    namespacedRole !== undefined &&
    plainRole !== undefined &&
    namespacedRole !== plainRole
  ) {
    throw new ParseError("conflicting roles on parallel ttml text");
  }
  const begin = attr(textLine, "begin", null);
  const end = attr(textLine, "end", null);
  if ((begin === undefined) !== (end === undefined)) {
    throw new ParseError("parallel ttml text requires begin and end together");
  }
  const range =
    begin === undefined ? {} : readRange(textLine, offset, `line ${line.id}`);
  const parenthesis = attr(textLine, "parenthesis", itunesUri);
  const xmlId = attr(textLine, "id", xmlUri);
  return {
    ...(agent === undefined ? {} : { agent }),
    ...range,
    ...(parenthesis === "keep" ? { keepParentheses: true } : {}),
    ...((namespacedRole ?? plainRole) === undefined
      ? {}
      : { role: namespacedRole ?? plainRole }),
    ...(xmlId === undefined ? {} : { xmlId }),
  };
}

function readCreated(track: XmlElement) {
  const value = attr(track, "automaticallyCreated", null);
  return value === undefined ? undefined : value === "true";
}

function addTranslation(
  textLine: XmlElement,
  language: string,
  lineById: Map<string, LyricsLine>,
  offset: number,
  agentIds: Set<string>,
  timing: "line" | "word"
) {
  if (!is(textLine, "text", itunesUri)) {
    throw new ParseError(`unsupported translated child <${textLine.name}>`);
  }
  const line = target(textLine, lineById);
  const fields = parallelAttrs(textLine, line, offset, agentIds);
  const runs = splitRuns(textLine);
  let primaryWords: Syllable[] | undefined;
  if (runs.primary.some((node) => node.kind === "element")) {
    primaryWords = readWordTrack(
      runs.primary,
      line,
      offset,
      `${line.id}t`,
      false,
      agentIds,
      false,
      timing === "line"
    );
  }
  const backingRun = runs.backing;
  let backingWords: Syllable[] | undefined;
  let keepBacking = false;
  let backing: string | undefined;
  if (backingRun !== null) {
    const rawBacking = backingRun.nodes.some((node) => node.kind === "element")
      ? readWordTrack(
          backingRun.nodes,
          line,
          offset,
          `${line.id}tb`,
          false,
          agentIds,
          false,
          timing === "line"
        )
      : undefined;
    backingWords =
      rawBacking === undefined
        ? undefined
        : unwrap(rawBacking, backingRun.keepParentheses);
    const backingText =
      rawBacking === undefined
        ? untimed(backingRun.nodes)
        : rawBacking.map((word) => word.text).join("");
    if (!(backingText.startsWith("(") && backingText.endsWith(")"))) {
      throw new ParseError("ttml backing text requires wrapping parentheses");
    }
    backing = backingRun.keepParentheses
      ? backingText
      : backingText.slice(1, -1);
    keepBacking = backingRun.keepParentheses;
  }
  line.translations = {
    ...line.translations,
    [language]: {
      ...(backing === undefined ? {} : { b: backing }),
      ...(keepBacking ? { bKeepParentheses: true } : {}),
      ...(backingWords === undefined ? {} : { bWords: backingWords }),
      ...fields,
      p:
        primaryWords === undefined
          ? untimed(runs.primary)
          : primaryWords.map((word) => word.text).join(""),
      ...(primaryWords === undefined ? {} : { pWords: primaryWords }),
    },
  };
}

export function readTranslations(
  containers: XmlElement[],
  lines: LyricsLine[],
  offset: number,
  agents: LyricsDocument["agents"],
  timing: "line" | "word"
) {
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const agentIds = new Set(agents.map((agent) => agent.id));
  const tracks: Record<string, LyricsTranslationTrack> = {};
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
      tracks[language] = {
        ...(automaticallyCreated === undefined ? {} : { automaticallyCreated }),
        kind,
      };
      for (const textLine of elements(translation)) {
        addTranslation(textLine, language, lineById, offset, agentIds, timing);
      }
    }
  }
  return tracks;
}

function readWordTrack(
  nodes: XmlNode[],
  line: LyricsLine,
  offset: number,
  idPrefix: string,
  backing: boolean,
  agentIds: Set<string>,
  keepParentheses = false,
  lineTimed = false
) {
  const syllables = readWords(
    nodes,
    line.begin,
    line.end,
    offset,
    idPrefix,
    line.agent,
    agentIds,
    lineTimed
  );
  const track = backing ? unwrap(syllables, keepParentheses) : syllables;
  checkTrack(track, line);
  return track;
}

function addPron(
  textLine: XmlElement,
  language: string,
  trackIndex: number,
  lineById: Map<string, LyricsLine>,
  offset: number,
  agentIds: Set<string>,
  variant: number,
  timing: "line" | "word"
) {
  if (!is(textLine, "text", itunesUri)) {
    throw new ParseError(`unsupported transliterated child <${textLine.name}>`);
  }
  const line = target(textLine, lineById);
  const fields = parallelAttrs(textLine, line, offset, agentIds);
  if (variant === 0 && Object.hasOwn(line.pronunciations ?? {}, language)) {
    throw new ParseError(
      `duplicate ${language} pronunciation for line ${line.id}`
    );
  }
  const runs = splitRuns(textLine);
  const prefix = `${line.id}r${trackIndex}`;
  const pronunciation = {
    b:
      runs.backing === null
        ? []
        : readWordTrack(
            runs.backing.nodes,
            line,
            offset,
            `${prefix}b`,
            true,
            agentIds,
            runs.backing.keepParentheses,
            timing === "line"
          ),
    ...fields,
    p: readWordTrack(
      runs.primary,
      line,
      offset,
      `${prefix}w`,
      false,
      agentIds,
      false,
      timing === "line"
    ),
  };
  const current = line.pronunciations?.[language];
  if (variant === 0) {
    line.pronunciations = { ...line.pronunciations, [language]: pronunciation };
    return;
  }
  const empty: LyricsPronunciation = { absent: true, b: [], p: [] };
  const base = current ?? empty;
  const variants = [...(base.variants ?? [])];
  variants[variant - 1] = pronunciation;
  line.pronunciations = {
    ...line.pronunciations,
    [language]: { ...base, variants },
  };
}

export function readProns(
  containers: XmlElement[],
  lines: LyricsLine[],
  offset: number,
  agents: LyricsDocument["agents"],
  timing: "line" | "word"
) {
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const agentIds = new Set(agents.map((agent) => agent.id));
  const tracks: Record<string, LyricsPronunciationTrack> = {};
  const order: LyricsPronunciationReference[] = [];
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
      const current = tracks[language];
      const variant =
        current === undefined ? 0 : (current.variants?.length ?? 0) + 1;
      const metadata = {
        ...(automaticallyCreated === undefined ? {} : { automaticallyCreated }),
      };
      tracks[language] =
        current === undefined
          ? metadata
          : { ...current, variants: [...(current.variants ?? []), metadata] };
      order.push({ language, variant });
      for (const textLine of elements(transliteration)) {
        addPron(
          textLine,
          language,
          trackIndex,
          lineById,
          offset,
          agentIds,
          variant,
          timing
        );
      }
      trackIndex += 1;
    }
  }
  return { order, tracks };
}
