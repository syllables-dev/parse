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
    const comma = marker[0].indexOf(",");
    const begin = toInt(
      marker[0].slice(1, comma),
      `line ${lineNumber} word start`
    );
    const duration = toInt(
      marker[0].slice(comma + 1, -1),
      `line ${lineNumber} word duration`
    );
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
  yrcStamp.lastIndex = 0;
  const markers: RegExpExecArray[] = [];
  let match = yrcStamp.exec(body);
  while (match) {
    markers.push(match);
    match = yrcStamp.exec(body);
  }
  if (markers.at(0)?.index !== 0) {
    throw new ParseError(`line ${lineNumber} must begin with a word timestamp`);
  }

  return markers.map((marker, index) => {
    const next = markers[index + 1];
    const firstComma = marker[0].indexOf(",");
    const secondComma = marker[0].indexOf(",", firstComma + 1);
    if (marker[0].slice(secondComma + 1, -1) !== "0") {
      throw new ParseError(`line ${lineNumber} has an unsupported word flag`);
    }
    const begin = toInt(
      marker[0].slice(1, firstComma),
      `line ${lineNumber} word start`
    );
    const duration = toInt(
      marker[0].slice(firstComma + 1, secondComma),
      `line ${lineNumber} word duration`
    );
    if (!Number.isSafeInteger(begin + duration)) {
      throw new ParseError(
        `line ${lineNumber} word end exceeds the safe integer range`
      );
    }
    return {
      begin,
      end: begin + duration,
      text: body.slice(
        marker.index + marker[0].length,
        next === undefined ? body.length : next.index
      ),
    };
  });
}

/**
 * a zero-duration token is never meaningful on its own (lys `(0,0)`, qrc/yrc
 * a marker where begin === end); it always folds into the syllable to its
 * left, regardless of what text it carries.
 */
export function foldSpacers(
  words: TimedWord[],
  format: string,
  lineNumber: number,
  isSpacer: (word: TimedWord) => boolean
): TimedWord[] {
  const syllables: TimedWord[] = [];
  for (const word of words) {
    if (isSpacer(word)) {
      const previous = syllables.at(-1);
      if (!previous) {
        throw new ParseError(
          `${format} line ${lineNumber} begins with a zero-time separator`
        );
      }
      previous.text += word.text;
      continue;
    }
    syllables.push(word);
  }
  return syllables;
}
