import { checkTime } from "@/internal/timestamps";
import type {
  FormatCapabilities,
  FormatId,
  LyricsDocument,
  LyricsLine,
} from "@/types";

const lineBreak = /[\r\n]/u;

// a line with no lyric text holds a timing slot nothing renders, so such formats drop it
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
  if (doc.meta.author === "") {
    throw new Error(`${format} cannot represent an empty lyric file author`);
  }
  const unsupported = [
    ["album", capabilities.metadata.album, doc.meta.album],
    ["artist", capabilities.metadata.artist, doc.meta.artist],
    ["author", capabilities.metadata.author, doc.meta.author],
    ["songwriter", capabilities.metadata.songwriters, doc.meta.songwriters],
    ["title", capabilities.metadata.title, doc.meta.title],
  ].find(
    ([, preserved, metadataValue]) => !preserved && metadataValue !== undefined
  );
  if (unsupported) {
    throw new Error(`${format} cannot represent ${unsupported[0]} metadata`);
  }
  if (doc.meta.author !== undefined && lineBreak.test(doc.meta.author)) {
    throw new Error(`${format} cannot represent line breaks in an author`);
  }
}

export function checkWrite(
  doc: LyricsDocument,
  format: FormatId,
  capabilities: FormatCapabilities
): void {
  checkMetadata(doc, format, capabilities);
  if (!capabilities.timing.static && doc.timing === "static") {
    throw new Error(`${format} cannot represent static timing`);
  }
  if (!capabilities.timing.word && doc.timing === "word") {
    throw new Error(`${format} cannot represent word timing`);
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
