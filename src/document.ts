import type { LyricsDocument } from "./types";

/**
 * creates an empty, editable lyric document using the current schema version.
 *
 * @returns a new plain JSON-compatible document with independent mutable collections.
 */
export function createDocument(): LyricsDocument {
  return {
    agents: [],
    lines: [],
    meta: {},
    timing: "line",
    version: 1,
  };
}
