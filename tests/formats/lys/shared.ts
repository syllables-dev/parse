import type { LyricsLine } from "../../../src";

export function makeLine(
  id: string,
  begin: number,
  text: string,
  track: "b" | "p"
) {
  const syllable = {
    begin,
    end: begin + 500,
    id: `${id}${track === "b" ? "b" : "w"}0`,
    text,
  };
  return {
    agent: "v1",
    b: track === "b" ? [syllable] : [],
    begin,
    end: begin + 500,
    id,
    p: track === "p" ? [syllable] : [],
  } satisfies LyricsLine;
}
