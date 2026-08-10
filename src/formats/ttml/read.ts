import { ParseError } from "../../errors";
import { type XmlElement, XmlReader } from "../../internal/xml";
import type { LyricsDocument, ReadOptions } from "../../types";
import { readHead, readProns, readTranslations } from "./head";
import { readBody } from "./lines";
import {
  checkAttrs,
  elements,
  is,
  itunesUri,
  key,
  locale,
  needAttr,
  only,
  ttmlUri,
  xmlUri,
} from "./profile";

function readTiming(root: XmlElement) {
  if (!is(root, "tt", ttmlUri)) {
    throw new ParseError("ttml root must be <tt>");
  }
  checkAttrs(root, [
    key(itunesUri, "lyricGenId"),
    key(itunesUri, "timing"),
    key(xmlUri, "lang"),
  ]);
  locale(root);
  const timing = needAttr(root, "timing", itunesUri).toLowerCase();
  if (timing !== "line" && timing !== "word") {
    throw new ParseError(`unsupported ttml timing ${timing}`);
  }
  if (
    elements(root).some(
      (child) => !(is(child, "head", ttmlUri) || is(child, "body", ttmlUri))
    )
  ) {
    throw new ParseError("ttml root supports head and body children");
  }
  return timing;
}

export function read(
  textSource: string,
  options: ReadOptions = {}
): LyricsDocument {
  if (options.expandRepeats) {
    throw new Error("expandRepeats is available for lrc input");
  }
  const root = new XmlReader(textSource).read();
  const timing = readTiming(root);
  const head = readHead(root);
  const offset = head.offset === undefined ? 0 : head.offset;
  const lines = readBody(
    only(root, "body", ttmlUri),
    timing,
    head.agents,
    offset
  );
  readTranslations(head.translations, lines);
  readProns(head.transliterations, lines, offset);
  return {
    agents: head.agents,
    lines,
    meta: {
      ...(head.songwriters.length > 0 && { songwriters: head.songwriters }),
    },
    timing,
    version: 1,
  };
}
