import {
  primaryCoversLine,
  projectedLine,
  track,
} from "@/internal/projections/line";
import type {
  ConversionLoss,
  FormatCapabilities,
  LyricsDocument,
} from "@/types";

// lrc infers each line end from the next line start, so any other end is rewritten
export function lrcLineLosses(doc: LyricsDocument): ConversionLoss[] {
  return doc.lines.some((line, lineIndex) => {
    const earlier = doc.lines[lineIndex - 1];
    return (
      (earlier !== undefined && line.begin <= earlier.begin) ||
      line.end !== (doc.lines[lineIndex + 1]?.begin ?? line.begin + 5000) ||
      !primaryCoversLine(line)
    );
  })
    ? ["lineRange"]
    : [];
}

export function projectedLrcLines(
  doc: LyricsDocument,
  capabilities: FormatCapabilities,
  wordTimed: boolean
) {
  const orderedLines = doc.lines
    .map((line, order) => ({ line, order }))
    .sort(
      (left, right) =>
        left.line.begin - right.line.begin || left.order - right.order
    );
  return orderedLines.map(({ line }, lineIndex) => {
    const { begin } = line;
    const end = orderedLines[lineIndex + 1]?.line.begin ?? begin + 5000;
    const p = track(line.p, { ...line, begin, end });
    return {
      ...projectedLine(line, capabilities, wordTimed, line.translations, false),
      begin,
      end,
      p: p.length > 0 ? p : [{ begin, end, id: `${line.id}w0`, text: "" }],
    };
  });
}
