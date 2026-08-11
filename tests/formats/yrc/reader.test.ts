import { describe, expect, test } from "bun:test";
import { ParseError } from "../../../src";
import { read, write } from "../../../src/formats/yrc";

describe("yrc reader", () => {
  test("accepts a BOM and CRLF endings", () => {
    const doc = read(
      "\uFEFF[1001,1001](1001,1001,0)one\r\n[3003,1001](3003,1001,0)two\r\n"
    );

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1001, 2002],
      [3003, 4004],
    ]);
  });

  test("reads songwriter JSON preambles and removes duplicates", () => {
    const source = [
      JSON.stringify({ c: [{ tx: "作词: " }, { tx: "One/Two" }], t: 0 }),
      JSON.stringify({ c: [{ tx: "作曲：" }, { tx: "One" }], t: 1 }),
      JSON.stringify({ c: [{ tx: "编曲: " }, { tx: "Ignored" }], t: 2 }),
      "[1000,1000](1000,1000,0)line",
    ].join("\n");

    expect(read(source).meta.songwriters).toEqual(["One", "Two"]);
  });

  test("combines an au tag with JSON songwriters without duplicates", () => {
    const source = [
      JSON.stringify({ c: [{ tx: "作词: " }, { tx: "One/Two" }], t: 0 }),
      "[au:Two]",
      "[1000,1000](1000,1000,0)lyric",
    ].join("\n");

    expect(read(source).meta.songwriters).toEqual(["One", "Two"]);
  });

  test("parses an empty line distinctly from a whitespace-only line", () => {
    const doc = read("[1000,1000]\n[2000,1000]   ");

    expect(doc.lines[0]?.p).toEqual([]);
    expect(doc.lines[1]?.p).toEqual([
      { begin: 2000, end: 3000, id: "l1w0", text: "   " },
    ]);
  });

  // a whitespace-only row carries no lyric text, so it drops with empty rows
  test("drops empty and whitespace-only lines on write", () => {
    const doc = read("[1000,1000]\n[2000,1000]   \n[3000,1000](3000,1000,0)Hi");

    expect(read(write(doc)).lines).toMatchObject([{ p: [{ text: "Hi" }] }]);
  });

  test("preserves overlapping rows and exact integer word times", () => {
    const doc = read(
      "[1001,1502](1001,751,0)one(1752,751,0)two\n[2002,1001](2002,1001,0)overlap"
    );

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1001, 2503],
      [2002, 3003],
    ]);
    expect(
      doc.lines
        .slice(0, 1)
        .flatMap((line) => line.p.map((word) => [word.begin, word.end]))
    ).toEqual([
      [1001, 1752],
      [1752, 2503],
    ]);
  });

  test("keeps whitespace with the syllable before its next marker", () => {
    const doc = read(
      "[12000,1300](12000,400,0)Hel(12400,300,0)lo (12700,600,0)world"
    );

    expect(doc.lines[0]?.p).toEqual([
      { begin: 12_000, end: 12_400, id: "l0w0", text: "Hel" },
      { begin: 12_400, end: 12_700, id: "l0w1", text: "lo " },
      { begin: 12_700, end: 13_300, id: "l0w2", text: "world" },
    ]);
    expect(write(doc)).toContain(
      "(12000,400,0)Hel(12400,300,0)lo (12700,600,0)world"
    );
  });

  test("reads metadata and consumes a positive offset", () => {
    const doc = read(
      [
        "[ti:Song]",
        "[ar:Singer]",
        "[al:Album]",
        "[by:Author]",
        "[au:Writer]",
        "[offset:+25]",
        "[1001,1502](1001,751,0)Hel(1752,751,0)lo",
      ].join("\n")
    );

    expect(doc.meta).toEqual({
      album: "Album",
      artist: "Singer",
      author: "Author",
      songwriters: ["Writer"],
      title: "Song",
    });
    expect(doc.lines[0]).toMatchObject({ begin: 1026, end: 2528 });
    expect(
      doc.lines
        .slice(0, 1)
        .map((line) => line.p.map((word) => word.text).join(""))
    ).toEqual(["Hello"]);
    expect(
      doc.lines
        .slice(0, 1)
        .flatMap((line) => line.p.map((word) => [word.begin, word.end]))
    ).toEqual([
      [1026, 1777],
      [1777, 2528],
    ]);
  });

  test("adds negative offsets to every timed range", () => {
    const doc = read("[offset:-25]\n[1001,1502](1001,751,0)Hel(1752,751,0)lo");

    expect(doc.meta).toEqual({});
    expect(doc.lines[0]).toMatchObject({ begin: 976, end: 2478 });
    expect(
      doc.lines
        .slice(0, 1)
        .flatMap((line) => line.p.map((word) => [word.begin, word.end]))
    ).toEqual([
      [976, 1727],
      [1727, 2478],
    ]);
  });

  test.each([
    "plain lyrics",
    "{broken",
    JSON.stringify({ t: 0 }),
    "[1000,1000](1000,1000,1)unsupported",
    "[1000,1000]untimed",
  ])("throws ParseError for malformed or unsupported input", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });

  test("folds a zero-duration whitespace spacer into the preceding syllable", () => {
    const doc = read(
      "[1000,1300](1000,400,0)Hello(1400,0,0) (1400,600,0)world"
    );

    expect(doc.lines[0]?.p).toEqual([
      { begin: 1000, end: 1400, id: "l0w0", text: "Hello " },
      { begin: 1400, end: 2000, id: "l0w1", text: "world" },
    ]);
  });

  test("keeps a zero-duration token with real lyric text unmerged", () => {
    const doc = read(
      "[1000,1300](1000,400,0)Hel(1400,400,0)lo(1800,0,0)zap(1800,500,0)world"
    );

    expect(doc.lines[0]?.p).toEqual([
      { begin: 1000, end: 1400, id: "l0w0", text: "Hel" },
      { begin: 1400, end: 1800, id: "l0w1", text: "lo" },
      { begin: 1800, end: 1800, id: "l0w2", text: "zap" },
      { begin: 1800, end: 2300, id: "l0w3", text: "world" },
    ]);
  });

  test("rejects a leading zero-duration spacer", () => {
    expect(() => read("[1000,1000](1000,0,0) (1000,500,0)Hello")).toThrow(
      "yrc line 1 begins with a zero-time separator"
    );
  });
});
