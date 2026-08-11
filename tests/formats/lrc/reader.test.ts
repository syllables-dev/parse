import { describe, expect, test } from "bun:test";
import { read } from "@/formats/lrc";
import { ParseError } from "@/index";

describe("lrc reader", () => {
  test("accepts a BOM and CRLF endings", () => {
    const doc = read("\uFEFF[00:01.001]one\r\n[00:02.002]two\r\n");

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1001, 2002],
      [2002, 7002],
    ]);
  });

  test("expands repeated timestamps only when requested", () => {
    const source = "[00:01.000][00:02.000]chorus\n[00:03.000]following";

    expect(read(source).lines.map((line) => line.begin)).toEqual([1000, 3000]);
    expect(
      read(source, { expandRepeats: true }).lines.map((line) => [
        line.begin,
        line.p[0]?.text,
      ])
    ).toEqual([
      [1000, "chorus"],
      [2000, "chorus"],
      [3000, "following"],
    ]);
  });

  test("treats A2 markers as starts and inherits the line end", () => {
    const doc = read(
      "[00:01.111]<00:01.111>Hel <00:01.789>lo\n[00:02.345]next"
    );

    expect(doc.timing).toBe("word");
    expect(doc.lines[0]?.p).toEqual([
      { begin: 1111, end: 1789, id: "l0w0", text: "Hel " },
      { begin: 1789, end: 2345, id: "l0w1", text: "lo" },
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
        "[offset:+250]",
        "[00:01.234]<00:01.234>one <00:01.999>two",
        "[00:02.500]next",
      ].join("\n")
    );

    expect(doc.meta).toEqual({
      album: "Album",
      artist: "Singer",
      author: "Author",
      songwriters: ["Writer"],
      title: "Song",
    });
    expect(doc.lines[0]).toMatchObject({ begin: 1484, end: 2750 });
    expect(
      doc.lines
        .slice(0, 1)
        .map((line) => line.p.map((word) => word.text).join(""))
    ).toEqual(["one two"]);
    expect(
      doc.lines
        .slice(0, 1)
        .flatMap((line) => line.p.map((word) => [word.begin, word.end]))
    ).toEqual([
      [1484, 2249],
      [2249, 2750],
    ]);
  });

  test("adds negative offsets to line and A2 word timestamps", () => {
    const doc = read(
      "[offset:-250]\n[00:01.000]<00:01.000>one <00:01.500>two\n[00:02.000]next"
    );

    expect(doc.meta).toEqual({});
    expect(doc.lines[0]).toMatchObject({ begin: 750, end: 1750 });
    expect(doc.lines[0]?.p).toEqual([
      { begin: 750, end: 1250, id: "l0w0", text: "one " },
      { begin: 1250, end: 1750, id: "l0w1", text: "two" },
    ]);
  });

  test.each([
    "plain lyrics",
    "[00:60.000]bad seconds",
    "[00:01.000]prefix<00:01.000>word",
    "[offset:-1]\n[00:00.000]negative time",
    "[offset:+9007199254740991]\n[00:00.001]unsafe time",
  ])("throws ParseError for unreadable input", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });
});
