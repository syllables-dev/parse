/**
 * ttml (timed text markup language), Apple Music's lyric profile.
 * by Apple
 *
 * <span ttm:role="x-bg">(backing vocal)</span>
 */

// biome-ignore-all lint/performance/noBarrelFile: file defines ttml public surface
import type { FormatCapabilities } from "../../types";

export { read } from "./read";
export { write } from "./write";

export const capabilities = {
  agents: true,
  backing: true,
  metadata: {
    album: false,
    artist: false,
    author: false,
    songwriters: true,
    title: false,
  },
  pronunciation: true,
  translation: true,
  wordTiming: true,
} satisfies FormatCapabilities;
