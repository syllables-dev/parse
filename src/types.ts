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
  /** Apple TTML fields outside the shared lyric model. */
  apple?: AppleLyrics;
  /** lyric lines in their document order. */
  lines: LyricsLine[];
  /** song metadata available from the source document. */
  meta: LyricsMeta;
  /** metadata for timed pronunciation tracks keyed by BCP 47 language tag. */
  pronunciationTracks?: Record<string, LyricsPronunciationTrack>;
  /** the finest timing carried by the source document. */
  timing: "line" | "word";
  /** metadata for untimed translation tracks keyed by BCP 47 language tag. */
  translationTracks?: Record<string, LyricsTranslationTrack>;
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
  /** Apple songwriter artist IDs aligned with {@link songwriters}. */
  songwriterIds?: (string | undefined)[];
  /** songwriter names in source order. */
  songwriters?: string[];
  /** the song title. */
  title?: string;
}

/**
 * a vocal agent declared by the source or synthesized from its duet encoding.
 */
export interface LyricsAgent {
  /** the Apple Music artist ID associated with this agent. */
  artistId?: string;
  /** the stable identifier referenced by the line agent field. */
  id: string;
  /** the agent display name declared by Apple TTML. */
  name?: string;
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
  /** preserves Apple TTML parenthesis text on this line. */
  keepParentheses?: boolean;
  /** the primary timed syllables, including meaningful whitespace in their text. */
  p: Syllable[];
  /** timed pronunciation tracks keyed by BCP 47 language tag. */
  pronunciations?: Record<string, LyricsPronunciation>;
  /** the raw Apple TTML role on the paragraph. */
  role?: string;
  /** untimed translations keyed by BCP 47 language tag. */
  translations?: Record<string, LyricsTranslation>;
  /** the Apple TTML element identifier. */
  xmlId?: string;
}

/**
 * one timed text unit in a primary, backing, or pronunciation track.
 */
export interface Syllable {
  /** an Apple TTML agent override inherited by nested syllables. */
  agent?: string;
  /** the absolute syllable start in integer milliseconds. */
  begin: number;
  /** authoritative ordered text and nested syllables from Apple TTML. */
  content?: SyllableContent[];
  /** the absolute syllable end in integer milliseconds. */
  end: number;
  /** the stable editor identity within the document. */
  id: string;
  /** preserves Apple TTML parenthesis text on this syllable. */
  keepParentheses?: boolean;
  /** the raw Apple TTML role on this syllable. */
  role?: string;
  /** visible text derived from {@link content} when it exists. */
  text: string;
  /** preserves explicit word timing in a line-timed Apple TTML document. */
  timed?: boolean;
  /** the Apple TTML element identifier. */
  xmlId?: string;
}

/** one ordered item inside a nested Apple TTML syllable. */
export type SyllableContent = Syllable | string;

/** Apple Music TTML fields unavailable in community lyric formats. */
export interface AppleLyrics {
  /** audio metadata consumed by Apple Music. */
  audio?: LyricsAudio;
  /** body-level TTML attributes. */
  body?: LyricsBody;
  /** the original lyric language declared on the TTML root. */
  language?: string;
  /** silence before the first lyric line in milliseconds. */
  leadingSilence?: number;
  /** Apple Music's lyric generation identifier. */
  lyricGenerationId?: string;
  /** global source order for per-language pronunciation variants. */
  pronunciationOrder?: LyricsPronunciationReference[];
  /** root-level TTML attributes. */
  root?: LyricsElementAttributes;
  /** divisions and song-part labels in document order. */
  sections?: LyricsSection[];
}

/** audio attributes stored in Apple Music TTML metadata. */
export interface LyricsAudio {
  /** the raw Apple audio role, including `spatial`. */
  role?: string;
  /** whether Apple marks the lyric timing for spatial audio. */
  spatial?: boolean;
}

/** shared Apple TTML element attributes. */
export interface LyricsElementAttributes {
  /** the vocal agent explicitly assigned to the element. */
  agent?: string;
  /** the raw TTML role. */
  role?: string;
  /** the XML element identifier. */
  xmlId?: string;
}

/** Apple TTML body-level fields. */
export interface LyricsBody extends LyricsElementAttributes {
  /** the declared song duration in milliseconds. */
  duration?: number;
}

/** one Apple TTML division and its line membership. */
export interface LyricsSection extends LyricsElementAttributes {
  /** the optional division start in milliseconds. */
  begin?: number;
  /** the optional division end in milliseconds. */
  end?: number;
  /** preserves Apple TTML parenthesis text on this division. */
  keepParentheses?: boolean;
  /** lyric line IDs in division order. */
  lines: string[];
  /** the raw `itunes:songPart` value. */
  part?: string;
}

/** identifies one pronunciation track within its language. */
export interface LyricsPronunciationReference {
  /** the BCP 47 pronunciation language. */
  language: string;
  /** zero-based position among tracks with this language. */
  variant: number;
}

/**
 * translated text associated with one lyric line.
 */
export interface LyricsTranslation extends LyricsElementAttributes {
  /** the backing-vocal translation text without serialization parentheses. */
  b?: string;
  /** the translation line start in milliseconds. */
  begin?: number;
  /** whether backing text includes preserved Apple parentheses. */
  bKeepParentheses?: boolean;
  /** authoritative structured backing translation words. */
  bWords?: Syllable[];
  /** the translation line end in milliseconds. */
  end?: number;
  /** preserves Apple TTML parenthesis text on this parallel line. */
  keepParentheses?: boolean;
  /** visible primary translation text, derived from {@link pWords} when present. */
  p: string;
  /** authoritative structured primary translation words. */
  pWords?: Syllable[];
}

/** metadata shared by every line in one translation language track. */
export interface LyricsTranslationTrack {
  /** whether the source marked this translation track as automatically created. */
  automaticallyCreated?: boolean;
  /** the Apple TTML translation type; omission defaults to subtitle. */
  kind?: "subtitle" | "replacement";
}

/**
 * timed pronunciation associated with one lyric line and language.
 */
export interface LyricsPronunciation extends LyricsElementAttributes {
  /** reserves a missing line position in a repeated Apple TTML track. */
  absent?: true;
  /** the backing-vocal pronunciation syllables. */
  b: Syllable[];
  /** the parallel pronunciation line start in milliseconds. */
  begin?: number;
  /** the parallel pronunciation line end in milliseconds. */
  end?: number;
  /** preserves Apple TTML parenthesis text on this parallel line. */
  keepParentheses?: boolean;
  /** the primary pronunciation syllables. */
  p: Syllable[];
  /** same-language track content indexed by its variant position. */
  variants?: (LyricsPronunciation | undefined)[];
}

/** metadata shared by every line in one pronunciation language track. */
export interface LyricsPronunciationTrack {
  /** whether the source marked this pronunciation track as automatically created. */
  automaticallyCreated?: boolean;
  /** metadata for same-language track variants. */
  variants?: LyricsPronunciationTrack[];
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
  /** whether the format preserves Apple Music TTML metadata and structure. */
  apple: boolean;
  /** whether the format preserves the primary artist name. */
  artist: boolean;
  /** whether the format preserves lyric file authorship. */
  author: boolean;
  /** whether the format preserves songwriter names. */
  songwriters: boolean;
  /** whether the format preserves the song title. */
  title: boolean;
}

/** a document feature whose target representation loses fidelity. */
export type ConversionLoss =
  | "agents"
  | "metadata.apple"
  | "backing"
  | "metadata.album"
  | "metadata.artist"
  | "metadata.author"
  | "metadata.songwriters"
  | "metadata.title"
  | "pronunciations"
  | "translations"
  | "lyricText"
  | "lineShape"
  | "lineTiming"
  | "wordTiming";

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
  /** whether the format preserves the generated-text flag on translation and pronunciation tracks. */
  trackGenerated: boolean;
  /** whether the format preserves translation subtitle and replacement behavior. */
  trackKind: boolean;
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
 * set `lossy` to remove features unsupported by the output format.
 */
export interface WriteOptions {
  /** enables deterministic projections for features listed by {@link losses}. */
  lossy?: boolean;
}

/** conversion read and write options. */
export type ConvertOptions = ReadOptions & WriteOptions;

/**
 * the document and detected format returned by {@link parse}.
 */
export interface ParseResult {
  /** the parsed lyric document. */
  doc: LyricsDocument;
  /** the format detected from the input content. */
  format: FormatId;
}
