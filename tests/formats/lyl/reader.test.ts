import { describe, expect, test } from "bun:test";
import { read } from "@/formats/lyl";
import { ParseError } from "@/index";

describe("lyl reader", () => {
  test("reads metadata and consumes a positive offset", () => {
    const doc = read(
      [
        "[type:LyricifyLines]",
        "[ti:Song]",
        "[ar:Singer]",
        "[al:Album]",
        "[by:Author]",
        "[au:Writer]",
        "[offset:+250]",
        "[1000,2000]one",
      ].join("\n")
    );

    expect(doc.meta).toEqual({
      album: "Album",
      artist: "Singer",
      author: "Author",
      songwriters: ["Writer"],
      title: "Song",
    });
    expect(doc.lines[0]).toMatchObject({ begin: 1250, end: 2250 });
  });

  test("keeps the silence between lines", () => {
    const doc = read("[1000,2000]one\n[9000,9500]two");

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1000, 2000],
      [9000, 9500],
    ]);
  });

  test("rejects a foreign type declaration", () => {
    expect(() => read("[type:LyricifySyllable]\n[1000,2000]one")).toThrow(
      "lyl declares the unknown type LyricifySyllable"
    );
  });

  test("rejects a line that ends before it starts", () => {
    expect(() => read("[2000,1000]one")).toThrow(ParseError);
  });
});
