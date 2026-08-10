import { ParseError } from "./errors";
import {
  capabilities as eslrcCapabilities,
  read as readEslrc,
  write as writeEslrc,
} from "./formats/eslrc";
import {
  capabilities as lqeCapabilities,
  read as readLqe,
  write as writeLqe,
} from "./formats/lqe";
import {
  capabilities as lrcCapabilities,
  read as readLrc,
  write as writeLrc,
} from "./formats/lrc";
import {
  capabilities as lysCapabilities,
  read as readLys,
  write as writeLys,
} from "./formats/lys";
import {
  capabilities as qrcCapabilities,
  read as readQrc,
  write as writeQrc,
} from "./formats/qrc";
import {
  read as readTtml,
  capabilities as ttmlCapabilities,
  write as writeTtml,
} from "./formats/ttml";
import {
  read as readYrc,
  write as writeYrc,
  capabilities as yrcCapabilities,
} from "./formats/yrc";
import type {
  FormatCapabilities,
  FormatId,
  LyricsDocument,
  ParseResult,
  ReadOptions,
  WriteOptions,
} from "./types";

const codecs = {
  eslrc: {
    capabilities: eslrcCapabilities,
    read: readEslrc,
    write: writeEslrc,
  },
  lqe: { capabilities: lqeCapabilities, read: readLqe, write: writeLqe },
  lrc: { capabilities: lrcCapabilities, read: readLrc, write: writeLrc },
  lys: { capabilities: lysCapabilities, read: readLys, write: writeLys },
  qrc: { capabilities: qrcCapabilities, read: readQrc, write: writeQrc },
  ttml: {
    capabilities: ttmlCapabilities,
    read: readTtml,
    write: writeTtml,
  },
  yrc: { capabilities: yrcCapabilities, read: readYrc, write: writeYrc },
};
const lqeMark = "[Lyricify Quick Export]";
const ttmlRoot =
  /^(?:\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->))*\s*<(?:[\w.-]+:)?tt(?=\s|>)[^>]*>/u;
const yrcRow = /^\[\d+,\d+\]\(\d+,\d+,\d+\)/u;
const qrcRow = /^\[\d+,\d+\].*\(\d+,\d+\)/u;
const lysRow = /^\[\d+\].*\(\d+,\d+\)/u;
const eslrcRow =
  /^\[\d+:\d{1,2}(?:[.:]\d{1,3})?\][^[]+\[\d+:\d{1,2}(?:[.:]\d{1,3})?\]/u;
const lrcRow = /^(?:\[\d+:\d{1,2}(?:[.:]\d{1,3})?\])+/u;
const ttmlUri = "http://www.w3.org/ns/ttml";
const appleUri = "http://music.apple.com/lyric-ttml-internal";
const timingAttr = /\s[\w.-]+:timing\s*=/u;
const lineBreak = /\r\n|\n|\r/u;

/**
 * detects a supported lyric format from its content.
 *
 * @returns the detected format, or `null` when the text is unrecognized.
 */
export function detect(text: string): FormatId | null {
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const lines = source.split(lineBreak);
  if (lines.find((line) => line.trim().length > 0)?.trim() === lqeMark) {
    return "lqe";
  }
  const root = ttmlRoot.exec(source)?.[0];
  if (
    root?.includes(ttmlUri) &&
    root.includes(appleUri) &&
    timingAttr.test(root)
  ) {
    return "ttml";
  }
  if (lines.some((line) => yrcRow.test(line))) {
    return "yrc";
  }
  if (lines.some((line) => qrcRow.test(line))) {
    return "qrc";
  }
  if (lines.some((line) => lysRow.test(line))) {
    return "lys";
  }
  if (lines.some((line) => eslrcRow.test(line))) {
    return "eslrc";
  }
  if (lines.some((line) => lrcRow.test(line))) {
    return "lrc";
  }
  return null;
}

function requireFormat(text: string): FormatId {
  const format = detect(text);
  if (format === null) {
    throw new ParseError("input contains no recognizable lyric format");
  }
  return format;
}

/** detects and reads lyric text into a plain document. */
export function parse(text: string, options: ReadOptions = {}): ParseResult {
  const format = requireFormat(text);
  return { doc: read(text, format, options), format };
}

/** reads lyric text with the selected format codec. */
export function read(
  text: string,
  format: FormatId,
  options: ReadOptions = {}
): LyricsDocument {
  return codecs[format].read(text, options);
}

/** writes a document with the selected format codec. */
export function write(
  doc: LyricsDocument,
  format: FormatId,
  options: WriteOptions = {}
): string {
  return codecs[format].write(doc, options);
}

/** detects, reads, and writes lyric text in the selected output format. */
export function convert(
  text: string,
  to: FormatId,
  options: ReadOptions = {}
): string {
  return write(read(text, requireFormat(text), options), to);
}

/** returns the features preserved by the selected format writer. */
export function capabilities(format: FormatId): FormatCapabilities {
  return { ...codecs[format].capabilities };
}
