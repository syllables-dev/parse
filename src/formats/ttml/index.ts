/**
 * apple music's ttml profile uses itunes:key to link translations and
 * transliterations to lyric lines; ttm:role="x-bg" marks backing vocals.
 */

// biome-ignore-all lint/performance/noBarrelFile: this file defines the ttml public surface
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
