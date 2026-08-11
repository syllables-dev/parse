import { describe, expect, test } from "bun:test";
import { ParseError } from "../../../src";
import { read } from "../../../src/formats/lqe";
import { containerMark } from "./shared";

function makeLqe(...lines: string[]) {
  return [containerMark, "[version:1.0]", ...lines].join("\n");
}

describe("lqe reader", () => {
  test("accepts a BOM and CRLF endings", () => {
    const source =
      "\uFEFF[Lyricify Quick Export]\r\n[version:1.0]\r\n[lyrics: format@Lyricify Syllable]\r\n[4]one(1001,1001)\r\n";

    expect(read(source).lines[0]).toMatchObject({ begin: 1001, end: 2002 });
  });

  test("delegates zero-time separator normalization to LYS", () => {
    const doc = read(
      makeLqe(
        "[lyrics: format@Lyricify Syllable]",
        "[4]One(1000,500) (0,0),(0,0)，(0,0)Two(1500,500)"
      )
    );

    expect(doc.lines[0]?.p).toEqual([
      { begin: 1000, end: 1500, id: "l0w0", text: "One ,，" },
      { begin: 1500, end: 2000, id: "l0w1", text: "Two" },
    ]);
  });

  test("joins primary and backing translations at their own timestamps", () => {
    const doc = read(
      makeLqe(
        "[lyrics: format@Lyricify Syllable]",
        "[4]Lead(1000,1000)",
        "[7](Echo)(1200,500)",
        "",
        "[translation: language@zh-Hans, format@LRC]",
        "[00:01.000]你好",
        "[00:01.200](回声)"
      )
    );

    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0]?.p[0]?.begin).toBe(1000);
    expect(doc.lines[0]?.b[0]?.begin).toBe(1200);
    expect(doc.lines[0]?.translations).toEqual({
      "zh-Hans": { b: "回声", p: "你好" },
    });
  });

  test("keeps empty primary and backing translations", () => {
    const doc = read(
      makeLqe(
        "[lyrics: format@Lyricify Syllable]",
        "[4]Lead(1000,1000)",
        "[7](Echo)(1200,500)",
        "",
        "[translation: format@LRC]",
        "[00:01.000]",
        "[00:01.200]()"
      )
    );

    expect(doc.lines[0]?.translations).toEqual({
      und: { b: "", p: "" },
    });
  });

  test("reads metadata, consumes its offset, and ignores dead fields", () => {
    const doc = read(
      makeLqe(
        "[by:Author]",
        "[ti:Song]",
        "[ar:Singer]",
        "[al:Album]",
        "[au:Writer]",
        "[offset:900]",
        "",
        "[lyrics: format@Lyricify Syllable]",
        "[offset:800]",
        "[4]Lead(1000,500)",
        "",
        "[translation: format@LRC]",
        "[offset:700]",
        "[00:01.000]Meaning",
        "",
        "[pronunciation: language@ja, format@LRC]",
        "[00:01.000]Rōmaji"
      )
    );

    expect(doc.meta).toEqual({
      album: "Album",
      artist: "Singer",
      author: "Author",
      songwriters: ["Writer"],
      title: "Song",
    });
    expect(doc.lines[0]).toMatchObject({ begin: 1900, end: 2400 });
    expect(doc.lines[0]?.p[0]).toMatchObject({ begin: 1900, end: 2400 });
    expect(doc.lines[0]?.translations).toEqual({
      und: { p: "Meaning" },
    });
    expect(doc.lines[0]?.pronunciations).toBeUndefined();
  });

  test("trims the container version", () => {
    const doc = read(
      [
        containerMark,
        "[version: 1.0 ]",
        "[ti:Song]",
        "[lyrics: format@Lyricify Syllable]",
        "[4]Lyric(1000,500)",
      ].join("\n")
    );

    expect(doc.meta.title).toBe("Song");
    expect(doc.lines[0]?.p[0]?.text).toBe("Lyric");
  });

  test("adds a negative preamble offset after joining translations", () => {
    const doc = read(
      makeLqe(
        "[offset:-25]",
        "[lyrics: format@Lyricify Syllable]",
        "[4]Lead(1000,500)",
        "[7](Echo)(1200,500)",
        "",
        "[translation: format@LRC]",
        "[00:01.000]Meaning",
        "[00:01.200](Reply)"
      )
    );

    expect(doc.meta).toEqual({});
    expect(doc.lines[0]).toMatchObject({ begin: 975, end: 1675 });
    expect(doc.lines[0]?.p[0]).toMatchObject({ begin: 975, end: 1475 });
    expect(doc.lines[0]?.b[0]).toMatchObject({ begin: 1175, end: 1675 });
    expect(doc.lines[0]?.translations).toEqual({
      und: { b: "Reply", p: "Meaning" },
    });
  });

  test.each([
    "[version:1.0]\n[lyrics: format@Lyricify Syllable]\n[4]Hi(0,500)",
    `${containerMark}\n[version:2.0]\n[lyrics: format@Lyricify Syllable]\n[4]Hi(0,500)`,
    makeLqe("[translation: format@LRC]", "[00:00.000]orphan"),
    makeLqe(
      "[lyrics: format@Lyricify Syllable]",
      "[4]One(0,500)",
      "[lyrics: format@Lyricify Syllable]",
      "[4]Two(500,500)"
    ),
    makeLqe("[lyrics: format@LRC]", "[00:00.000]wrong format"),
    makeLqe("[lyrics: format@Lyricify Syllable]", "untimed"),
    makeLqe(
      "[lyrics: format@Lyricify Syllable]",
      "[4]Hi(0,500)",
      "[translation: format@QRC]",
      "[00:00.000]wrong format"
    ),
    makeLqe(
      "[lyrics: format@Lyricify Syllable]",
      "[4]Hi(0,500)",
      "[translation: language@zh!, format@LRC]",
      "[00:00.000]bad language"
    ),
    makeLqe(
      "[lyrics: format@Lyricify Syllable]",
      "[4]Hi(0,500)",
      "[notes:x@y]"
    ),
    makeLqe(
      "[lyrics: format@Lyricify Syllable]",
      "[ti:section metadata]",
      "[4]Hi(0,500)"
    ),
  ])("throws ParseError for malformed or unsupported sections", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });

  test("rejects a translation tag with no matching lyric track", () => {
    expect(() =>
      read(
        makeLqe(
          "[lyrics: format@Lyricify Syllable]",
          "[4]Lead(1000,500)",
          "[translation: format@LRC]",
          "[00:02.000]orphan"
        )
      )
    ).toThrow("lqe translation tag 2000 has no lyric track");
  });

  test("binds a same-timestamp primary and backing track by source order", () => {
    const doc = read(
      makeLqe(
        "[lyrics: format@Lyricify Syllable]",
        "[4]Lead(1000,500)",
        "[7](Echo)(1000,500)",
        "[translation: format@LRC]",
        "[00:01.000]first"
      )
    );

    expect(doc.lines[0]?.translations).toEqual({ und: { p: "first" } });
  });

  test("binds two same-timestamp lyric lines to two translation rows by source order", () => {
    const doc = read(
      makeLqe(
        "[lyrics: format@Lyricify Syllable]",
        "[4]First(1000,500)",
        "[4]Second(1000,500)",
        "[translation: format@LRC]",
        "[00:01.000]one",
        "[00:01.000]two"
      )
    );

    expect(doc.lines).toMatchObject([
      { p: [{ text: "First" }], translations: { und: { p: "one" } } },
      { p: [{ text: "Second" }], translations: { und: { p: "two" } } },
    ]);
  });
});
