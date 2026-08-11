/**
 * ESLRC, ESLyric's word-timed LRC flavor.
 * by ESLyric (foobar2000 lyrics component)
 *
 * [00:00.000]Hel[00:00.500]lo[00:01.000]
 */

import { ParseError } from "../errors";
import { checkMetaText, readTag } from "../internal/lyric-tags";
import { prepare } from "../internal/projection";
import {
  readOffset,
  readStamp,
  shiftTimes,
  splitLines,
  writeStamp,
} from "../internal/timestamps";
import { checkLines, checkText, checkWrite } from "../internal/write-check";
import type {
  FormatCapabilities,
  LyricsDocument,
  ReadOptions,
  WriteOptions,
} from "../types";

interface EslrcMarker {
  begin: number;
  text: string;
}

interface EslrcRow {
  first: EslrcMarker;
  following: EslrcMarker[];
}

const stamp = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/gu;
const reservedStamp = /\[\d+:\d{1,2}(?:[.:]\d{1,3})?\]/u;
const lastLineMs = 5000;

export const capabilities = {
  agents: false,
  backing: false,
  metadata: {
    album: true,
    apple: false,
    artist: true,
    author: true,
    songwriters: true,
    title: true,
  },
  pronunciation: false,
  trackGenerated: false,
  trackKind: false,
  translation: false,
  wordTiming: true,
} satisfies FormatCapabilities;

function readRows(text: string, tags: Map<string, string>): EslrcRow[] {
  const rows: EslrcRow[] = [];
  for (const [lineIndex, physicalLine] of splitLines(text).entries()) {
    const tag = readTag(physicalLine);
    if (tag) {
      tags.set(tag.name, tag.text);
      continue;
    }

    stamp.lastIndex = 0;
    const matches: RegExpExecArray[] = [];
    let match = stamp.exec(physicalLine);
    while (match) {
      matches.push(match);
      match = stamp.exec(physicalLine);
    }
    const firstAt = matches.at(0)?.index;
    const [first, ...following] = matches.map((marker, markerIndex) => {
      const colon = marker[0].indexOf(":");
      const dot = marker[0].indexOf(".", colon + 1);
      const secondColon = marker[0].indexOf(":", colon + 1);
      const fraction = dot >= 0 ? dot : secondColon;
      const end = marker[0].length - 1;
      const next = matches[markerIndex + 1];
      return {
        begin: readStamp(
          marker[0].slice(1, colon),
          marker[0].slice(colon + 1, fraction >= 0 ? fraction : end),
          fraction >= 0 ? marker[0].slice(fraction + 1, end) : undefined
        ),
        text: physicalLine.slice(
          marker.index + marker[0].length,
          next === undefined ? physicalLine.length : next.index
        ),
      };
    });
    if (!first) {
      if (physicalLine.trim().length > 0 && physicalLine.startsWith("[")) {
        throw new ParseError(`malformed eslrc line ${lineIndex + 1}`);
      }
      continue;
    }
    if (firstAt !== 0) {
      throw new ParseError(
        `eslrc line ${lineIndex + 1} must start with a timestamp`
      );
    }
    rows.push({ first, following });
  }

  if (rows.length === 0) {
    throw new ParseError("input contains no recognizable eslrc lyric lines");
  }
  return rows;
}

function makeLines(rows: EslrcRow[]) {
  return rows.map((row, lineIndex) => {
    const markers = [row.first, ...row.following];
    const lastMarker = row.following.at(-1);
    const explicitEnd =
      lastMarker?.text.length === 0 ? lastMarker.begin : undefined;
    const sourceEnd =
      explicitEnd ??
      rows[lineIndex + 1]?.first.begin ??
      row.first.begin + lastLineMs;
    const timedSegments = markers.flatMap((marker, markerIndex) => {
      if (marker.text.length === 0) {
        return [];
      }
      return [
        {
          begin: marker.begin,
          end: markers[markerIndex + 1]?.begin ?? sourceEnd,
          text: marker.text,
        },
      ];
    });
    const syllables =
      timedSegments.length > 0
        ? timedSegments
        : [
            {
              begin: row.first.begin,
              end: sourceEnd,
              text: "",
            },
          ];
    return {
      agent: null,
      b: [],
      begin: row.first.begin,
      end: sourceEnd,
      id: `l${lineIndex}`,
      p: syllables.map((syllable, syllableIndex) => ({
        ...syllable,
        id: `l${lineIndex}w${syllableIndex}`,
      })),
    };
  });
}

export function read(text: string, options: ReadOptions = {}): LyricsDocument {
  if (options.expandRepeats) {
    throw new Error("expandRepeats is available for lrc input");
  }
  const tags = new Map<string, string>();
  const rows = readRows(text, tags);
  const album = tags.get("al");
  const artist = tags.get("ar");
  const author = tags.get("by");
  const offsetText = tags.get("offset");
  const offset = offsetText === undefined ? 0 : readOffset(offsetText, "eslrc");
  const songwriter = tags.get("au");
  const title = tags.get("ti");
  const meta = {
    ...(album !== undefined && { album }),
    ...(artist !== undefined && { artist }),
    ...(author && { author }),
    ...(songwriter !== undefined && { songwriters: [songwriter] }),
    ...(title !== undefined && { title }),
  };

  return shiftTimes(
    {
      agents: [],
      lines: makeLines(rows),
      meta,
      timing: "word",
      version: 1,
    },
    offset,
    "eslrc"
  );
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const doc = prepare(source, capabilities, "eslrc", options);
  checkLines(doc, "eslrc");
  checkWrite(doc, "eslrc", capabilities);
  checkMetaText(doc.meta, "eslrc");
  for (const line of doc.lines) {
    for (const syllable of line.p) {
      checkText(syllable.text, "eslrc", reservedStamp);
    }
  }
  if (doc.meta.songwriters?.length === 0) {
    throw new Error("eslrc cannot represent an empty songwriter list");
  }
  if (doc.meta.songwriters?.some((songwriter) => songwriter.length === 0)) {
    throw new Error("eslrc cannot represent an empty songwriter name");
  }
  if (doc.meta.songwriters && doc.meta.songwriters.length > 1) {
    throw new Error("eslrc cannot represent multiple songwriters");
  }
  return [
    ...(doc.meta.title === undefined ? [] : [`[ti:${doc.meta.title}]`]),
    ...(doc.meta.artist === undefined ? [] : [`[ar:${doc.meta.artist}]`]),
    ...(doc.meta.album === undefined ? [] : [`[al:${doc.meta.album}]`]),
    `[by:${doc.meta.author === undefined ? "" : doc.meta.author}]`,
    ...(doc.meta.songwriters?.[0] === undefined
      ? []
      : [`[au:${doc.meta.songwriters[0]}]`]),
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
      let serialized = `[${writeStamp(line.begin)}]`;
      for (const syllable of line.p) {
        if (syllable.begin !== currentTime) {
          serialized += `[${writeStamp(syllable.begin)}]`;
        }
        serialized += `${syllable.text}[${writeStamp(syllable.end)}]`;
        currentTime = syllable.end;
      }
      if (currentTime !== line.end) {
        serialized += `[${writeStamp(line.end)}]`;
      }
      return serialized;
    }),
  ].join("\n");
}
