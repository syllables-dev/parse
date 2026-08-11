import type { FormatCapabilities, LyricsDocument } from "../types";
import { projectedLine, track } from "./line-projection";

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
      ...projectedLine(line, capabilities, wordTimed, line.translations),
      begin,
      end,
      p: p.length > 0 ? p : [{ begin, end, id: `${line.id}w0`, text: "" }],
    };
  });
}
