import { ParseError } from "../errors";
import { toInt } from "./timestamps";

export interface TimedWord {
  begin: number;
  end: number;
  text: string;
}

const suffixStamp = /\((\d+),(\d+)\)/gu;
const yrcStamp = /\((\d+),(\d+),(-?\d+)\)/gu;
const whitespace = /^\s+$/u;

export function readTimedWords(
  body: string,
  lineNumber: number,
  lineBegin: number,
  lineEnd: number
): TimedWord[] {
  if (whitespace.test(body)) {
    return [{ begin: lineBegin, end: lineEnd, text: body }];
  }
  const words: TimedWord[] = [];
  let cursor = 0;

  suffixStamp.lastIndex = 0;
  let marker = suffixStamp.exec(body);
  while (marker) {
    const begin = toInt(marker[1] ?? "", `line ${lineNumber} word start`);
    const duration = toInt(marker[2] ?? "", `line ${lineNumber} word duration`);
    if (!Number.isSafeInteger(begin + duration)) {
      throw new ParseError(
        `line ${lineNumber} word end exceeds the safe integer range`
      );
    }
    words.push({
      begin,
      end: begin + duration,
      text: body.slice(cursor, marker.index),
    });
    cursor = suffixStamp.lastIndex;
    marker = suffixStamp.exec(body);
  }

  if (cursor !== body.length) {
    throw new ParseError(`line ${lineNumber} has untimed trailing text`);
  }
  return words;
}

export function readYrcWords(
  body: string,
  lineNumber: number,
  lineBegin: number,
  lineEnd: number
): TimedWord[] {
  if (body.length === 0) {
    return [];
  }
  if (whitespace.test(body)) {
    return [{ begin: lineBegin, end: lineEnd, text: body }];
  }
  const markers = [...body.matchAll(yrcStamp)];
  if ((markers[0]?.index ?? -1) !== 0) {
    throw new ParseError(`line ${lineNumber} must begin with a word timestamp`);
  }

  return markers.map((marker, index) => {
    if (marker[3] !== "0") {
      throw new ParseError(`line ${lineNumber} has an unsupported word flag`);
    }
    const begin = toInt(marker[1] ?? "", `line ${lineNumber} word start`);
    const duration = toInt(marker[2] ?? "", `line ${lineNumber} word duration`);
    if (!Number.isSafeInteger(begin + duration)) {
      throw new ParseError(
        `line ${lineNumber} word end exceeds the safe integer range`
      );
    }
    return {
      begin,
      end: begin + duration,
      text: body.slice(
        (marker.index ?? 0) + marker[0].length,
        markers[index + 1]?.index ?? body.length
      ),
    };
  });
}
