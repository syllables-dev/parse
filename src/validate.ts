import type { LyricsDocument, LyricsLine, Problem, Syllable } from "./types";

function checkTrack(line: LyricsLine, syllables: Syllable[]): Problem[] {
  const problems: Problem[] = [];
  let previousBegin: number | undefined;

  for (const syllable of syllables) {
    if (
      !(
        Number.isSafeInteger(syllable.begin) &&
        Number.isSafeInteger(syllable.end)
      )
    ) {
      problems.push({
        code: "syllable-invalid-time",
        id: syllable.id,
        message: "syllable times must be integer milliseconds",
      });
    }
    if (previousBegin !== undefined && syllable.begin < previousBegin) {
      problems.push({
        code: "syllable-out-of-order",
        id: syllable.id,
        message: "syllable starts before the preceding syllable",
      });
    }
    if (syllable.end < syllable.begin) {
      problems.push({
        code: "syllable-invalid-range",
        id: syllable.id,
        message: "syllable ends before it begins",
      });
    } else if (syllable.end === syllable.begin) {
      // word codecs preserve punctuation at an instantaneous timestamp
      problems.push({
        code: "syllable-zero-length",
        id: syllable.id,
        message: "syllable has zero duration",
      });
    }
    if (syllable.begin < line.begin || syllable.end > line.end) {
      problems.push({
        code: "syllable-outside-line",
        id: syllable.id,
        message: "syllable extends outside its line",
      });
    }
    previousBegin = syllable.begin;
  }

  return problems;
}

function checkTiming(
  line: LyricsLine,
  previousBegin: number | undefined
): Problem[] {
  const problems: Problem[] = [];

  if (!(Number.isSafeInteger(line.begin) && Number.isSafeInteger(line.end))) {
    problems.push({
      code: "line-invalid-time",
      id: line.id,
      message: "line times must be integer milliseconds",
    });
  }
  if (previousBegin !== undefined && line.begin < previousBegin) {
    problems.push({
      code: "line-out-of-order",
      id: line.id,
      message: "line starts before the preceding line",
    });
  }
  if (line.end <= line.begin) {
    problems.push({
      code: "line-invalid-range",
      id: line.id,
      message: "line must end after it begins",
    });
  }

  return problems;
}

function checkContent(line: LyricsLine): Problem[] {
  const problems: Problem[] = [];
  const lineSyllables = [...line.p, ...line.b];

  if (lineSyllables.length === 0) {
    problems.push({
      code: "line-empty",
      id: line.id,
      message: "timed line is empty",
    });
  } else if (
    lineSyllables.every((syllable) => syllable.text.trim().length === 0)
  ) {
    problems.push({
      code: "line-without-text",
      id: line.id,
      message: "timed line has no text",
    });
  }
  return problems;
}

/**
 * reports timing and content problems without changing the document.
 *
 * legal overlapping lines remain in the document and are surfaced as findings.
 *
 * @param doc - the editable lyric document to inspect.
 * @returns problems in document and track order.
 */
export function validate(doc: LyricsDocument): Problem[] {
  const problems: Problem[] = [];
  let previousBegin: number | undefined;

  for (const line of doc.lines) {
    problems.push(
      ...checkTiming(line, previousBegin),
      ...checkContent(line),
      ...checkTrack(line, line.p),
      ...checkTrack(line, line.b)
    );
    for (const pronunciation of Object.values(line.pronunciations ?? {})) {
      for (const entry of [pronunciation, ...(pronunciation.variants ?? [])]) {
        if (entry) {
          problems.push(
            ...checkTrack(line, entry.p),
            ...checkTrack(line, entry.b)
          );
        }
      }
    }
    previousBegin = line.begin;
  }

  return problems;
}
