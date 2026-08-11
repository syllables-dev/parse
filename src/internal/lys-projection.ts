import type { FormatId, LyricsDocument, LyricsLine, Syllable } from "../types";

function hasPrimary(
  line: LyricsLine
): line is LyricsLine & { p: [Syllable, ...Syllable[]] } {
  return line.p.length > 0;
}

function lysLineRange(line: LyricsLine & { p: [Syllable, ...Syllable[]] }) {
  const syllables = [...line.p, ...line.b];
  return {
    begin: Math.min(...syllables.map((syllable) => syllable.begin)),
    end: Math.max(...syllables.map((syllable) => syllable.end)),
  };
}

export function projectedLysLines(doc: LyricsDocument) {
  return doc.lines.filter(hasPrimary).map((line) => {
    const range = lysLineRange(line);
    return { ...line, begin: range.begin, end: range.end };
  });
}

export function lineLosses(doc: LyricsDocument, format: FormatId) {
  if (format === "lrc") {
    return doc.lines.some((line, lineIndex) => {
      const earlier = doc.lines[lineIndex - 1];
      const end = doc.lines[lineIndex + 1]?.begin ?? line.begin + 5000;
      return (
        (earlier !== undefined && line.begin <= earlier.begin) ||
        line.end !== end ||
        line.p.length > 1 ||
        (line.p.length === 1 &&
          (line.p[0]?.begin !== line.begin || line.p[0]?.end !== line.end))
      );
    })
      ? ["lineTiming" as const]
      : [];
  }
  if (format !== "lqe" && format !== "lys") {
    return [];
  }
  const timedLines = doc.lines.filter(hasPrimary);
  return timedLines.some((line) => {
    const range = lysLineRange(line);
    return range.begin !== line.begin || range.end !== line.end;
  })
    ? ["lineTiming" as const]
    : [];
}
