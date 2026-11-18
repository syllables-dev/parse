import { ParseError } from "@/errors";
import { readHead, readProns, readTranslations } from "@/formats/ttml/head";
import { readBody } from "@/formats/ttml/lines";
import {
  attr,
  is,
  itunesUri,
  locale,
  needAttr,
  only,
  role,
  ttmlUri,
  ttmUri,
} from "@/formats/ttml/profile";
import { type XmlElement, XmlReader, xmlUri } from "@/internal/xml";
import type { LyricsDocument, LyricsElementAttributes } from "@/types";

function readTiming(root: XmlElement): {
  language?: string;
  lyricGenerationId?: string;
  rootFields?: LyricsElementAttributes;
  timing: LyricsDocument["timing"];
} {
  if (!is(root, "tt", ttmlUri)) {
    throw new ParseError("ttml root must be <tt>");
  }
  const language =
    attr(root, "lang", xmlUri) === undefined ? undefined : locale(root);
  const timingText = needAttr(root, "timing", itunesUri).toLowerCase();
  let timing: LyricsDocument["timing"];
  if (timingText === "line") {
    timing = "line";
  } else if (timingText === "word") {
    timing = "word";
  } else if (timingText === "none") {
    timing = "static";
  } else {
    throw new ParseError(`unsupported ttml timing ${timingText}`);
  }
  const agent = attr(root, "agent", ttmUri);
  const rootRole = role(root);
  const xmlId = attr(root, "id", xmlUri);
  const rootFields: LyricsElementAttributes = {
    ...(agent === undefined ? {} : { agent }),
    ...(rootRole === undefined ? {} : { role: rootRole }),
    ...(xmlId === undefined ? {} : { xmlId }),
  };
  return {
    ...(Object.keys(rootFields).length === 0 ? {} : { rootFields }),
    ...(language === undefined ? {} : { language }),
    lyricGenerationId: attr(root, "lyricGenId", itunesUri),
    timing,
  };
}

export function read(textSource: string): LyricsDocument {
  const root = new XmlReader(textSource).read();
  const rootFields = readTiming(root);
  const head = readHead(root);
  const offset = head.offset === undefined ? 0 : head.offset;
  const body = readBody(
    only(root, "body", ttmlUri),
    rootFields.timing,
    head.agents,
    offset,
    rootFields.rootFields?.agent
  );
  const translationTracks = readTranslations(
    head.translations,
    body.lines,
    offset,
    head.agents,
    rootFields.timing
  );
  const pronunciation = readProns(
    head.transliterations,
    body.lines,
    offset,
    head.agents,
    rootFields.timing
  );
  const lyricGenerationId =
    rootFields.lyricGenerationId ?? head.lyricGenerationId;
  if (
    rootFields.lyricGenerationId !== undefined &&
    head.lyricGenerationId !== undefined &&
    rootFields.lyricGenerationId !== head.lyricGenerationId
  ) {
    throw new ParseError("conflicting Apple lyric generation IDs");
  }
  const apple = {
    ...(head.apple ?? {}),
    ...(body.apple ?? {}),
    ...(rootFields.language === undefined
      ? {}
      : { language: rootFields.language }),
    ...(lyricGenerationId === undefined ? {} : { lyricGenerationId }),
    ...(rootFields.rootFields === undefined
      ? {}
      : { root: rootFields.rootFields }),
    ...(pronunciation.order.length < 2
      ? {}
      : { pronunciationOrder: pronunciation.order }),
  };
  return {
    agents: head.agents,
    ...(Object.keys(apple).length === 0 ? {} : { apple }),
    lines: body.lines,
    meta: {
      ...(head.title === undefined ? {} : { title: head.title }),
      ...(head.songwriters.length > 0 && { songwriters: head.songwriters }),
      ...(head.songwriterIds === undefined
        ? {}
        : { songwriterIds: head.songwriterIds }),
    },
    ...(Object.keys(pronunciation.tracks).length > 0 && {
      pronunciationTracks: pronunciation.tracks,
    }),
    timing: rootFields.timing,
    ...(Object.keys(translationTracks).length > 0 && { translationTracks }),
    version: 1,
  };
}
