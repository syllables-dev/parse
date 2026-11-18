import { ParseError } from "@/errors";
import type { FormatId, LyricsLine, Syllable } from "@/types";

// a backing run may start before its line, as an x-bg span does
export function outsideLine(
  syllable: Syllable,
  line: Pick<LyricsLine, "begin" | "end">,
  backing: boolean
) {
  return (!backing && syllable.begin < line.begin) || syllable.end > line.end;
}

export function startsEarly(
  syllable: Syllable,
  previous: Syllable | undefined
) {
  return previous !== undefined && syllable.begin < previous.begin;
}

function wordTracks(line: LyricsLine): [string, Syllable[]][] {
  return [
    ["word", line.p],
    ["backing word", line.b],
    ...Object.entries(line.pronunciations ?? {}).flatMap(
      ([language, pronunciation]) =>
        [pronunciation, ...(pronunciation.variants ?? [])].flatMap(
          (entry): [string, Syllable[]][] =>
            entry === undefined
              ? []
              : [
                  [`${language} word`, entry.p],
                  [`${language} backing word`, entry.b],
                ]
        )
    ),
  ];
}

export function checkWordOrder(lines: LyricsLine[], format: FormatId) {
  for (const [lineIndex, line] of lines.entries()) {
    for (const [label, syllables] of wordTracks(line)) {
      const early = syllables.findIndex((syllable, index) =>
        startsEarly(syllable, syllables[index - 1])
      );
      if (early > 0) {
        throw new ParseError(
          `${format} lyric line ${lineIndex + 1}: ${label} ${early + 1} starts before ${label} ${early}`
        );
      }
    }
  }
}
