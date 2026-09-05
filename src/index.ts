// biome-ignore-all lint/performance/noBarrelFile: file defines package public surface
export {
  capabilities,
  convert,
  detect,
  losses,
  parse,
  read,
  write,
} from "@/api";
export { createDocument } from "@/document";
export { ParseError } from "@/errors";
export type {
  AppleLyrics,
  ConversionLoss,
  ConvertOptions,
  FormatCapabilities,
  FormatId,
  LyricsAgent,
  LyricsAudio,
  LyricsBody,
  LyricsDocument,
  LyricsElementAttributes,
  LyricsLine,
  LyricsMeta,
  LyricsPronunciation,
  LyricsPronunciationReference,
  LyricsPronunciationTrack,
  LyricsSection,
  LyricsTranslation,
  LyricsTranslationTrack,
  MetadataCapabilities,
  ParseResult,
  Problem,
  ProblemCode,
  ReadOptions,
  Syllable,
  SyllableContent,
  TimingCapabilities,
  WriteOptions,
} from "@/types";
export { validate } from "@/validate";
