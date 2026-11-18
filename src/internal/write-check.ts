import { checkTime } from "@/internal/timestamps";
import type {
  FormatCapabilities,
  FormatId,
  LyricsDocument,
  LyricsLine,
} from "@/types";

const lineBreak = /[\r\n]/u;

export function hasLyricText(line: LyricsLine): boolean {
  return [...line.p, ...line.b].some(
    (syllable) => syllable.text.trim().length > 0
  );
}

export function checkLines(doc: LyricsDocument, format: FormatId): void {
  if (doc.lines.length === 0) {
    throw new Error(`${format} cannot represent an empty document`);
  }
}

export function checkText(
  text: string,
  format: FormatId,
  reservedMark: RegExp
): void {
  if (lineBreak.test(text)) {
    throw new Error(`${format} cannot represent line breaks in text`);
  }
  if (reservedMark.test(text)) {
    throw new Error(`${format} cannot represent reserved marks in text`);
  }
}

function checkMetadata(
  doc: LyricsDocument,
  format: FormatId,
  capabilities: FormatCapabilities
): void {
  const { meta } = doc;
  const { metadata } = capabilities;
  const unsupported = [
    ["artist", metadata.artist, meta.artist],
    ["album", metadata.album, meta.album],
    ["songwriter", metadata.songwriters, meta.songwriters],
    ["title", metadata.title, meta.title],
  ].flatMap(([name, preserved, value]) =>
    preserved || value === undefined ? [] : [name]
  );
  if (unsupported.length > 0) {
    throw new Error(
      `${format} cannot represent ${unsupported.join(" or ")} metadata`
    );
  }
}

export function checkWrite(
  doc: LyricsDocument,
  format: FormatId,
  capabilities: FormatCapabilities
): void {
  checkMetadata(doc, format, capabilities);
  if (!capabilities.timing[doc.timing]) {
    throw new Error(`${format} cannot represent ${doc.timing} timing`);
  }
  if (
    capabilities.agents === false &&
    (doc.agents.length > 0 || doc.lines.some((line) => line.agent !== null))
  ) {
    throw new Error(`${format} cannot represent vocal agents`);
  }
  if (!capabilities.backing && doc.lines.some((line) => line.b.length > 0)) {
    throw new Error(`${format} cannot represent backing vocals`);
  }
  if (
    !capabilities.translation &&
    doc.lines.some((line) => line.translations !== undefined)
  ) {
    throw new Error(`${format} cannot represent translations`);
  }
  if (
    !capabilities.pronunciation &&
    doc.lines.some((line) => line.pronunciations !== undefined)
  ) {
    throw new Error(`${format} cannot represent pronunciations`);
  }
  for (const line of doc.lines) {
    checkTime(line.begin, `line ${line.id} start`);
    checkTime(line.end, `line ${line.id} end`);
    for (const syllable of [...line.p, ...line.b]) {
      checkTime(syllable.begin, `syllable ${syllable.id} start`);
      checkTime(syllable.end, `syllable ${syllable.id} end`);
    }
  }
}
