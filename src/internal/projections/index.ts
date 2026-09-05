import { projectedLine } from "@/internal/projections/line";
import {
  lqeTranslationLosses,
  projectedLqeLines,
  projectedPronunciationTracks,
  projectedTranslationTracks,
  trackMetadataLosses,
} from "@/internal/projections/lqe";
import { projectedLrcLines } from "@/internal/projections/lrc";
import { lineLosses, projectedLysLines } from "@/internal/projections/lys";
import {
  formatMetadataLosses,
  projectedMeta,
} from "@/internal/projections/metadata";
import { projectedQrcLines, qrcTextLosses } from "@/internal/projections/qrc";
import type {
  ConversionLoss,
  FormatCapabilities,
  FormatId,
  LyricsDocument,
  WriteOptions,
} from "@/types";

// biome-ignore lint/performance/noBarrelFile: re-exports qrc's loss detector so codecs have one entry point into this folder
export { qrcTextLosses } from "@/internal/projections/qrc";

function lost(
  field: ConversionLoss,
  value: string | string[] | undefined,
  preserved: boolean
) {
  return value !== undefined && !preserved ? [field] : [];
}

function projectedLines(
  doc: LyricsDocument,
  format: FormatId,
  capabilities: FormatCapabilities,
  wordTimed: boolean
) {
  if (format === "lrc") {
    return projectedLrcLines(doc, capabilities, wordTimed);
  }
  if (format === "lqe") {
    return projectedLqeLines(doc, capabilities, wordTimed);
  }
  if (format === "qrc") {
    return projectedQrcLines(doc, capabilities, wordTimed);
  }
  if (format === "lys") {
    return projectedLysLines(doc).map((line) =>
      projectedLine(line, capabilities, wordTimed, line.translations, false)
    );
  }
  return doc.lines.map((line) =>
    projectedLine(
      line,
      capabilities,
      wordTimed,
      line.translations,
      format === "ttml"
    )
  );
}

function basicLosses(
  doc: LyricsDocument,
  format: FormatId,
  capabilities: FormatCapabilities
): ConversionLoss[] {
  const features: ConversionLoss[] = [];
  if (!capabilities.timing.word && doc.timing === "word") {
    features.push("wordTiming");
  }
  features.push(...lineLosses(doc, format));
  if (
    capabilities.agents === false &&
    (doc.agents.length > 0 || doc.lines.some((line) => line.agent !== null))
  ) {
    features.push("agents");
  }
  if (
    (!capabilities.backing && doc.lines.some((line) => line.b.length > 0)) ||
    ((format === "lys" || format === "lqe" || format === "ttml") &&
      doc.lines.some((line) => line.p.length === 0 && line.b.length > 0))
  ) {
    features.push("backing");
  }
  return features;
}

function trackLossFeatures(
  doc: LyricsDocument,
  format: FormatId,
  capabilities: FormatCapabilities
) {
  const features: ConversionLoss[] = [];
  const tracks = trackMetadataLosses(doc, capabilities);
  if (
    (!capabilities.translation &&
      (doc.translationTracks !== undefined ||
        doc.lines.some((line) => line.translations !== undefined))) ||
    (capabilities.translation && tracks.translation) ||
    (format === "lqe" &&
      (doc.lines.some(
        (line) => line.p.length === 0 && line.translations !== undefined
      ) ||
        lqeTranslationLosses({ ...doc, lines: projectedLysLines(doc) })))
  ) {
    features.push("translations");
  }
  if (format === "qrc" && qrcTextLosses(doc).size > 0) {
    features.push("lyricText");
  }
  if (
    (!capabilities.pronunciation &&
      (doc.pronunciationTracks !== undefined ||
        doc.lines.some((line) => line.pronunciations !== undefined))) ||
    (capabilities.pronunciation && tracks.pronunciation)
  ) {
    features.push("pronunciations");
  }
  return features;
}

export function losses(
  doc: LyricsDocument,
  format: FormatId,
  capabilities: FormatCapabilities
): ConversionLoss[] {
  return [
    ...lost("metadata.album", doc.meta.album, capabilities.metadata.album),
    ...lost("metadata.artist", doc.meta.artist, capabilities.metadata.artist),
    ...lost("metadata.author", doc.meta.author, capabilities.metadata.author),
    ...lost(
      "metadata.songwriters",
      doc.meta.songwriters,
      capabilities.metadata.songwriters
    ),
    ...lost("metadata.title", doc.meta.title, capabilities.metadata.title),
    ...formatMetadataLosses(doc.meta, format, capabilities),
    ...basicLosses(doc, format, capabilities),
    ...trackLossFeatures(doc, format, capabilities),
  ];
}

export function project(
  doc: LyricsDocument,
  format: FormatId,
  capabilities: FormatCapabilities
): LyricsDocument {
  if (losses(doc, format, capabilities).length === 0) {
    return doc;
  }
  const wordTimed = doc.timing !== "word" || capabilities.timing.word;
  const lines = projectedLines(doc, format, capabilities, wordTimed);
  const pronunciationTracks = projectedPronunciationTracks(doc, capabilities);
  const translationTracks = projectedTranslationTracks(
    doc,
    lines,
    format,
    capabilities
  );
  return {
    agents: capabilities.agents === false ? [] : doc.agents,
    lines,
    meta: projectedMeta(doc.meta, format, capabilities),
    ...(pronunciationTracks === undefined ? {} : { pronunciationTracks }),
    timing: wordTimed ? doc.timing : "line",
    ...(translationTracks === undefined ? {} : { translationTracks }),
    version: doc.version,
  };
}

export function prepare(
  doc: LyricsDocument,
  capabilities: FormatCapabilities,
  format: FormatId,
  options: WriteOptions
) {
  if (Object.keys(options).some((key) => key !== "lossy")) {
    throw new Error(`${format} write options are unsupported`);
  }
  return options.lossy ? project(doc, format, capabilities) : doc;
}
