// biome-ignore-all lint/performance/noBarrelFile: file defines package public surface
export {
  capabilities,
  convert,
  detect,
  losses,
  parse,
  read,
  write,
} from "./api";
export { createDocument } from "./document";
export { ParseError } from "./errors";
export type {
  ConversionLoss,
  ConvertOptions,
  FormatCapabilities,
  FormatId,
  LyricsAgent,
  LyricsDocument,
  LyricsLine,
  LyricsMeta,
  LyricsPronunciation,
  LyricsTranslation,
  MetadataCapabilities,
  ParseResult,
  Problem,
  ProblemCode,
  ReadOptions,
  Syllable,
  WriteOptions,
} from "./types";
export { validate } from "./validate";
