/**
 * lrc (lyrics), plain line-timed lyrics.
 * by the community; de-facto standard since the late-1990s mp3 player era
 *
 * [ti:Title]
 * [ar:Artist]
 *
 * [00:12.00]Hello world
 * [00:15.30][01:02.10]repeated chorus line
 */

import { ParseError } from "../errors";
import { readTag, writeTags } from "../internal/lyric-tags";
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

interface LrcRow {
  begin: number;
  body: string;
  order: number;
}

const lineStamp = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/gy;
const wordStamp = /<(\d+):(\d{1,2})(?:[.:](\d{1,3}))?>/gu;
const reservedStamp = /<\d+:\d{1,2}(?:[.:]\d{1,3})?>/u;
const lastLineMs = 5000;

export const capabilities = {
  agents: false,
  author: true,
  backing: false,
  pronunciation: false,
  translation: false,
  wordTiming: false,
} satisfies FormatCapabilities;

function readTime(marker: string) {
  const colon = marker.indexOf(":");
  const dot = marker.indexOf(".", colon + 1);
  const secondColon = marker.indexOf(":", colon + 1);
  const fraction = dot >= 0 ? dot : secondColon;
  const end = marker.length - 1;
  return readStamp(
    marker.slice(1, colon),
    marker.slice(colon + 1, fraction >= 0 ? fraction : end),
    fraction >= 0 ? marker.slice(fraction + 1, end) : undefined
  );
}

function readWords(body: string, lineEnd: number) {
  wordStamp.lastIndex = 0;
  const markers: RegExpExecArray[] = [];
  let match = wordStamp.exec(body);
  while (match) {
    markers.push(match);
    match = wordStamp.exec(body);
  }
  const first = markers.at(0);
  if (!first) {
    return [];
  }
  if (first.index !== 0) {
    throw new ParseError("enhanced lrc text must begin with a word timestamp");
  }
  return markers.map((marker, index) => {
    const next = markers[index + 1];
    return {
      begin: readTime(marker[0]),
      end: next ? readTime(next[0]) : lineEnd,
      text: body.slice(
        marker.index + marker[0].length,
        next === undefined ? body.length : next.index
      ),
    };
  });
}

function readRows(
  text: string,
  tags: Map<string, string>,
  expandRepeats: boolean
): LrcRow[] {
  const rows: LrcRow[] = [];
  for (const [lineIndex, raw] of splitLines(text).entries()) {
    const tag = readTag(raw);
    if (tag) {
      tags.set(tag.name, tag.text);
      continue;
    }

    lineStamp.lastIndex = 0;
    const stamps: number[] = [];
    let consumed = 0;
    let timestamp = lineStamp.exec(raw);
    while (timestamp) {
      stamps.push(readTime(timestamp[0]));
      consumed = lineStamp.lastIndex;
      timestamp = lineStamp.exec(raw);
    }
    if (stamps.length === 0) {
      if (raw.trim().length > 0 && raw.startsWith("[")) {
        throw new ParseError(`malformed lrc line ${lineIndex + 1}`);
      }
      continue;
    }

    const body = raw.slice(consumed);
    const selectedStamps = expandRepeats ? stamps : stamps.slice(0, 1);
    for (const begin of selectedStamps) {
      rows.push({ begin, body, order: lineIndex });
    }
  }
  if (rows.length === 0) {
    throw new ParseError("input contains no recognizable lrc lyric lines");
  }
  rows.sort(
    (left, right) => left.begin - right.begin || left.order - right.order
  );
  return rows;
}

function makeLines(rows: LrcRow[]) {
  let wordTimed = false;
  const lines = rows.map((row, lineIndex) => {
    const sourceEnd = rows[lineIndex + 1]?.begin ?? row.begin + lastLineMs;
    const words = readWords(row.body, sourceEnd);
    wordTimed ||= words.length > 0;
    return {
      agent: null,
      b: [],
      begin: row.begin,
      end: sourceEnd,
      id: `l${lineIndex}`,
      p:
        words.length > 0
          ? words.map((word, wordIndex) => ({
              begin: word.begin,
              end: word.end,
              id: `l${lineIndex}w${wordIndex}`,
              text: word.text,
            }))
          : [
              {
                begin: row.begin,
                end: sourceEnd,
                id: `l${lineIndex}w0`,
                text: row.body,
              },
            ],
    };
  });
  return { lines, wordTimed };
}

export function read(text: string, options: ReadOptions = {}): LyricsDocument {
  const tags = new Map<string, string>();
  const rows = readRows(text, tags, options.expandRepeats ?? false);
  const offsetText = tags.get("offset");
  const offset = offsetText === undefined ? 0 : readOffset(offsetText, "lrc");
  const songwriters = tags.get("au");
  const author = tags.get("by");
  const meta = {
    ...(tags.has("al") && { album: tags.get("al") }),
    ...(tags.has("ar") && { artist: tags.get("ar") }),
    ...(author && { author }),
    ...(songwriters !== undefined && { songwriters: [songwriters] }),
    ...(tags.has("ti") && { title: tags.get("ti") }),
  };
  const { lines, wordTimed } = makeLines(rows);
  return shiftTimes(
    {
      agents: [],
      lines,
      meta,
      timing: wordTimed ? "word" : "line",
      version: 1,
    },
    offset,
    "lrc"
  );
}

export function write(doc: LyricsDocument, options: WriteOptions = {}): string {
  if (Object.keys(options).length > 0) {
    throw new Error("lrc write options are unsupported");
  }
  checkLines(doc, "lrc");
  checkWrite(doc, "lrc", capabilities);
  for (const [lineIndex, line] of doc.lines.entries()) {
    const expectedEnd =
      doc.lines[lineIndex + 1]?.begin ?? line.begin + lastLineMs;
    if (line.end !== expectedEnd) {
      throw new Error(`lrc cannot represent the end time of line ${line.id}`);
    }
    if (line.p.length !== 1) {
      throw new Error(
        `lrc cannot represent the primary syllable count of line ${line.id}`
      );
    }
    if (
      line.p.some(
        (syllable) => syllable.begin !== line.begin || syllable.end !== line.end
      )
    ) {
      throw new Error(
        `lrc cannot represent the primary syllable range of line ${line.id}`
      );
    }
    for (const syllable of line.p) {
      checkText(syllable.text, "lrc", reservedStamp);
    }
  }
  return [
    ...writeTags(doc.meta, "lrc"),
    ...doc.lines.map(
      (line) =>
        `[${writeStamp(line.begin)}]${line.p
          .map((syllable) => syllable.text)
          .join("")}`
    ),
  ].join("\n");
}
