import {
  alreadyWrapped,
  primaryCoversLine,
  projectedLine,
  track,
} from "@/internal/projections/line";
import { hasLyricText } from "@/internal/write-check";
import type {
  ConversionLoss,
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
} from "@/types";

// lrc infers each line end from the next line start, so any other end is rewritten.
// text-empty lines never reach the file, so the check must skip them too or it
// measures a neighbour the writer will have dropped
export function lrcLineLosses(doc: LyricsDocument): ConversionLoss[] {
  const written = doc.lines.filter(hasLyricText);
  return written.some((line, lineIndex) => {
    const earlier = written[lineIndex - 1];
    return (
      (earlier !== undefined && line.begin <= earlier.begin) ||
      line.end !== (written[lineIndex + 1]?.begin ?? line.begin + 5000) ||
      !primaryCoversLine(line)
    );
  })
    ? ["lineRange"]
    : [];
}

function foldedText(line: LyricsLine, primary: string) {
  const backing = line.b
    .map((syllable) => syllable.text)
    .join("")
    .trim();
  if (backing.length === 0) {
    return primary;
  }
  const wrapped = alreadyWrapped(backing) ? backing : `(${backing})`;
  return primary.trim().length === 0
    ? wrapped
    : `${primary.trimEnd()} ${wrapped}`;
}

export function projectedLrcLines(
  doc: LyricsDocument,
  capabilities: FormatCapabilities,
  wordTimed: boolean
) {
  const orderedLines = doc.lines
    .filter(hasLyricText)
    .map((line, order) => ({ line, order }))
    .sort(
      (left, right) =>
        left.line.begin - right.line.begin || left.order - right.order
    );
  return orderedLines.map(({ line }, lineIndex) => {
    const { begin } = line;
    const end = orderedLines[lineIndex + 1]?.line.begin ?? begin + 5000;
    const [primary] = track(line.p, { ...line, begin, end });
    return {
      ...projectedLine(line, capabilities, wordTimed, line.translations, false),
      begin,
      end,
      p: [
        {
          begin,
          end,
          id: primary?.id ?? `${line.id}w0`,
          text: foldedText(line, primary?.text ?? ""),
        },
      ],
    };
  });
}
