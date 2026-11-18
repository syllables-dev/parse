import { hasLyricText } from "@/internal/write-check";
import type {
  ConversionLoss,
  FormatCapabilities,
  FormatId,
  LyricsDocument,
  LyricsLine,
  LyricsMeta,
  WriteOptions,
} from "@/types";

const lossOrder: ConversionLoss[] = [
  "metadata.album",
  "metadata.artist",
  "metadata.songwriters",
  "metadata.title",
  "wordTiming",
  "lineRange",
  "agents",
  "backing",
  "translations",
  "pronunciations",
];

export function lostIf(loss: ConversionLoss, lost: boolean): ConversionLoss[] {
  return lost ? [loss] : [];
}

export function keepsWordTiming(
  doc: LyricsDocument,
  capabilities: FormatCapabilities
) {
  return doc.timing !== "word" || capabilities.timing.word;
}

function lyricLines(doc: LyricsDocument): LyricsDocument {
  return { ...doc, lines: doc.lines.filter(hasLyricText) };
}

function capabilityLosses(
  doc: LyricsDocument,
  capabilities: FormatCapabilities
): ConversionLoss[] {
  const { meta } = doc;
  const { metadata } = capabilities;
  const checks: [ConversionLoss, boolean][] = [
    ["metadata.album", meta.album !== undefined && !metadata.album],
    ["metadata.artist", meta.artist !== undefined && !metadata.artist],
    [
      "metadata.songwriters",
      meta.songwriters !== undefined && !metadata.songwriters,
    ],
    ["metadata.title", meta.title !== undefined && !metadata.title],
    ["wordTiming", !keepsWordTiming(doc, capabilities)],
    [
      "agents",
      capabilities.agents === false &&
        (doc.agents.length > 0 ||
          doc.lines.some((line) => line.agent !== null)),
    ],
    [
      "backing",
      doc.lines.some(
        (line) =>
          line.b.length > 0 && !(capabilities.backing && line.p.length > 0)
      ),
    ],
    [
      "translations",
      capabilities.translation
        ? Object.values(doc.translationTracks ?? {}).some(
            (track) =>
              (track.automaticallyCreated !== undefined &&
                !capabilities.trackGenerated) ||
              (track.kind === "replacement" && !capabilities.trackKind)
          )
        : doc.translationTracks !== undefined ||
          doc.lines.some((line) => line.translations !== undefined),
    ],
    [
      "pronunciations",
      capabilities.pronunciation
        ? Object.values(doc.pronunciationTracks ?? {}).some((track) =>
            [track, ...(track.variants ?? [])].some(
              (entry) =>
                entry.automaticallyCreated !== undefined &&
                !capabilities.trackGenerated
            )
          )
        : doc.pronunciationTracks !== undefined ||
          doc.lines.some((line) => line.pronunciations !== undefined),
    ],
  ];
  return checks.filter(([, lost]) => lost).map(([loss]) => loss);
}

// lines without lyric text are dropped on every write, so they are never a loss
export function findLosses(
  doc: LyricsDocument,
  capabilities: FormatCapabilities,
  formatLosses: (doc: LyricsDocument) => ConversionLoss[]
): ConversionLoss[] {
  const lyric = lyricLines(doc);
  const found = new Set([
    ...capabilityLosses(lyric, capabilities),
    ...formatLosses(lyric),
  ]);
  return lossOrder.filter((loss) => found.has(loss));
}

export function projectedMeta(
  meta: LyricsMeta,
  capabilities: FormatCapabilities
): LyricsMeta {
  const { album, artist, songwriterIds, songwriters, title, ...shared } = meta;
  const { metadata } = capabilities;
  return {
    ...shared,
    ...(metadata.album && album !== undefined && { album }),
    ...(metadata.artist && artist !== undefined && { artist }),
    ...(metadata.songwriters &&
      songwriters !== undefined && {
        songwriters,
        ...(songwriterIds !== undefined && { songwriterIds }),
      }),
    ...(metadata.title && title !== undefined && { title }),
  };
}

export function projectedDocument(
  doc: LyricsDocument,
  capabilities: FormatCapabilities,
  lines: LyricsLine[],
  meta: LyricsMeta
): LyricsDocument {
  const { pronunciationTracks, translationTracks, ...shared } = doc;
  return {
    ...shared,
    agents: capabilities.agents === false ? [] : doc.agents,
    lines,
    meta,
    ...(capabilities.pronunciation &&
      pronunciationTracks !== undefined && { pronunciationTracks }),
    timing: keepsWordTiming(doc, capabilities) ? doc.timing : "line",
    ...(capabilities.translation &&
      translationTracks !== undefined && { translationTracks }),
  };
}

export function prepare(
  doc: LyricsDocument,
  options: WriteOptions,
  format: FormatId,
  losses: (doc: LyricsDocument) => ConversionLoss[],
  project: (doc: LyricsDocument) => LyricsDocument
): LyricsDocument {
  if (Object.keys(options).some((key) => key !== "lossy")) {
    throw new Error(`${format} write options are unsupported`);
  }
  const lyric = lyricLines(doc);
  return options.lossy && losses(lyric).length > 0
    ? lyricLines(project(lyric))
    : lyric;
}
