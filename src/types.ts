/**
 * a lyric format supported by the package.
 *
 * enhanced LRC with A2 word markers is represented as `lrc`.
 */
export type FormatId = "ttml" | "lrc" | "eslrc" | "qrc" | "yrc" | "lys" | "lqe";

/**
 * a stable validation problem identifier suitable for localization and editor logic.
 */
export type ProblemCode =
  | "line-out-of-order"
  | "line-overlap"
  | "line-invalid-time"
  | "line-invalid-range"
  | "syllable-out-of-order"
  | "syllable-invalid-time"
  | "syllable-invalid-range"
  | "syllable-zero-length"
  | "syllable-outside-line"
  | "line-empty"
  | "line-without-text"
  | "line-without-word-timing";

/**
 * the editable, format-independent lyric document.
 *
 * the complete value is plain JSON and all timestamps are absolute integer
 * milliseconds. readers produce deterministic IDs for identical input.
 */
export interface LyricsDocument {
  /** vocal agents referenced by lyric lines. */
  agents: LyricsAgent[];
  /** lyric lines in their document order. */
  lines: LyricsLine[];
  /** song metadata available from the source document. */
  meta: LyricsMeta;
  /** the finest timing carried by the source document. */
  timing: "line" | "word";
  /** the persisted schema version. */
  version: 1;
}

/**
 * song metadata preserved by readers when the source format carries it.
 */
export interface LyricsMeta {
  /** the album title. */
  album?: string;
  /** the primary artist name. */
  artist?: string;
  /** the lyric file author. */
  author?: string;
  /** the source offset in milliseconds, already applied to document timestamps. */
  offset?: number;
  /** songwriter names in source order. */
  songwriters?: string[];
  /** the song title. */
  title?: string;
}

/**
 * a vocal agent declared by the source or synthesized from its duet encoding.
 */
export interface LyricsAgent {
  /** the stable identifier referenced by the line agent field. */
  id: string;
  /** the raw source category, commonly `person`, `group`, or `other`. */
  type: string;
}

/**
 * one timed lyric line with primary, backing, translation, and pronunciation tracks.
 */
export interface LyricsLine {
  /** the referenced vocal agent ID, or `null` for an unattributed line. */
  agent: string | null;
  /** the backing-vocal timed syllables without serialization parentheses. */
  b: Syllable[];
  /** the absolute line start in integer milliseconds. */
  begin: number;
  /** the absolute line end in integer milliseconds. */
  end: number;
  /** the stable editor identity, independent of the line's array position. */
  id: string;
  /** the primary timed syllables, including meaningful whitespace in their text. */
  p: Syllable[];
  /** timed pronunciation tracks keyed by BCP 47 language tag. */
  pronunciations?: Record<string, LyricsPronunciation>;
  /** untimed translations keyed by BCP 47 language tag. */
  translations?: Record<string, LyricsTranslation>;
}

/**
 * one timed text unit in a primary, backing, or pronunciation track.
 */
export interface Syllable {
  /** the absolute syllable start in integer milliseconds. */
  begin: number;
  /** the absolute syllable end in integer milliseconds. */
  end: number;
  /** the stable editor identity within the document. */
  id: string;
  /** the exact source text, including trailing whitespace. */
  text: string;
}

/**
 * translated text associated with one lyric line.
 */
export interface LyricsTranslation {
  /** whether the source marked this translation track as automatically created. */
  automaticallyCreated?: boolean;
  /** the backing-vocal translation text without serialization parentheses. */
  b?: string;
  /** the Apple TTML translation type; omission defaults to subtitle. */
  kind?: "subtitle" | "replacement";
  /** the primary translation text. */
  p: string;
}

/**
 * timed pronunciation associated with one lyric line and language.
 */
export interface LyricsPronunciation {
  /** whether the source marked this pronunciation track as automatically created. */
  automaticallyCreated?: boolean;
  /** the backing-vocal pronunciation syllables. */
  b: Syllable[];
  /** the primary pronunciation syllables. */
  p: Syllable[];
}

/**
 * a validation finding attached to the line or syllable that caused it.
 */
export interface Problem {
  /** the stable machine-readable problem category. */
  code: ProblemCode;
  /** the offending line or syllable ID. */
  id: string;
  /** a concise human-readable description for diagnostics. */
  message: string;
}

/**
 * metadata fields a format preserves when writing.
 *
 * readers apply `offset` to timestamps before writing.
 */
export interface MetadataCapabilities {
  /** whether the format preserves the album title. */
  album: boolean;
  /** whether the format preserves the primary artist name. */
  artist: boolean;
  /** whether the format preserves lyric file authorship. */
  author: boolean;
  /** whether the format preserves songwriter names. */
  songwriters: boolean;
  /** whether the format preserves the song title. */
  title: boolean;
}

/**
 * the lyric features a format can preserve when writing.
 */
export interface FormatCapabilities {
  /**
   * agent capability tier. `identity` preserves opaque IDs and types.
   * `alignment` preserves duet-side attribution and may canonicalize IDs and types.
   */
  agents: false | "alignment" | "identity";
  /** whether the format preserves a separate backing-vocal track. */
  backing: boolean;
  /** metadata fields preserved by the format writer. */
  metadata: MetadataCapabilities;
  /** whether the format preserves timed pronunciation tracks. */
  pronunciation: boolean;
  /** whether the format preserves translated text. */
  translation: boolean;
  /** whether the format preserves individual word or syllable timing. */
  wordTiming: boolean;
}

/**
 * reader behavior shared by public parsing entry points.
 */
export interface ReadOptions {
  /**
   * expands each leading LRC timestamp into a separate line.
   *
   * @defaultValue `false`
   */
  expandRepeats?: boolean;
}

/**
 * writer behavior shared by public serialization entry points.
 *
 * the type is reserved for format options introduced by demonstrated need.
 */
export type WriteOptions = Record<string, never>;

/**
 * the document and detected format returned by {@link parse}.
 */
export interface ParseResult {
  /** the parsed lyric document. */
  doc: LyricsDocument;
  /** the format detected from the input content. */
  format: FormatId;
}
