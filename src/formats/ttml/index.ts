/**
 * apple music's ttml profile uses itunes:key to link translations and
 * transliterations to lyric lines; ttm:role="x-bg" marks backing vocals.
 */

import type { FormatCapabilities } from "../../types";
import { read as readTtml } from "./read";
import { write as writeTtml } from "./write";

export const read = readTtml;
export const write = writeTtml;

export const capabilities = {
  agents: true,
  author: false,
  backing: true,
  pronunciation: true,
  translation: true,
  wordTiming: true,
} satisfies FormatCapabilities;
