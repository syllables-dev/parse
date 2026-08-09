/**
 * ESLRC, ESLyric's word-timed LRC flavor.
 * by ESLyric (foobar2000 lyrics component)
 *
 * [00:00.000]Hel[00:00.500]lo[00:01.000]
 */

import { ParseError } from "../errors";
import {
  readStamp,
  splitLines,
  toInt,
  writeStamp,
} from "../internal/timestamps";
import { checkWrite } from "../internal/write-check";
import type {
  FormatCapabilities,
  LyricsDocument,
  LyricsMeta,
  ReadOptions,
  WriteOptions,
} from "../types";

interface EslrcMarker {
  begin: number;
  text: string;
}

interface EslrcRow {
  markers: EslrcMarker[];
}

const metaTag = /^\[([A-Za-z]+):(.*)\]$/u;
const stamp = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/gu;
const signPrefix = /^[+-]/u;
const lastLineMs = 5000;

export const capabilities = {
  agents: false,
  backing: false,
  pronunciation: false,
  translation: false,
  wordTiming: true,
} satisfies FormatCapabilities;

function readOffset(offsetText: string | undefined): number | undefined {
  if (offsetText === undefined) {
    return;
  }
  const sign = offsetText.startsWith("-") ? -1 : 1;
  return (
    sign *
    toInt(
      signPrefix.test(offsetText) ? offsetText.slice(1) : offsetText,
      "eslrc offset"
    )
  );
}

function readMeta(tags: Map<string, string>): LyricsMeta {
  const album = tags.get("al");
  const artist = tags.get("ar");
  const offset = readOffset(tags.get("offset"));
  const songwriter = tags.get("au");
  const title = tags.get("ti");
  return {
    ...(album !== undefined && { album }),
    ...(artist !== undefined && { artist }),
    ...(offset !== undefined && { offset }),
    ...(songwriter !== undefined && { songwriters: [songwriter] }),
    ...(title !== undefined && { title }),
  };
}

export function read(text: string, options: ReadOptions = {}): LyricsDocument {
  if (options.expandRepeats) {
    throw new Error("expandRepeats is available for lrc input");
  }
  const tags = new Map<string, string>();
  const rows: EslrcRow[] = [];

  for (const [lineIndex, physicalLine] of splitLines(text).entries()) {
    const metadata = metaTag.exec(physicalLine.trim());
    if (metadata) {
      tags.set((metadata[1] ?? "").toLowerCase(), (metadata[2] ?? "").trim());
      continue;
    }

    const matches = [...physicalLine.matchAll(stamp)];
    if (matches.length === 0) {
      if (physicalLine.trim().length > 0 && physicalLine.startsWith("[")) {
        throw new ParseError(`malformed eslrc line ${lineIndex + 1}`);
      }
      continue;
    }
    if (matches[0]?.index !== 0) {
      throw new ParseError(
        `eslrc line ${lineIndex + 1} must start with a timestamp`
      );
    }
    rows.push({
      markers: matches.map((match, markerIndex) => ({
        begin: readStamp(match[1] ?? "", match[2] ?? "", match[3]),
        text: physicalLine.slice(
          (match.index ?? 0) + match[0].length,
          matches[markerIndex + 1]?.index ?? physicalLine.length
        ),
      })),
    });
  }

  if (rows.length === 0) {
    throw new ParseError("input contains no recognizable eslrc lyric lines");
  }

  const meta = readMeta(tags);
  const offset = meta.offset ?? 0;
  const lines = rows.map((row, lineIndex) => {
    const [firstMarker] = row.markers;
    if (!firstMarker) {
      throw new ParseError(`eslrc line ${lineIndex + 1} has no timestamps`);
    }
    const lastMarker = row.markers.at(-1);
    const explicitEnd =
      row.markers.length > 1 && lastMarker?.text.length === 0
        ? lastMarker.begin
        : undefined;
    const sourceEnd =
      explicitEnd ??
      rows[lineIndex + 1]?.markers[0]?.begin ??
      firstMarker.begin + lastLineMs;
    const timedSegments = row.markers.flatMap((marker, markerIndex) => {
      if (marker.text.length === 0) {
        return [];
      }
      return [
        {
          begin: marker.begin - offset,
          end: (row.markers[markerIndex + 1]?.begin ?? sourceEnd) - offset,
          text: marker.text,
        },
      ];
    });
    const syllables =
      timedSegments.length > 0
        ? timedSegments
        : [
            {
              begin: firstMarker.begin - offset,
              end: sourceEnd - offset,
              text: "",
            },
          ];
    return {
      agent: null,
      b: [],
      begin: firstMarker.begin - offset,
      end: sourceEnd - offset,
      id: `l${lineIndex}`,
      p: syllables.map((syllable, syllableIndex) => ({
        ...syllable,
        id: `l${lineIndex}w${syllableIndex}`,
      })),
    };
  });

  return {
    agents: [],
    lines,
    meta,
    timing: "word",
    version: 1,
  };
}

function writeMeta(meta: LyricsMeta): string[] {
  if (meta.songwriters && meta.songwriters.length > 1) {
    throw new Error("eslrc cannot represent multiple songwriters");
  }
  return [
    ...(meta.title === undefined ? [] : [`[ti:${meta.title}]`]),
    ...(meta.artist === undefined ? [] : [`[ar:${meta.artist}]`]),
    ...(meta.album === undefined ? [] : [`[al:${meta.album}]`]),
    "[by:]",
    ...(meta.offset === undefined ? [] : [`[offset:${meta.offset}]`]),
    ...(meta.songwriters?.[0] === undefined
      ? []
      : [`[au:${meta.songwriters[0]}]`]),
  ];
}

export function write(doc: LyricsDocument, options: WriteOptions = {}): string {
  if (Object.keys(options).length > 0) {
    throw new Error("eslrc write options are unsupported");
  }
  checkWrite(doc, "eslrc", capabilities);
  const offset = doc.meta.offset ?? 0;
  return [
    ...writeMeta(doc.meta),
    ...doc.lines.map((line) => {
      const emptySyllables = line.p.filter(
        (syllable) => syllable.text.length === 0
      );
      if (
        emptySyllables.length > 0 &&
        !(
          line.p.length === 1 &&
          emptySyllables[0]?.begin === line.begin &&
          emptySyllables[0]?.end === line.end
        )
      ) {
        throw new Error(
          `eslrc cannot represent empty syllables in line ${line.id}`
        );
      }
      let currentTime = line.begin;
      let serialized = `[${writeStamp(line.begin + offset)}]`;
      for (const syllable of line.p) {
        if (syllable.begin !== currentTime) {
          serialized += `[${writeStamp(syllable.begin + offset)}]`;
        }
        serialized += `${syllable.text}[${writeStamp(syllable.end + offset)}]`;
        currentTime = syllable.end;
      }
      if (currentTime !== line.end) {
        serialized += `[${writeStamp(line.end + offset)}]`;
      }
      return serialized;
    }),
  ].join("\n");
}
