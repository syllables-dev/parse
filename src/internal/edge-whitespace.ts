import type { LyricsLine, Syllable } from "@/types";

function trimEdges(syllables: Syllable[]): Syllable[] {
  const first = syllables.findIndex(
    (syllable) => syllable.text.trim().length > 0
  );
  const last = syllables.findLastIndex(
    (syllable) => syllable.text.trim().length > 0
  );
  return syllables.slice(first, last + 1).map((syllable, index, kept) => {
    const start = index === 0 ? syllable.text.trimStart() : syllable.text;
    return {
      ...syllable,
      text: index === kept.length - 1 ? start.trimEnd() : start,
    };
  });
}

export function trimLineEdges(line: LyricsLine): LyricsLine {
  return { ...line, b: trimEdges(line.b), p: trimEdges(line.p) };
}
