import type { FormatId, LyricsMeta } from "../types";

const lyricTag = /^\[([A-Za-z]+):(.*)\]$/u;
const lineBreak = /[\r\n]/u;

export function readTag(line: string) {
  const match = lyricTag.exec(line.trim());
  if (!match) {
    return null;
  }
  const colon = match[0].indexOf(":");
  const name = match[0].slice(1, colon).toLowerCase();
  const text = match[0].slice(colon + 1, -1).trim();
  return { name, text };
}

export function checkMetaText(meta: LyricsMeta, format: FormatId): void {
  const fields = [meta.album, meta.artist, meta.author, meta.title];
  if (
    fields.some((text) => text !== undefined && lineBreak.test(text)) ||
    meta.songwriters?.some((name) => lineBreak.test(name))
  ) {
    throw new Error(`${format} cannot represent line breaks in metadata`);
  }
  if (
    fields.some((text) => text !== undefined && text.trim() !== text) ||
    meta.songwriters?.some((name) => name.trim() !== name)
  ) {
    throw new Error(
      `${format} cannot preserve leading or trailing metadata whitespace`
    );
  }
}

export function writeTags(
  meta: LyricsMeta,
  format: FormatId,
  order: "author-first" | "standard" = "standard"
): string[] {
  checkMetaText(meta, format);
  if (meta.songwriters?.length === 0) {
    throw new Error(`${format} cannot represent an empty songwriter list`);
  }
  if (meta.songwriters && meta.songwriters.length > 1) {
    throw new Error(`${format} cannot represent multiple songwriters`);
  }
  const author = `[by:${meta.author === undefined ? "" : meta.author}]`;
  const fields = [
    ...(meta.title === undefined ? [] : [`[ti:${meta.title}]`]),
    ...(meta.artist === undefined ? [] : [`[ar:${meta.artist}]`]),
    ...(meta.album === undefined ? [] : [`[al:${meta.album}]`]),
  ];
  const songwriter =
    meta.songwriters === undefined ? [] : [`[au:${meta.songwriters[0]}]`];
  return order === "author-first"
    ? [author, ...fields, ...songwriter]
    : [...fields, author, ...songwriter];
}
