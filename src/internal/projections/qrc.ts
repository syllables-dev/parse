import { backingLine, projectedLine } from "@/internal/projections/line";
import type { FormatCapabilities, LyricsDocument } from "@/types";

export function projectedQrcLines(
  doc: LyricsDocument,
  capabilities: FormatCapabilities,
  wordTimed: boolean
) {
  return doc.lines.flatMap((line) => {
    const primary = projectedLine(
      line,
      capabilities,
      wordTimed,
      line.translations,
      false
    );
    const backing = backingLine(line, capabilities, wordTimed);
    if (backing === undefined) {
      return [primary];
    }
    return backing.begin < primary.begin
      ? [backing, primary]
      : [primary, backing];
  });
}
