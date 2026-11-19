import { ParseError } from "@/errors";
import type { FormatId, LyricsDocument, Syllable } from "@/types";

const lineBreak = /\r\n|\n|\r/u;
const digits = /^\d+$/u;
const signPrefix = /^[+-]/u;

export const clockStamp = String.raw`\d+:\d{1,2}(?:[.:]\d{1,3})?`;
export const lastLineMs = 5000;

export function splitLines(text: string): string[] {
  return (text.startsWith("\uFEFF") ? text.slice(1) : text).split(lineBreak);
}

export function toInt(value: string, context: string): number {
  if (!digits.test(value)) {
    throw new ParseError(`${context} must be a nonnegative integer`);
  }
  const integer = Number(value);
  if (!Number.isSafeInteger(integer)) {
    throw new ParseError(`${context} exceeds the safe integer range`);
  }
  return integer;
}

export function readOffset(
  source: string | undefined,
  format: FormatId
): number {
  if (source === undefined) {
    return 0;
  }
  const text = source.trim();
  const sign = text.startsWith("-") ? -1 : 1;
  return (
    sign *
    toInt(signPrefix.test(text) ? text.slice(1) : text, `${format} offset`)
  );
}

function applyOffset(
  timestamp: number,
  offset: number,
  context: string
): number {
  const shifted = timestamp + offset;
  if (!(Number.isSafeInteger(shifted) && shifted >= 0)) {
    throw new ParseError(`${context} exceeds the timestamp range`);
  }
  return shifted;
}

function shiftTrack(
  syllables: Syllable[],
  offset: number,
  context: string
): Syllable[] {
  return syllables.map((syllable, syllableIndex) => ({
    ...syllable,
    begin: applyOffset(
      syllable.begin,
      offset,
      `${context} word ${syllableIndex + 1} start`
    ),
    end: applyOffset(
      syllable.end,
      offset,
      `${context} word ${syllableIndex + 1} end`
    ),
  }));
}

export function shiftTimes(
  doc: LyricsDocument,
  offset: number,
  format: FormatId
): LyricsDocument {
  if (offset === 0) {
    return doc;
  }
  return {
    ...doc,
    lines: doc.lines.map((line, lineIndex) => ({
      ...line,
      b: shiftTrack(line.b, offset, `${format} backing`),
      begin: applyOffset(
        line.begin,
        offset,
        `${format} line ${lineIndex + 1} start`
      ),
      end: applyOffset(line.end, offset, `${format} line ${lineIndex + 1} end`),
      p: shiftTrack(line.p, offset, `${format} primary`),
    })),
  };
}

export function readClock(marker: string): number {
  const colon = marker.indexOf(":");
  const dot = marker.indexOf(".", colon + 1);
  const secondColon = marker.indexOf(":", colon + 1);
  const fraction = dot >= 0 ? dot : secondColon;
  const end = marker.length - 1;
  const minutes = toInt(marker.slice(1, colon), "timestamp minutes");
  const seconds = toInt(
    marker.slice(colon + 1, fraction >= 0 ? fraction : end),
    "timestamp seconds"
  );
  if (seconds > 59) {
    throw new ParseError("timestamp seconds must be less than 60");
  }
  const milliseconds =
    fraction >= 0
      ? toInt(
          marker.slice(fraction + 1, end).padEnd(3, "0"),
          "timestamp fraction"
        )
      : 0;
  const stamp = minutes * 60_000 + seconds * 1000 + milliseconds;
  if (!Number.isSafeInteger(stamp)) {
    throw new ParseError("timestamp exceeds the safe integer range");
  }
  return stamp;
}

export function writeStamp(milliseconds: number): string {
  checkTime(milliseconds, "timestamp");
  const minutes = Math.floor(milliseconds / 60_000);
  const remainder = milliseconds % 60_000;
  const seconds = Math.floor(remainder / 1000);
  const fraction = remainder % 1000;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${fraction.toString().padStart(3, "0")}`;
}

export function checkTime(value: number, context: string): void {
  if (!(Number.isSafeInteger(value) && value >= 0)) {
    throw new RangeError(`${context} must be a nonnegative safe integer`);
  }
}
