import { primaryCoversLine } from "@/internal/projections/line";
import type { ConversionLoss, LyricsDocument } from "@/types";

// lyl writes an explicit line range, so only a primary track that disagrees with its line is lost
export function lylLineLosses(doc: LyricsDocument): ConversionLoss[] {
  return doc.timing !== "word" && !doc.lines.every(primaryCoversLine)
    ? ["lineRange"]
    : [];
}
