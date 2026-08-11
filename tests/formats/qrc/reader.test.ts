import { describe, expect, test } from "bun:test";
import { ParseError } from "../../../src";
import { read, write } from "../../../src/formats/qrc";

describe("qrc reader", () => {
  test("accepts a BOM and CRLF endings", () => {
    const doc = read(
      "\uFEFF[1001,1001]one(1001,1001)\r\n[3003,1001]two(3003,1001)\r\n"
    );

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1001, 2002],
      [3003, 4004],
    ]);
  });

  test("reads suffix markers with exact spacing and integer times", () => {
    const doc = read(
      "[12000,1300]Hel(12000,400)lo (12400,300)world(12700,600)"
    );

    expect(doc.lines[0]).toMatchObject({ begin: 12_000, end: 13_300 });
    expect(doc.lines[0]?.p).toEqual([
      { begin: 12_000, end: 12_400, id: "l0w0", text: "Hel" },
      { begin: 12_400, end: 12_700, id: "l0w1", text: "lo " },
      { begin: 12_700, end: 13_300, id: "l0w2", text: "world" },
    ]);
  });

  test("joins an isolated wrapped row as backing vocals", () => {
    const doc = read(
      "[1000,2000]Lead(1000,2000)\n[1500,1000](Echo)(1500,1000)"
    );

    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0]).toMatchObject({ begin: 1000, end: 3000 });
    expect(doc.lines[0]?.p[0]?.text).toBe("Lead");
    expect(doc.lines[0]?.b).toEqual([
      { begin: 1500, end: 2500, id: "l0b0", text: "Echo" },
    ]);
    expect(read(write(doc))).toEqual(doc);
  });

  test("preserves overlapping lyric rows", () => {
    const doc = read("[1000,1000]one(1000,1000)\n[1500,1000]two(1500,1000)");

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1000, 2000],
      [1500, 2500],
    ]);
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
        "[1001,1502]Hel(1001,751)lo(1752,751)",
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
    const doc = read("[offset:-25]\n[1001,1502]Hel(1001,751)lo(1752,751)");

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
    "[1000,x]broken",
    "[1000,1000]word(1000,500)tail",
  ])("throws ParseError for unreadable input", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });

  test("folds a zero-duration whitespace spacer into the preceding syllable", () => {
    const doc = read("[1000,1300]Hello(1000,400) (1400,0)world(1400,600)");

    expect(doc.lines[0]?.p).toEqual([
      { begin: 1000, end: 1400, id: "l0w0", text: "Hello " },
      { begin: 1400, end: 2000, id: "l0w1", text: "world" },
    ]);
  });

  test("keeps a zero-duration token with real lyric text unmerged", () => {
    const doc = read("[1000,1300]Hello(1000,400)zap(1400,0)world(1400,600)");

    expect(doc.lines[0]?.p).toEqual([
      { begin: 1000, end: 1400, id: "l0w0", text: "Hello" },
      { begin: 1400, end: 1400, id: "l0w1", text: "zap" },
      { begin: 1400, end: 2000, id: "l0w2", text: "world" },
    ]);
  });

  test("rejects a leading zero-duration spacer", () => {
    expect(() => read("[1000,1000] (1000,0)Hello(1000,500)")).toThrow(
      "qrc line 1 begins with a zero-time separator"
    );
  });
});
