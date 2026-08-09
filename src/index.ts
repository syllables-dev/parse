// biome-ignore-all lint/performance/noBarrelFile: this file defines the package public surface
export { capabilities, convert, detect, parse, read, write } from "./api";
export { createDocument } from "./document";
export { ParseError } from "./errors";
export type {
  FormatCapabilities,
  FormatId,
  LyricsAgent,
  LyricsDocument,
  LyricsLine,
  LyricsMeta,
  LyricsPronunciation,
  LyricsTranslation,
  ParseResult,
  Problem,
  ProblemCode,
  ReadOptions,
  Syllable,
  WriteOptions,
} from "./types";
export { validate } from "./validate";
