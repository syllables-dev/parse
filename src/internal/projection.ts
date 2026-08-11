import type {
  ConversionLoss,
  FormatCapabilities,
  FormatId,
  LyricsDocument,
  LyricsLine,
  LyricsMeta,
  LyricsTranslation,
  LyricsTranslationTrack,
  Syllable,
  WriteOptions,
} from "../types";

const lineBreak = /\r|\n/u;
const lineBreakRun = /[\r\n]+/gu;

interface QrcProjectionRow {
  lineIndex: number;
  track: "b" | "p";
  wrapped: boolean;
}

interface QrcProjectionLine {
  b: QrcProjectionRow[];
  p: QrcProjectionRow[];
}

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

function hasPrimary(
  line: LyricsLine
): line is LyricsLine & { p: [Syllable, ...Syllable[]] } {
  return line.p.length > 0;
}

function lysLineRange(line: LyricsLine & { p: [Syllable, ...Syllable[]] }) {
  const syllables = [...line.p, ...line.b];
  return {
    begin: Math.min(...syllables.map((syllable) => syllable.begin)),
    end: Math.max(...syllables.map((syllable) => syllable.end)),
  };
}

function projectedLysLines(doc: LyricsDocument) {
  return doc.lines.filter(hasPrimary).map((line) => {
    const range = lysLineRange(line);
    return { ...line, begin: range.begin, end: range.end };
  });
}

function lineLosses(doc: LyricsDocument, format: FormatId) {
  if (format === "lrc") {
    return doc.lines.some((line, lineIndex) => {
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
      ? ["lineTiming" as const]
      : [];
  }
  if (format !== "lqe" && format !== "lys") {
    return [];
  }
  const timedLines = doc.lines.filter(hasPrimary);
  return [
    ...(timedLines.some((line) => {
      const range = lysLineRange(line);
      return range.begin !== line.begin || range.end !== line.end;
    })
      ? ["lineTiming" as const]
      : []),
    ...(doc.lines.length === timedLines.length ? [] : ["lineShape" as const]),
  ];
}

function qrcWrappingPair(line: LyricsLine) {
  const first = line.p.findIndex((syllable) => syllable.text.length > 0);
  const last = line.p.findLastIndex((syllable) => syllable.text.length > 0);
  if (first < 0 || last < 0) {
    return;
  }
  const opening = line.p[first]?.text.at(0);
  const closing = line.p[last]?.text.at(-1);
  if (
    (opening === "(" && closing === ")") ||
    (opening === "（" && closing === "）")
  ) {
    return [first, last];
  }
}

function qrcWrappedPrimary(line: LyricsLine | undefined) {
  return line !== undefined && qrcWrappingPair(line) !== undefined;
}

function qrcWriteRows(
  doc: LyricsDocument,
  unwrapped: Set<number>
): QrcProjectionRow[] {
  return doc.lines.flatMap((line, lineIndex) => [
    ...(line.p.length > 0 || line.b.length === 0
      ? [
          {
            lineIndex,
            track: "p" as const,
            wrapped: qrcWrappedPrimary(line) && !unwrapped.has(lineIndex),
          },
        ]
      : [
          {
            lineIndex,
            track: "p" as const,
            wrapped: false,
          },
        ]),
    ...(line.b.length > 0
      ? [{ lineIndex, track: "b" as const, wrapped: true }]
      : []),
  ]);
}

function qrcBackingRow(rows: QrcProjectionRow[], rowIndex: number) {
  // qrc reads an isolated wrapped row as backing vocals.
  return (
    rows[rowIndex]?.wrapped === true &&
    !rows[rowIndex - 1]?.wrapped &&
    !rows[rowIndex + 1]?.wrapped
  );
}

function qrcRowsMatch(doc: LyricsDocument, unwrapped: Set<number>) {
  const rows = qrcWriteRows(doc, unwrapped);
  const parsed: QrcProjectionLine[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const backing = qrcBackingRow(rows, rowIndex);
    const previous = parsed.at(-1);
    if (backing && previous) {
      previous.b.push(row);
    } else {
      parsed.push({ b: backing ? [row] : [], p: backing ? [] : [row] });
    }
  }
  if (parsed.length !== doc.lines.length) {
    return false;
  }
  return parsed.every((line, lineIndex) => {
    const expected = doc.lines[lineIndex];
    return (
      expected !== undefined &&
      line.p.length === 1 &&
      line.p[0]?.lineIndex === lineIndex &&
      line.p[0]?.track === "p" &&
      line.b.length === Number(expected.b.length > 0) &&
      line.b.every((row) => row.lineIndex === lineIndex && row.track === "b")
    );
  });
}

export function qrcTextLosses(doc: LyricsDocument) {
  const unwrapped = new Set<number>();
  while (!qrcRowsMatch(doc, unwrapped)) {
    const rows = qrcWriteRows(doc, unwrapped);
    const isolated = rows.find(
      (row, rowIndex) =>
        row.track === "p" &&
        row.wrapped &&
        !unwrapped.has(row.lineIndex) &&
        qrcBackingRow(rows, rowIndex)
    );
    if (isolated) {
      unwrapped.add(isolated.lineIndex);
      continue;
    }
    const blockedBacking = rows.findIndex(
      (row, rowIndex) => row.track === "b" && !qrcBackingRow(rows, rowIndex)
    );
    const neighbor = [rows[blockedBacking - 1], rows[blockedBacking + 1]].find(
      (row) =>
        row?.track === "p" && row.wrapped && !unwrapped.has(row.lineIndex)
    );
    if (neighbor) {
      unwrapped.add(neighbor.lineIndex);
      continue;
    }
    return new Set<number>();
  }
  return unwrapped;
}

function projectedQrcLines(
  doc: LyricsDocument,
  capabilities: FormatCapabilities,
  wordTimed: boolean
) {
  const unwrapped = qrcTextLosses(doc);
  return doc.lines.map((line, lineIndex) => {
    const pair = unwrapped.has(lineIndex) ? qrcWrappingPair(line) : undefined;
    const p =
      pair === undefined
        ? line.p
        : line.p.map((syllable, syllableIndex) => {
            let { text } = syllable;
            if (syllableIndex === pair[0]) {
              text = text.slice(1);
            }
            if (syllableIndex === pair[1]) {
              text = text.slice(0, -1);
            }
            return { ...syllable, text };
          });
    return projectedLine(
      { ...line, p },
      capabilities,
      wordTimed,
      line.translations
    );
  });
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

function lqeTranslationMetadataLoss(metadata: {
  automaticallyCreated?: boolean;
  kind?: "subtitle" | "replacement";
}) {
  return (
    metadata.automaticallyCreated !== undefined ||
    metadata.kind === "replacement"
  );
}

function trackMetadataLosses(
  doc: LyricsDocument,
  capabilities: FormatCapabilities
) {
  const translation = Object.values(doc.translationTracks ?? {}).some(
    (metadata) =>
      (metadata.automaticallyCreated !== undefined &&
        !capabilities.trackMetadata.translation.automaticallyCreated) ||
      (metadata.kind === "replacement" &&
        !capabilities.trackMetadata.translation.kind)
  );
  const pronunciation = Object.values(doc.pronunciationTracks ?? {}).some(
    (metadata) =>
      metadata.automaticallyCreated !== undefined &&
      !capabilities.trackMetadata.pronunciation.automaticallyCreated
  );
  return { pronunciation, translation };
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
  const starts = lqeTranslationStarts(doc);
  const timestamps = new Map<string, Set<number>>();
  for (const line of doc.lines) {
    for (const [language, translation] of Object.entries(
      line.translations ?? {}
    )) {
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
  return {
    ...(keepBacking && { b: translation.b }),
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
  const shapedLines = projectedLysLines(doc);
  const starts = lqeTranslationStarts({ ...doc, lines: shapedLines });
  const timestamps = new Map<string, Set<number>>();
  return shapedLines.map((line) =>
    projectedLine(
      line,
      capabilities,
      wordTimed,
      projectedLqeTranslations(line, starts, timestamps)
    )
  );
}

function projectedTranslationTracks(
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

function projectedPronunciationTracks(
  doc: LyricsDocument,
  capabilities: FormatCapabilities
) {
  return capabilities.pronunciation ? doc.pronunciationTracks : undefined;
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
  if (format === "qrc") {
    return projectedQrcLines(doc, capabilities, wordTimed);
  }
  if (format === "lys") {
    return projectedLysLines(doc).map((line) =>
      projectedLine(line, capabilities, wordTimed, line.translations)
    );
  }
  return doc.lines.map((line) =>
    projectedLine(line, capabilities, wordTimed, line.translations)
  );
}

function basicLosses(
  doc: LyricsDocument,
  format: FormatId,
  capabilities: FormatCapabilities
): ConversionLoss[] {
  const features: ConversionLoss[] = [];
  if (!capabilities.wordTiming && doc.timing === "word") {
    features.push("wordTiming");
  }
  features.push(...lineLosses(doc, format));
  if (
    capabilities.agents === false &&
    (doc.agents.length > 0 || doc.lines.some((line) => line.agent !== null))
  ) {
    features.push("agents");
  }
  if (!capabilities.backing && doc.lines.some((line) => line.b.length > 0)) {
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
  const wordTimed = capabilities.wordTiming || doc.timing === "line";
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
