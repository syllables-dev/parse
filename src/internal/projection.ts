import type {
  ConversionLoss,
  FormatCapabilities,
  FormatId,
  LyricsDocument,
  LyricsLine,
  LyricsMeta,
  Syllable,
  WriteOptions,
} from "../types";

function track(syllables: Syllable[], line: LyricsLine) {
  const [first] = syllables;
  if (first === undefined) {
    return [];
  }
  return [
    {
      begin: line.begin,
      end: line.end,
      id: first.id,
      text: syllables.map((syllable) => syllable.text).join(""),
    },
  ];
}

function projectedTrack(
  syllables: Syllable[],
  line: LyricsLine,
  wordTimed: boolean
) {
  return wordTimed ? syllables : track(syllables, line);
}

function lost(
  field: ConversionLoss,
  value: string | string[] | undefined,
  preserved: boolean
) {
  return value !== undefined && !preserved ? [field] : [];
}

function projectedLine(
  line: LyricsLine,
  capabilities: FormatCapabilities,
  wordTimed: boolean
) {
  const { pronunciations, translations, ...plain } = line;
  return {
    ...plain,
    agent: capabilities.agents === false ? null : line.agent,
    b: capabilities.backing ? projectedTrack(line.b, line, wordTimed) : [],
    p: projectedTrack(line.p, line, wordTimed),
    ...(capabilities.pronunciation &&
      pronunciations !== undefined && { pronunciations }),
    ...(capabilities.translation &&
      translations !== undefined && {
        translations,
      }),
  };
}

function projectedMeta(meta: LyricsMeta, capabilities: FormatCapabilities) {
  return {
    ...(capabilities.metadata.album &&
      meta.album !== undefined && {
        album: meta.album,
      }),
    ...(capabilities.metadata.artist &&
      meta.artist !== undefined && {
        artist: meta.artist,
      }),
    ...(capabilities.metadata.author &&
      meta.author !== undefined && {
        author: meta.author,
      }),
    ...(meta.offset !== undefined && { offset: meta.offset }),
    ...(capabilities.metadata.songwriters &&
      meta.songwriters !== undefined && {
        songwriters: meta.songwriters,
      }),
    ...(capabilities.metadata.title &&
      meta.title !== undefined && {
        title: meta.title,
      }),
  };
}

export function losses(
  doc: LyricsDocument,
  capabilities: FormatCapabilities
): ConversionLoss[] {
  const features = [
    ...lost("metadata.album", doc.meta.album, capabilities.metadata.album),
    ...lost("metadata.artist", doc.meta.artist, capabilities.metadata.artist),
    ...lost("metadata.author", doc.meta.author, capabilities.metadata.author),
    ...lost(
      "metadata.songwriters",
      doc.meta.songwriters,
      capabilities.metadata.songwriters
    ),
    ...lost("metadata.title", doc.meta.title, capabilities.metadata.title),
  ];
  if (!capabilities.wordTiming && doc.timing === "word") {
    features.push("wordTiming");
  }
  if (
    capabilities.agents === false &&
    (doc.agents.length > 0 || doc.lines.some((line) => line.agent !== null))
  ) {
    features.push("agents");
  }
  if (!capabilities.backing && doc.lines.some((line) => line.b.length > 0)) {
    features.push("backing");
  }
  if (
    !capabilities.translation &&
    doc.lines.some((line) => line.translations !== undefined)
  ) {
    features.push("translations");
  }
  if (
    !capabilities.pronunciation &&
    doc.lines.some((line) => line.pronunciations !== undefined)
  ) {
    features.push("pronunciations");
  }
  return features;
}

export function project(
  doc: LyricsDocument,
  capabilities: FormatCapabilities
): LyricsDocument {
  if (losses(doc, capabilities).length === 0) {
    return doc;
  }
  const wordTimed = capabilities.wordTiming || doc.timing === "line";
  return {
    ...doc,
    agents: capabilities.agents === false ? [] : doc.agents,
    lines: doc.lines.map((line) =>
      projectedLine(line, capabilities, wordTimed)
    ),
    meta: projectedMeta(doc.meta, capabilities),
    timing: wordTimed ? doc.timing : "line",
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
  return options.lossy ? project(doc, capabilities) : doc;
}
