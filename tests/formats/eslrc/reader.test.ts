import { describe, expect, test } from "bun:test";
import { read, write } from "@/formats/eslrc";
import { ParseError } from "@/index";

describe("eslrc reader", () => {
  test("uses a trailing stamp as the line and final syllable end", () => {
    const doc = read(
      "[00:01.111]Hel[00:01.789]lo[00:02.345]\n[00:03.000]next[00:04.000]"
    );

    expect(doc.lines[0]).toMatchObject({ begin: 1111, end: 2345 });
    expect(doc.lines[0]?.p).toEqual([
      { begin: 1111, end: 1789, id: "l0w0", text: "Hel" },
      { begin: 1789, end: 2345, id: "l0w1", text: "lo" },
    ]);
  });

  test("reads empty and whitespace-only lyric lines, but drops them on write", () => {
    const doc = read(
      "[00:01.000][00:02.000]\n[00:03.000]   [00:04.000]\n[00:05.000]Real[00:06.000]"
    );

    expect(doc.lines.map((line) => line.p)).toEqual([
      [{ begin: 1000, end: 2000, id: "l0w0", text: "" }],
      [{ begin: 3000, end: 4000, id: "l1w0", text: "   " }],
      [{ begin: 5000, end: 6000, id: "l2w0", text: "Real" }],
    ]);
    expect(
      read(write(doc)).lines.map((line) => [
        line.begin,
        line.end,
        line.p.map((syllable) => syllable.text),
      ])
    ).toEqual([[5000, 6000, ["Real"]]]);
  });

  test("reads metadata and consumes a negative offset", () => {
    const doc = read(
      [
        "[ti:Song]",
        "[ar:Singer]",
        "[al:Album]",
        "[by:Author]",
        "[au:Writer]",
        "[offset:-25]",
        "[00:01.001]Hi[00:02.002]",
      ].join("\n")
    );

    expect(doc.meta).toEqual({
      album: "Album",
      artist: "Singer",
      author: "Author",
      songwriters: ["Writer"],
      title: "Song",
    });
    expect(doc.lines[0]).toMatchObject({ begin: 976, end: 1977 });
    expect(doc.lines[0]?.p[0]).toMatchObject({ begin: 976, end: 1977 });
  });

  test.each([
    "plain lyrics",
    "prefix[00:01.000]word",
    "[00:xx]broken",
    "[00:60.000]bad seconds",
  ])("throws ParseError for unreadable input", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });
});
