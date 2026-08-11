/**
 * TTML (Timed Text Markup Language), Apple Music's lyric profile.
 * by Apple
 *
 * <span ttm:role="x-bg">(backing vocal)</span>
 */

// biome-ignore-all lint/performance/noBarrelFile: file defines TTML public surface
import type { FormatCapabilities } from "../../types";

export { read } from "./read";
export { write } from "./write";

export const capabilities = {
  agents: "identity",
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
