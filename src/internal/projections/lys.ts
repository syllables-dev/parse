import type {
  ConversionLoss,
  LyricsDocument,
  LyricsLine,
  Syllable,
} from "@/types";

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

export function lysLineLosses(doc: LyricsDocument): ConversionLoss[] {
  return doc.lines.filter(hasPrimary).some((line) => {
    const range = lysLineRange(line);
    return range.begin !== line.begin || range.end !== line.end;
  })
    ? ["lineRange"]
    : [];
}
