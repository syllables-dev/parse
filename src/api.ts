import { ParseError } from "@/errors";
import {
  capabilities as eslrcCapabilities,
  losses as eslrcLosses,
  read as readEslrc,
  write as writeEslrc,
} from "@/formats/eslrc";
import {
  containerMark,
  capabilities as lqeCapabilities,
  losses as lqeLosses,
  read as readLqe,
  write as writeLqe,
} from "@/formats/lqe";
import {
  capabilities as lrcCapabilities,
  losses as lrcLosses,
  read as readLrc,
  write as writeLrc,
} from "@/formats/lrc";
import {
  capabilities as lylCapabilities,
  losses as lylLosses,
  read as readLyl,
  write as writeLyl,
} from "@/formats/lyl";
import {
  capabilities as lysCapabilities,
  losses as lysLosses,
  read as readLys,
  write as writeLys,
} from "@/formats/lys";
import {
  capabilities as qrcCapabilities,
  losses as qrcLosses,
  read as readQrc,
  write as writeQrc,
} from "@/formats/qrc";
import {
  read as readTtml,
  capabilities as ttmlCapabilities,
  losses as ttmlLosses,
  write as writeTtml,
} from "@/formats/ttml";
import { itunesUri, ttmlUri } from "@/formats/ttml/profile";
import {
  read as readYrc,
  write as writeYrc,
  capabilities as yrcCapabilities,
  losses as yrcLosses,
} from "@/formats/yrc";
import { clockStamp } from "@/internal/timestamps";
import type {
  ConversionLoss,
  ConvertOptions,
  FormatCapabilities,
  FormatId,
  LyricsDocument,
  ParseResult,
  ReadOptions,
  WriteOptions,
} from "@/types";

const codecs = {
  eslrc: {
    capabilities: eslrcCapabilities,
    losses: eslrcLosses,
    read: readEslrc,
    write: writeEslrc,
  },
  lqe: {
    capabilities: lqeCapabilities,
    losses: lqeLosses,
    read: readLqe,
    write: writeLqe,
  },
  lrc: {
    capabilities: lrcCapabilities,
    losses: lrcLosses,
    read: readLrc,
    write: writeLrc,
  },
  lyl: {
    capabilities: lylCapabilities,
    losses: lylLosses,
    read: readLyl,
    write: writeLyl,
  },
  lys: {
    capabilities: lysCapabilities,
    losses: lysLosses,
    read: readLys,
    write: writeLys,
  },
  qrc: {
    capabilities: qrcCapabilities,
    losses: qrcLosses,
    read: readQrc,
    write: writeQrc,
  },
  ttml: {
    capabilities: ttmlCapabilities,
    losses: ttmlLosses,
    read: readTtml,
    write: writeTtml,
  },
  yrc: {
    capabilities: yrcCapabilities,
    losses: yrcLosses,
    read: readYrc,
    write: writeYrc,
  },
};
const ttmlRoot =
  /^(?:\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->))*\s*<(?:[\w.-]+:)?tt(?=\s|>)[^>]*>/u;
const yrcRow = /^\[\d+,\d+\]\(\d+,\d+,\d+\)/u;
const qrcRow = /^\[\d+,\d+\].*\(\d+,\d+\)/u;
const lysRow = /^\[\d+\].*\(\d+,\d+\)/u;
const lylTypeTag = /^\[type:\s*LyricifyLines\s*\]$/iu;
const lylRow = /^\[\d+,\d+\]/u;
const eslrcRow = new RegExp(
  String.raw`^\[${clockStamp}\][^[]+\[${clockStamp}\]`,
  "u"
);
const lrcRow = new RegExp(String.raw`^(?:\[${clockStamp}\])+`, "u");
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
  if (lines.find((line) => line.trim().length > 0)?.trim() === containerMark) {
    return "lqe";
  }
  const root = ttmlRoot.exec(source)?.[0];
  if (
    root?.includes(ttmlUri) &&
    root.includes(itunesUri) &&
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
  if (lines.some((line) => lylTypeTag.test(line.trim()) || lylRow.test(line))) {
    return "lyl";
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
  if (format === "lrc") {
    return readLrc(text, options);
  }
  if (options.expandRepeats) {
    throw new Error("expandRepeats is available for lrc input");
  }
  return codecs[format].read(text);
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
  options: ConvertOptions = {}
): string {
  return write(read(text, requireFormat(text), options), to, options);
}

/** lists document features whose target representation loses fidelity. */
export function losses(
  doc: LyricsDocument,
  format: FormatId
): ConversionLoss[] {
  return codecs[format].losses(doc);
}

/** returns an isolated snapshot of the features preserved by the selected format writer. */
export function capabilities(format: FormatId): FormatCapabilities {
  return {
    ...codecs[format].capabilities,
    metadata: { ...codecs[format].capabilities.metadata },
    timing: { ...codecs[format].capabilities.timing },
  };
}
