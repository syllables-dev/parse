import type {
  ConversionLoss,
  FormatCapabilities,
  FormatId,
  LyricsMeta,
} from "@/types";

const lineBreak = /\r|\n/u;
const lineBreakRun = /[\r\n]+/gu;

function usesLyricTags(format: FormatId) {
  return (
    format === "eslrc" ||
    format === "lqe" ||
    format === "lrc" ||
    format === "lyl" ||
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

export function formatMetadataLosses(
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

function projectedText(text: string | undefined, format: FormatId) {
  return text !== undefined && (usesLyricTags(format) || format === "yrc")
    ? normalizedText(text)
    : text;
}

export function projectedMeta(
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
