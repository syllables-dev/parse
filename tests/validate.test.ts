import { describe, expect, test } from "bun:test";
import type { LyricsLine } from "../src";
import { createDocument, validate } from "../src";

function timedLine(
  id: string,
  begin: number,
  end: number,
  text = "lyric"
): LyricsLine {
  return {
    agent: null,
    b: [],
    begin,
    end,
    id,
    p: [{ begin, end, id: `${id}w0`, text }],
  };
}

describe("validate", () => {
  test("reports line order on the later line", () => {
    const doc = createDocument();
    doc.lines.push(
      timedLine("first", 1000, 2000),
      timedLine("second", 500, 1500)
    );

    expect(validate(doc).map(({ code, id }) => ({ code, id }))).toEqual([
      { code: "line-out-of-order", id: "second" },
    ]);
  });

  // overlapping lines are valid layered vocals in ttml, lqe, lys, qrc, and yrc
  test("accepts overlapping lines", () => {
    const doc = createDocument();
    doc.lines.push(
      timedLine("first", 1000, 3000),
      timedLine("second", 2000, 4000)
    );

    expect(validate(doc)).toEqual([]);
  });

  test("reports invalid line and syllable ranges", () => {
    const doc = createDocument();
    const line = timedLine("range", 0, 1000);
    line.p = [
      { begin: -1, end: 50, id: "outside", text: "out" },
      { begin: 100, end: 200, id: "ordered", text: "in" },
      { begin: 50, end: 40, id: "reversed", text: "back" },
      { begin: 300, end: 300, id: "zero", text: "still" },
    ];
    doc.lines.push(line, timedLine("line-range", 2000, 2000, ""));

    expect(validate(doc).map(({ code, id }) => ({ code, id }))).toEqual([
      { code: "syllable-outside-line", id: "outside" },
      { code: "syllable-out-of-order", id: "reversed" },
      { code: "syllable-invalid-range", id: "reversed" },
      { code: "line-invalid-range", id: "line-range" },
    ]);
  });

  test("requires integer millisecond timestamps", () => {
    const doc = createDocument();
    doc.lines.push(timedLine("fractional", 0.5, 1000.5));

    expect(validate(doc).map(({ code, id }) => ({ code, id }))).toEqual([
      { code: "line-invalid-time", id: "fractional" },
      { code: "syllable-invalid-time", id: "fractionalw0" },
    ]);
  });

  test("validates backing vocals as their own ordered track", () => {
    const doc = createDocument();
    const line = timedLine("duet", 0, 1000);
    line.b = [
      { begin: 500, end: 700, id: "backing-late", text: "late" },
      { begin: 300, end: 300, id: "backing-early", text: "early" },
    ];
    doc.lines.push(line);

    expect(validate(doc).map(({ code, id }) => ({ code, id }))).toEqual([
      { code: "syllable-out-of-order", id: "backing-early" },
    ]);
  });

  test("validates pronunciation tracks without changing the document", () => {
    const doc = createDocument();
    const line = timedLine("spoken", 100, 900);
    line.pronunciations = {
      ja: {
        b: [{ begin: 500, end: 400, id: "pron-back", text: "く" }],
        p: [{ begin: 0, end: 300, id: "pron-main", text: "う" }],
      },
    };
    doc.lines.push(line);
    const before = structuredClone(doc);

    expect(validate(doc).map(({ code, id }) => ({ code, id }))).toEqual([
      { code: "syllable-outside-line", id: "pron-main" },
      { code: "syllable-invalid-range", id: "pron-back" },
    ]);
    expect(doc).toEqual(before);
  });
});
