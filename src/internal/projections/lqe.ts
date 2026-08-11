import { projectedLine } from "@/internal/projections/line";
import { projectedLysLines } from "@/internal/projections/lys";
import type {
  FormatCapabilities,
  FormatId,
  LyricsDocument,
  LyricsLine,
  LyricsTranslationTrack,
} from "@/types";

function lqeTranslationMetadataLoss(metadata: {
  automaticallyCreated?: boolean;
  kind?: "subtitle" | "replacement";
}) {
  return (
    metadata.automaticallyCreated !== undefined ||
    metadata.kind === "replacement"
  );
}

export function trackMetadataLosses(
  doc: LyricsDocument,
  capabilities: FormatCapabilities
) {
  const translation = Object.values(doc.translationTracks ?? {}).some(
    (metadata) =>
      (metadata.automaticallyCreated !== undefined &&
        !capabilities.trackGenerated) ||
      (metadata.kind === "replacement" && !capabilities.trackKind)
  );
  const pronunciation = Object.values(doc.pronunciationTracks ?? {}).some(
    (metadata) =>
      [metadata, ...(metadata.variants ?? [])].some(
        (entry) =>
          entry.automaticallyCreated !== undefined &&
          !capabilities.trackGenerated
      )
  );
  return { pronunciation, translation };
}

export function lqeTranslationLosses(doc: LyricsDocument) {
  const languages = new Set(
    doc.lines.flatMap((line) => Object.keys(line.translations ?? {}))
  );
  if (
    Object.keys(doc.translationTracks ?? {}).some(
      (language) => !languages.has(language)
    )
  ) {
    return true;
  }
  if (
    Object.values(doc.translationTracks ?? {}).some(lqeTranslationMetadataLoss)
  ) {
    return true;
  }
  for (const line of doc.lines) {
    for (const translation of Object.values(line.translations ?? {})) {
      const primary = line.p.at(0);
      const backing = line.b.at(0);
      if (
        (primary === undefined &&
          (translation.p.length > 0 ||
            translation.b === undefined ||
            backing === undefined)) ||
        (translation.b !== undefined && backing === undefined)
      ) {
        return true;
      }
    }
  }
  return false;
}

function projectedLqeTranslations(line: LyricsLine) {
  if (line.b.length > 0 || line.translations === undefined) {
    return line.translations;
  }
  const translations = Object.fromEntries(
    Object.entries(line.translations).map(([language, translation]) => [
      language,
      translation.b === undefined ? translation : { p: translation.p },
    ])
  );
  return translations;
}

export function projectedLqeLines(
  doc: LyricsDocument,
  capabilities: FormatCapabilities,
  wordTimed: boolean
) {
  const shapedLines = projectedLysLines(doc);
  return shapedLines.map((line) =>
    projectedLine(
      line,
      capabilities,
      wordTimed,
      projectedLqeTranslations(line),
      false
    )
  );
}

export function projectedTranslationTracks(
  doc: LyricsDocument,
  lines: LyricsLine[],
  format: FormatId,
  capabilities: FormatCapabilities
) {
  if (!capabilities.translation) {
    return;
  }
  if (format !== "lqe") {
    return doc.translationTracks;
  }
  const languages = [
    ...new Set(lines.flatMap((line) => Object.keys(line.translations ?? {}))),
  ];
  if (languages.length === 0) {
    return;
  }
  const tracks: Record<string, LyricsTranslationTrack> = {};
  for (const language of languages) {
    tracks[language] = { kind: "subtitle" };
  }
  return tracks;
}

export function projectedPronunciationTracks(
  doc: LyricsDocument,
  capabilities: FormatCapabilities
) {
  return capabilities.pronunciation ? doc.pronunciationTracks : undefined;
}
