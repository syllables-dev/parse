import type { FormatCapabilities, LyricsDocument, LyricsLine } from "../types";
import { projectedLine } from "./line-projection";

interface QrcProjectionRow {
  lineIndex: number;
  track: "b" | "p";
  wrapped: boolean;
}

interface QrcProjectionLine {
  b: QrcProjectionRow[];
  p: QrcProjectionRow[];
}

function qrcWrappingPair(line: LyricsLine) {
  const first = line.p.findIndex((syllable) => syllable.text.length > 0);
  const last = line.p.findLastIndex((syllable) => syllable.text.length > 0);
  if (first < 0 || last < 0) {
    return;
  }
  const opening = line.p[first]?.text.at(0);
  const closing = line.p[last]?.text.at(-1);
  if (
    (opening === "(" && closing === ")") ||
    (opening === "（" && closing === "）")
  ) {
    return [first, last];
  }
}

function qrcWrappedPrimary(line: LyricsLine | undefined) {
  return line !== undefined && qrcWrappingPair(line) !== undefined;
}

function qrcWriteRows(
  doc: LyricsDocument,
  unwrapped: Set<number>
): QrcProjectionRow[] {
  return doc.lines.flatMap((line, lineIndex) => [
    ...(line.p.length > 0 || line.b.length === 0
      ? [
          {
            lineIndex,
            track: "p" as const,
            wrapped: qrcWrappedPrimary(line) && !unwrapped.has(lineIndex),
          },
        ]
      : [
          {
            lineIndex,
            track: "p" as const,
            wrapped: false,
          },
        ]),
    ...(line.b.length > 0
      ? [{ lineIndex, track: "b" as const, wrapped: true }]
      : []),
  ]);
}

function qrcBackingRow(rows: QrcProjectionRow[], rowIndex: number) {
  // qrc reads an isolated wrapped row as backing vocals.
  return (
    rows[rowIndex]?.wrapped === true &&
    !rows[rowIndex - 1]?.wrapped &&
    !rows[rowIndex + 1]?.wrapped
  );
}

function qrcRowsMatch(doc: LyricsDocument, unwrapped: Set<number>) {
  const rows = qrcWriteRows(doc, unwrapped);
  const parsed: QrcProjectionLine[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const backing = qrcBackingRow(rows, rowIndex);
    const previous = parsed.at(-1);
    if (backing && previous) {
      previous.b.push(row);
    } else {
      parsed.push({ b: backing ? [row] : [], p: backing ? [] : [row] });
    }
  }
  if (parsed.length !== doc.lines.length) {
    return false;
  }
  return parsed.every((line, lineIndex) => {
    const expected = doc.lines[lineIndex];
    return (
      expected !== undefined &&
      line.p.length === 1 &&
      line.p[0]?.lineIndex === lineIndex &&
      line.p[0]?.track === "p" &&
      line.b.length === Number(expected.b.length > 0) &&
      line.b.every((row) => row.lineIndex === lineIndex && row.track === "b")
    );
  });
}

export function qrcTextLosses(doc: LyricsDocument) {
  const unwrapped = new Set<number>();
  while (!qrcRowsMatch(doc, unwrapped)) {
    const rows = qrcWriteRows(doc, unwrapped);
    const isolated = rows.find(
      (row, rowIndex) =>
        row.track === "p" &&
        row.wrapped &&
        !unwrapped.has(row.lineIndex) &&
        qrcBackingRow(rows, rowIndex)
    );
    if (isolated) {
      unwrapped.add(isolated.lineIndex);
      continue;
    }
    const blockedBacking = rows.findIndex(
      (row, rowIndex) => row.track === "b" && !qrcBackingRow(rows, rowIndex)
    );
    const neighbor = [rows[blockedBacking - 1], rows[blockedBacking + 1]].find(
      (row) =>
        row?.track === "p" && row.wrapped && !unwrapped.has(row.lineIndex)
    );
    if (neighbor) {
      unwrapped.add(neighbor.lineIndex);
      continue;
    }
    return new Set<number>();
  }
  return unwrapped;
}

export function projectedQrcLines(
  doc: LyricsDocument,
  capabilities: FormatCapabilities,
  wordTimed: boolean
) {
  const unwrapped = qrcTextLosses(doc);
  return doc.lines.map((line, lineIndex) => {
    const pair = unwrapped.has(lineIndex) ? qrcWrappingPair(line) : undefined;
    const p =
      pair === undefined
        ? line.p
        : line.p.map((syllable, syllableIndex) => {
            let { text } = syllable;
            if (syllableIndex === pair[0]) {
              text = text.slice(1);
            }
            if (syllableIndex === pair[1]) {
              text = text.slice(0, -1);
            }
            return { ...syllable, text };
          });
    return projectedLine(
      { ...line, p },
      capabilities,
      wordTimed,
      line.translations,
      false
    );
  });
}
