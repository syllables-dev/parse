import type { LyricsLine, Syllable } from "@/types";

// a backing run may start before its line, as an x-bg span does
export function outsideLine(
  syllable: Syllable,
  line: Pick<LyricsLine, "begin" | "end">,
  backing: boolean
) {
  return (!backing && syllable.begin < line.begin) || syllable.end > line.end;
}
