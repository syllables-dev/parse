import {
  backingLine,
  primaryCoversLine,
  projectedLine,
  track,
} from "@/internal/projections/line";
import type {
  ConversionLoss,
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
} from "@/types";

// lyl writes an explicit line range, so only a primary track that disagrees with its line is lost
export function lylLineLosses(doc: LyricsDocument): ConversionLoss[] {
  return doc.timing !== "word" && !doc.lines.every(primaryCoversLine)
    ? ["lineRange"]
    : [];
}

function collapsed(
  line: LyricsLine,
  capabilities: FormatCapabilities,
  wordTimed: boolean
) {
  return {
    ...projectedLine(line, capabilities, wordTimed, line.translations, false),
    p: track(line.p, line),
  };
}

// unlike lrc, lyl carries an explicit end per line, so each line keeps its own range
export function projectedLylLines(
  doc: LyricsDocument,
  capabilities: FormatCapabilities,
  wordTimed: boolean
) {
  return doc.lines.flatMap((line) => {
    const primary = collapsed(line, capabilities, wordTimed);
    const backing = backingLine(line, capabilities, wordTimed);
    if (backing === undefined) {
      return [primary];
    }
    const flattened = collapsed(backing, capabilities, wordTimed);
    return backing.begin < line.begin
      ? [flattened, primary]
      : [primary, flattened];
  });
}
