import type { FormatCapabilities, FormatId, LyricsDocument } from "../types";
import { checkTime } from "./timestamps";

export function checkWrite(
  doc: LyricsDocument,
  format: FormatId,
  capabilities: FormatCapabilities
): void {
  if (!capabilities.wordTiming && doc.timing === "word") {
    throw new Error(`${format} cannot represent word timing`);
  }
  if (
    !capabilities.agents &&
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
