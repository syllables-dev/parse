import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { type LyricsDocument, type LyricsLine, ParseError } from "../../src";
import { read, write } from "../../src/formats/eslrc";

const lyricLine = {
  agent: null,
  b: [],
  begin: 1001,
  end: 2503,
  id: "l0",
  p: [
    { begin: 1001, end: 1752, id: "l0w0", text: "Hel" },
    { begin: 1752, end: 2503, id: "l0w1", text: "lo" },
  ],
} satisfies LyricsLine;

const wordDocument = {
  agents: [],
  lines: [lyricLine],
  meta: {},
  timing: "word",
  version: 1,
} satisfies LyricsDocument;

describe("eslrc fixture", () => {
  test("reads concrete trailing stamps and round-trips them", async () => {
    const doc = read(
      await openFile(
        new URL("../fixtures/eslrc/cjk-trailing-stamp.eslrc", import.meta.url)
      ).text()
    );

    expect(doc).toMatchObject({
      agents: [],
      meta: {},
      timing: "word",
      version: 1,
    });
    expect(doc.lines).toHaveLength(51);
    expect(doc.lines[0]).toMatchObject({ begin: 28_331, end: 29_969 });
    expect(doc.lines[0]?.p).toEqual([
      { begin: 28_331, end: 28_840, id: "l0w0", text: "吻" },
      { begin: 28_840, end: 29_374, id: "l0w1", text: "下" },
      { begin: 29_374, end: 29_969, id: "l0w2", text: "去" },
    ]);
    expect(doc.lines.at(-1)?.end).toBe(251_551);
    expect(read(write(doc))).toEqual(doc);
  });
});

describe("eslrc reader", () => {
  test("accepts a BOM and CRLF endings", () => {
    const doc = read(
      "\uFEFF[00:01.001]one[00:02.002]\r\n[00:03.003]two[00:04.004]\r\n"
    );

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1001, 2002],
      [3003, 4004],
    ]);
  });

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

  test("preserves empty and whitespace-only lyric lines", () => {
    const doc = read("[00:01.000][00:02.000]\n[00:03.000]   [00:04.000]");

    expect(doc.lines.map((line) => line.p)).toEqual([
      [{ begin: 1000, end: 2000, id: "l0w0", text: "" }],
      [{ begin: 3000, end: 4000, id: "l1w0", text: "   " }],
    ]);
    expect(read(write(doc))).toEqual(doc);
  });

  test("applies offsets and reads every metadata field", () => {
    const doc = read(
      [
        "[ti:Song]",
        "[ar:Singer]",
        "[al:Album]",
        "[au:Writer]",
        "[offset:-25]",
        "[00:01.001]Hi[00:02.002]",
      ].join("\n")
    );

    expect(doc.meta).toEqual({
      album: "Album",
      artist: "Singer",
      offset: -25,
      songwriters: ["Writer"],
      title: "Song",
    });
    expect(doc.lines[0]).toMatchObject({ begin: 1026, end: 2027 });
    expect(doc.lines[0]?.p[0]).toMatchObject({ begin: 1026, end: 2027 });
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

describe("eslrc writer", () => {
  test("round-trips every supported metadata field", () => {
    const doc = {
      ...wordDocument,
      meta: {
        album: "Album",
        artist: "Singer",
        offset: 25,
        songwriters: ["Writer"],
        title: "Song",
      },
    };

    expect(read(write(doc))).toEqual(doc);
    expect(write(doc).split("\n").slice(0, 6)).toEqual([
      "[ti:Song]",
      "[ar:Singer]",
      "[al:Album]",
      "[by:]",
      "[offset:25]",
      "[au:Writer]",
    ]);
  });

  test("rejects multiple songwriters", () => {
    expect(() =>
      write({
        ...wordDocument,
        meta: { songwriters: ["One", "Two"] },
      })
    ).toThrow("eslrc cannot represent multiple songwriters");
  });

  test.each([
    {
      doc: {
        ...wordDocument,
        agents: [{ id: "lead", type: "person" }],
        lines: [{ ...lyricLine, agent: "lead" }],
      } satisfies LyricsDocument,
      message: "eslrc cannot represent vocal agents",
    },
    {
      doc: {
        ...wordDocument,
        lines: [
          {
            ...lyricLine,
            b: [{ begin: 1001, end: 1752, id: "backing", text: "echo" }],
          },
        ],
      } satisfies LyricsDocument,
      message: "eslrc cannot represent backing vocals",
    },
    {
      doc: {
        ...wordDocument,
        lines: [
          {
            ...lyricLine,
            translations: { zh: { p: "你好" } },
          },
        ],
      } satisfies LyricsDocument,
      message: "eslrc cannot represent translations",
    },
    {
      doc: {
        ...wordDocument,
        lines: [
          {
            ...lyricLine,
            pronunciations: { ja: { b: [], p: [] } },
          },
        ],
      } satisfies LyricsDocument,
      message: "eslrc cannot represent pronunciations",
    },
  ])("rejects unsupported document fields", ({ doc, message }) => {
    expect(() => write(doc)).toThrow(message);
  });
});
