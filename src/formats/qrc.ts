/**
 * QRC, QQ Music's word-by-word lyrics format.
 * by Tencent / QQ Music
 *
 * [12000,3320]Hel(12000,400)lo (12400,300)world(12700,600)
 */

import { ParseError } from "@/errors";
import { readTag, writeTags } from "@/internal/lyric-tags";
import { prepare } from "@/internal/projections";
import {
  foldSpacers,
  readTimedWords,
  type TimedWord,
} from "@/internal/timed-words";
import {
  checkTime,
  readOffset,
  shiftTimes,
  splitLines,
  toInt,
} from "@/internal/timestamps";
import {
  checkLines,
  checkText,
  checkWrite,
  hasLyricText,
} from "@/internal/write-check";
import type {
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
  ReadOptions,
  Syllable,
  WriteOptions,
} from "@/types";

interface QrcRow {
  begin: number;
  end: number;
  words: TimedWord[];
}

const lineHeader = /^\[(\d+),(\d+)\](.*)$/u;
const reservedStamp = /\(\d+,\d+\)/u;

export const capabilities = {
  agents: false,
  backing: false,
  metadata: {
    album: true,
    artist: true,
    songwriters: true,
    title: true,
  },
  pronunciation: false,
  timing: { line: false, static: false, word: true },
  trackGenerated: false,
  trackKind: false,
  translation: false,
} satisfies FormatCapabilities;

function makeTrack(
  words: TimedWord[],
  lineId: string,
  track: "b" | "w"
): Syllable[] {
  return words.map((word, wordIndex) => ({
    begin: word.begin,
    end: word.end,
    id: `${lineId}${track}${wordIndex}`,
    text: word.text,
  }));
}

function readRow(
  raw: string,
  lineIndex: number,
  tags: Map<string, string>
): QrcRow | null {
  const tag = readTag(raw);
  if (tag) {
    tags.set(tag.name, tag.text);
    return null;
  }
  const header = lineHeader.exec(raw);
  if (!header) {
    if (raw.trim().length > 0 && raw.startsWith("[")) {
      throw new ParseError(`malformed qrc line ${lineIndex + 1}`);
    }
    return null;
  }

  const comma = header[0].indexOf(",");
  const close = header[0].indexOf("]");
  const begin = toInt(
    header[0].slice(1, comma),
    `qrc line ${lineIndex + 1} start`
  );
  const duration = toInt(
    header[0].slice(comma + 1, close),
    `qrc line ${lineIndex + 1} duration`
  );
  if (!Number.isSafeInteger(begin + duration)) {
    throw new ParseError(
      `qrc line ${lineIndex + 1} end exceeds the safe integer range`
    );
  }
  const words = foldSpacers(
    readTimedWords(
      header[0].slice(close + 1),
      lineIndex + 1,
      begin,
      begin + duration
    ),
    "qrc",
    lineIndex + 1,
    (word) => word.begin === word.end
  );
  return {
    begin,
    end: begin + duration,
    words,
  };
}

// qrc carries no backing marker, so brackets stay ordinary text and every row is a lyric line
function makeLines(rows: QrcRow[]): LyricsLine[] {
  return rows.map((row, rowIndex) => {
    const lineId = `l${rowIndex}`;
    return {
      agent: null,
      b: [],
      begin: row.begin,
      end: row.end,
      id: lineId,
      p: makeTrack(row.words, lineId, "w"),
    };
  });
}

export function read(text: string, options: ReadOptions = {}): LyricsDocument {
  if (options.expandRepeats) {
    throw new Error("expandRepeats is available for lrc input");
  }
  const tags = new Map<string, string>();
  const rows: QrcRow[] = [];
  for (const [lineIndex, raw] of splitLines(text).entries()) {
    const row = readRow(raw, lineIndex, tags);
    if (row) {
      rows.push(row);
    }
  }
  if (rows.length === 0) {
    throw new ParseError("input contains no recognizable qrc lyric lines");
  }
  const album = tags.get("al");
  const artist = tags.get("ar");
  const offsetText = tags.get("offset");
  const offset = offsetText === undefined ? 0 : readOffset(offsetText, "qrc");
  const songwriter = tags.get("au");
  const title = tags.get("ti");
  const meta = {
    ...(album !== undefined && { album }),
    ...(artist !== undefined && { artist }),
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
    "qrc"
  );
}

function writeRow(
  begin: number,
  end: number,
  syllables: Syllable[],
  wrap: boolean
): string {
  const duration = end - begin;
  checkTime(duration, "qrc line duration");
  checkTime(begin, "qrc line start");
  return `[${begin},${duration}]${syllables
    .map((syllable, index) => {
      const syllableDuration = syllable.end - syllable.begin;
      checkTime(syllableDuration, `syllable ${syllable.id} duration`);
      checkTime(syllable.begin, `syllable ${syllable.id} start`);
      const prefix = wrap && index === 0 ? "(" : "";
      const suffix = wrap && index === syllables.length - 1 ? ")" : "";
      return `${prefix}${syllable.text}${suffix}(${syllable.begin},${syllableDuration})`;
    })
    .join("")}`;
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const prepared = prepare(source, capabilities, "qrc", options);
  const doc = {
    ...prepared,
    lines: prepared.lines.filter(hasLyricText),
  };
  checkLines(doc, "qrc");
  checkWrite(doc, "qrc", capabilities);
  for (const line of doc.lines) {
    for (const syllable of [...line.p, ...line.b]) {
      checkText(syllable.text, "qrc", reservedStamp);
    }
  }
  const lyricRows = doc.lines.map((line) =>
    writeRow(line.begin, line.end, line.p, false)
  );
  return [...writeTags(doc.meta, "qrc"), ...lyricRows].join("\n");
}
