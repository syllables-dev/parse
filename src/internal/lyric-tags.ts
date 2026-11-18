import { ParseError } from "@/errors";
import { readOffset } from "@/internal/timestamps";
import type { ConversionLoss, FormatId, LyricsMeta } from "@/types";

export interface MetaProblem {
  loss: ConversionLoss;
  message: string;
}

const lyricTag = /^\[([A-Za-z]+):(.*)\]$/u;
const lineBreak = /[\r\n]/u;
const lineBreakRun = /[\r\n]+/gu;

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

export function checkUnreadRow(
  raw: string,
  format: FormatId,
  lineIndex: number
) {
  if (raw.trim().length > 0 && raw.startsWith("[")) {
    throw new ParseError(`malformed ${format} line ${lineIndex + 1}`);
  }
}

export function readTagMeta(tags: Map<string, string>, format: FormatId) {
  const album = tags.get("al");
  const artist = tags.get("ar");
  const songwriter = tags.get("au");
  const title = tags.get("ti");
  const meta: LyricsMeta = {
    ...(album !== undefined && { album }),
    ...(artist !== undefined && { artist }),
    ...(songwriter !== undefined && { songwriters: [songwriter] }),
    ...(title !== undefined && { title }),
  };
  return { meta, offset: readOffset(tags.get("offset"), format) };
}

export function textProblems(meta: LyricsMeta, format: FormatId) {
  const fields: [ConversionLoss, string | undefined][] = [
    ["metadata.album", meta.album],
    ["metadata.artist", meta.artist],
    ["metadata.title", meta.title],
    ...(meta.songwriters ?? []).map((name): [ConversionLoss, string] => [
      "metadata.songwriters",
      name,
    ]),
  ];
  return [
    ...fields
      .filter(([, text]) => text !== undefined && lineBreak.test(text))
      .map(([loss]) => ({
        loss,
        message: `${format} cannot represent line breaks in metadata`,
      })),
    ...fields
      .filter(([, text]) => text !== undefined && text.trim() !== text)
      .map(([loss]) => ({
        loss,
        message: `${format} cannot preserve leading or trailing metadata whitespace`,
      })),
  ];
}

export function songwriterProblems(
  checks: [boolean, string][],
  format: FormatId
): MetaProblem[] {
  return checks
    .filter(([failed]) => failed)
    .map(([, message]) => ({
      loss: "metadata.songwriters",
      message: `${format} ${message}`,
    }));
}

export function tagProblems(meta: LyricsMeta, format: FormatId) {
  const { songwriters } = meta;
  return [
    ...textProblems(meta, format),
    ...(songwriters === undefined
      ? []
      : songwriterProblems(
          [
            [
              songwriters.length === 0,
              "cannot represent an empty songwriter list",
            ],
            [songwriters.length > 1, "cannot represent multiple songwriters"],
            [
              songwriters.some((name) => name.length === 0),
              "cannot represent an empty songwriter name",
            ],
          ],
          format
        )),
  ];
}

export function writeTags(meta: LyricsMeta, problems: MetaProblem[]) {
  const [problem] = problems;
  if (problem) {
    throw new Error(problem.message);
  }
  return [
    ...(meta.title === undefined ? [] : [`[ti:${meta.title}]`]),
    ...(meta.artist === undefined ? [] : [`[ar:${meta.artist}]`]),
    ...(meta.album === undefined ? [] : [`[al:${meta.album}]`]),
    ...(meta.songwriters?.length === 1 ? [`[au:${meta.songwriters[0]}]`] : []),
  ];
}

export function normalizedTagText(text: string) {
  return text.trim().replace(lineBreakRun, " ");
}

export function projectedTagMeta(meta: LyricsMeta): LyricsMeta {
  const songwriter = normalizedTagText(meta.songwriters?.[0] ?? "");
  return {
    ...(meta.album !== undefined && { album: normalizedTagText(meta.album) }),
    ...(meta.artist !== undefined && {
      artist: normalizedTagText(meta.artist),
    }),
    ...(meta.offset !== undefined && { offset: meta.offset }),
    ...(songwriter.length > 0 && { songwriters: [songwriter] }),
    ...(meta.title !== undefined && { title: normalizedTagText(meta.title) }),
  };
}
