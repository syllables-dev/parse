import { lysSideLines } from "@/formats/lys/agents";
import { lostIf } from "@/internal/projections";
import { suffixMark } from "@/internal/timed-words";
import { checkTime } from "@/internal/timestamps";
import { checkText } from "@/internal/write-check";
import type {
  ConversionLoss,
  FormatId,
  LyricsDocument,
  LyricsLine,
  Syllable,
} from "@/types";

function rowRange(line: LyricsLine) {
  const syllables = [...line.p, ...line.b];
  return {
    begin: Math.min(...syllables.map((syllable) => syllable.begin)),
    end: Math.max(...syllables.map((syllable) => syllable.end)),
  };
}

function fitsRow(line: LyricsLine) {
  const range = rowRange(line);
  return range.begin === line.begin && range.end === line.end;
}

export function rangeLosses(doc: LyricsDocument): ConversionLoss[] {
  return lostIf(
    "lineRange",
    doc.lines.some((line) => line.p.length > 0 && !fitsRow(line))
  );
}

export function fittedLines(doc: LyricsDocument): LyricsLine[] {
  return doc.lines
    .filter((line) => line.p.length > 0)
    .map((line) => ({ ...line, ...rowRange(line) }));
}

function writeRow(property: number, syllables: Syllable[], wrap: boolean) {
  return `[${property}]${syllables
    .map((syllable, wordIndex) => {
      const duration = syllable.end - syllable.begin;
      checkTime(duration, `syllable ${syllable.id} duration`);
      const prefix = wrap && wordIndex === 0 ? "(" : "";
      const suffix = wrap && wordIndex === syllables.length - 1 ? ")" : "";
      return `${prefix}${syllable.text}${suffix}(${syllable.begin},${duration})`;
    })
    .join("")}`;
}

export function writeRows(doc: LyricsDocument, format: FormatId): string[] {
  for (const line of doc.lines) {
    for (const syllable of [...line.p, ...line.b]) {
      checkText(syllable.text, format, suffixMark);
    }
  }
  for (const line of doc.lines) {
    if (line.p.length === 0 && line.b.length > 0) {
      throw new Error(`${format} cannot preserve backing-only line ${line.id}`);
    }
  }
  const rows: string[] = [];
  for (const [line, side] of lysSideLines(doc)) {
    if (!fitsRow(line)) {
      throw new Error(
        `${format} cannot represent the range of line ${line.id}`
      );
    }
    if (line.p.length > 0) {
      rows.push(writeRow(side + 3, line.p, false));
    }
    if (line.b.length > 0) {
      rows.push(writeRow(side + 6, line.b, true));
    }
  }
  return rows;
}
