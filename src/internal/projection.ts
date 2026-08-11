import type {
  ConversionLoss,
  FormatCapabilities,
  FormatId,
  LyricsDocument,
  LyricsLine,
  LyricsMeta,
  LyricsTranslation,
  Syllable,
  WriteOptions,
} from "../types";

const lineBreak = /\r|\n/u;
const lineBreakRun = /[\r\n]+/gu;

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

function usesLyricTags(format: FormatId) {
  return (
    format === "eslrc" ||
    format === "lqe" ||
    format === "lrc" ||
    format === "lys" ||
    format === "qrc"
  );
}

function malformedText(text: string | undefined) {
  return text !== undefined && (lineBreak.test(text) || text.trim() !== text);
}

function normalizedText(text: string) {
  return text.trim().replace(lineBreakRun, " ");
}

function validYrcSongwriters(songwriters: string[]) {
  return (
    songwriters.length > 1 &&
    songwriters.every(
      (songwriter) =>
        songwriter.length > 0 &&
        songwriter.trim() === songwriter &&
        !songwriter.includes("/")
    ) &&
    new Set(songwriters).size === songwriters.length
  );
}

function projectedSongwriters(
  songwriters: string[] | undefined,
  format: FormatId
) {
  if (
    songwriters === undefined ||
    (!usesLyricTags(format) && format !== "yrc")
  ) {
    return songwriters;
  }
  if (songwriters.length === 0) {
    return;
  }
  const [first] = songwriters;
  if (first === undefined) {
    return;
  }
  if (usesLyricTags(format)) {
    const songwriter = normalizedText(first);
    return songwriter.length === 0 ? undefined : [songwriter];
  }
  if (songwriters.length === 1) {
    const songwriter = normalizedText(first);
    return songwriter.length === 0 ? undefined : [songwriter];
  }
  if (validYrcSongwriters(songwriters)) {
    return songwriters;
  }
  const songwriter = songwriters.find(
    (name) =>
      name.length > 0 &&
      name.trim() === name &&
      !name.includes("/") &&
      !lineBreak.test(name)
  );
  const selected = normalizedText(songwriter ?? first).replaceAll("/", "");
  return selected.length === 0 ? undefined : [selected];
}

function formatMetadataLosses(
  meta: LyricsMeta,
  format: FormatId,
  capabilities: FormatCapabilities
) {
  if (!usesLyricTags(format) && format !== "yrc") {
    return [];
  }
  const features: ConversionLoss[] = [];
  if (malformedText(meta.album)) {
    features.push("metadata.album");
  }
  if (malformedText(meta.artist)) {
    features.push("metadata.artist");
  }
  if (malformedText(meta.author)) {
    features.push("metadata.author");
  }
  if (
    capabilities.metadata.songwriters &&
    meta.songwriters !== undefined &&
    (meta.songwriters.some(
      (songwriter) => songwriter.length === 0 || malformedText(songwriter)
    ) ||
      (usesLyricTags(format)
        ? meta.songwriters.length !== 1
        : meta.songwriters.length !== 1 &&
          !validYrcSongwriters(meta.songwriters)))
  ) {
    features.push("metadata.songwriters");
  }
  if (malformedText(meta.title)) {
    features.push("metadata.title");
  }
  if (meta.author === "") {
    features.push("metadata.author");
  }
  return features;
}

function projectedLine(
  line: LyricsLine,
  capabilities: FormatCapabilities,
  wordTimed: boolean,
  translations: LyricsLine["translations"]
) {
  return {
    agent: capabilities.agents === false ? null : line.agent,
    b: capabilities.backing ? projectedTrack(line.b, line, wordTimed) : [],
    begin: line.begin,
    end: line.end,
    id: line.id,
    p: projectedTrack(line.p, line, wordTimed),
    ...(capabilities.pronunciation &&
      line.pronunciations !== undefined && {
        pronunciations: line.pronunciations,
      }),
    ...(capabilities.translation &&
      translations !== undefined && {
        translations,
      }),
  };
}

function lqeTranslationRows(line: LyricsLine, translation: LyricsTranslation) {
  const rows: number[] = [];
  const primary = line.p.at(0);
  if (primary) {
    rows.push(primary.begin);
  }
  const backing = line.b.at(0);
  if (backing && translation.b !== undefined) {
    rows.push(backing.begin);
  }
  return rows;
}

function lqeTranslationMetadataLoss(translation: LyricsTranslation) {
  return (
    translation.automaticallyCreated !== undefined ||
    translation.kind === "replacement"
  );
}

function lqeTimestampLoss(
  rows: number[],
  starts: Map<number, number>,
  timestamps: Set<number>
) {
  for (const begin of rows) {
    if ((starts.get(begin) ?? 0) > 1 || timestamps.has(begin)) {
      return true;
    }
    timestamps.add(begin);
  }
  return false;
}

function lqeTranslationLosses(doc: LyricsDocument) {
  const starts = lqeTranslationStarts(doc);
  const timestamps = new Map<string, Set<number>>();
  for (const line of doc.lines) {
    for (const [language, translation] of Object.entries(
      line.translations ?? {}
    )) {
      if (lqeTranslationMetadataLoss(translation)) {
        return true;
      }
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
      const used = timestamps.get(language) ?? new Set<number>();
      timestamps.set(language, used);
      if (
        lqeTimestampLoss(lqeTranslationRows(line, translation), starts, used)
      ) {
        return true;
      }
    }
  }
  return false;
}

function lqeTranslationStarts(doc: LyricsDocument) {
  const starts = new Map<number, number>();
  for (const line of doc.lines) {
    for (const begin of [line.p[0]?.begin, line.b[0]?.begin]) {
      if (begin !== undefined) {
        starts.set(begin, (starts.get(begin) ?? 0) + 1);
      }
    }
  }
  return starts;
}

export function lqeAmbiguousStarts(doc: LyricsDocument) {
  return new Set(
    [...lqeTranslationStarts(doc)].flatMap(([begin, count]) =>
      count > 1 ? [begin] : []
    )
  );
}

function canPlaceLqeTranslation(
  begin: number,
  starts: Map<number, number>,
  timestamps: Set<number>
) {
  return (starts.get(begin) ?? 0) === 1 && !timestamps.has(begin);
}

function projectedLqeTranslation(
  line: LyricsLine,
  translation: LyricsTranslation,
  starts: Map<number, number>,
  timestamps: Set<number>
) {
  const primary = line.p.at(0);
  const backing = line.b.at(0);
  const keepPrimary =
    primary !== undefined &&
    canPlaceLqeTranslation(primary.begin, starts, timestamps);
  const keepBacking =
    backing !== undefined &&
    translation.b !== undefined &&
    canPlaceLqeTranslation(backing.begin, starts, timestamps);
  if (!keepPrimary && primary !== undefined) {
    return;
  }
  if (!(keepPrimary || keepBacking)) {
    return;
  }
  if (keepPrimary && primary) {
    timestamps.add(primary.begin);
  }
  if (keepBacking && backing) {
    timestamps.add(backing.begin);
  }
  const kind =
    translation.kind === "replacement" ? "subtitle" : translation.kind;
  return {
    ...(keepBacking && { b: translation.b }),
    ...(kind === undefined ? {} : { kind }),
    p: keepPrimary ? translation.p : "",
  };
}

function projectedLqeTranslations(
  line: LyricsLine,
  starts: Map<number, number>,
  timestamps: Map<string, Set<number>>
) {
  const translations: NonNullable<LyricsLine["translations"]> = {};
  for (const [language, translation] of Object.entries(
    line.translations ?? {}
  )) {
    const used = timestamps.get(language) ?? new Set<number>();
    timestamps.set(language, used);
    const projected = projectedLqeTranslation(line, translation, starts, used);
    if (projected) {
      translations[language] = projected;
    }
  }
  return Object.keys(translations).length === 0 ? undefined : translations;
}

function projectedLqeLines(
  doc: LyricsDocument,
  capabilities: FormatCapabilities,
  wordTimed: boolean
) {
  const starts = lqeTranslationStarts(doc);
  const timestamps = new Map<string, Set<number>>();
  return doc.lines.map((line) =>
    projectedLine(
      line,
      capabilities,
      wordTimed,
      projectedLqeTranslations(line, starts, timestamps)
    )
  );
}

function projectedLrcLines(
  doc: LyricsDocument,
  capabilities: FormatCapabilities,
  wordTimed: boolean
) {
  const orderedLines = doc.lines
    .map((line, order) => ({ line, order }))
    .sort(
      (left, right) =>
        left.line.begin - right.line.begin || left.order - right.order
    );
  return orderedLines.map(({ line }, lineIndex) => {
    const { begin } = line;
    const end = orderedLines[lineIndex + 1]?.line.begin ?? begin + 5000;
    const p = track(line.p, { ...line, begin, end });
    return {
      ...projectedLine(line, capabilities, wordTimed, line.translations),
      begin,
      end,
      p: p.length > 0 ? p : [{ begin, end, id: `${line.id}w0`, text: "" }],
    };
  });
}

function projectedText(text: string | undefined, format: FormatId) {
  return text !== undefined && (usesLyricTags(format) || format === "yrc")
    ? normalizedText(text)
    : text;
}

function projectedMeta(
  meta: LyricsMeta,
  format: FormatId,
  capabilities: FormatCapabilities
) {
  const album = projectedText(meta.album, format);
  const artist = projectedText(meta.artist, format);
  const author = projectedText(meta.author, format);
  const songwriters = projectedSongwriters(meta.songwriters, format);
  const title = projectedText(meta.title, format);
  return {
    ...(capabilities.metadata.album &&
      album !== undefined && {
        album,
      }),
    ...(capabilities.metadata.artist &&
      artist !== undefined && {
        artist,
      }),
    ...(capabilities.metadata.author &&
      author !== undefined &&
      author.length > 0 && {
        author,
      }),
    ...(meta.offset !== undefined && { offset: meta.offset }),
    ...(capabilities.metadata.songwriters &&
      songwriters !== undefined && {
        songwriters,
      }),
    ...(capabilities.metadata.title &&
      title !== undefined && {
        title,
      }),
  };
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
  return doc.lines.map((line) =>
    projectedLine(line, capabilities, wordTimed, line.translations)
  );
}

export function losses(
  doc: LyricsDocument,
  format: FormatId,
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
    ...formatMetadataLosses(doc.meta, format, capabilities),
  ];
  if (!capabilities.wordTiming && doc.timing === "word") {
    features.push("wordTiming");
  }
  if (
    format === "lrc" &&
    doc.lines.some((line, lineIndex) => {
      const earlier = doc.lines[lineIndex - 1];
      const end = doc.lines[lineIndex + 1]?.begin ?? line.begin + 5000;
      return (
        (earlier !== undefined && line.begin <= earlier.begin) ||
        line.end !== end ||
        line.p.length !== 1 ||
        line.p[0]?.begin !== line.begin ||
        line.p[0]?.end !== line.end
      );
    })
  ) {
    features.push("lineTiming");
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
  if (format === "lqe" && lqeTranslationLosses(doc)) {
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
  format: FormatId,
  capabilities: FormatCapabilities
): LyricsDocument {
  if (losses(doc, format, capabilities).length === 0) {
    return doc;
  }
  const wordTimed = capabilities.wordTiming || doc.timing === "line";
  return {
    ...doc,
    agents: capabilities.agents === false ? [] : doc.agents,
    lines: projectedLines(doc, format, capabilities, wordTimed),
    meta: projectedMeta(doc.meta, format, capabilities),
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
  return options.lossy ? project(doc, format, capabilities) : doc;
}
