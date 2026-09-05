import { describe, expect, test } from "bun:test";
import { read, write } from "@/formats/yrc";
import type { LyricsDocument, LyricsLine } from "@/index";

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

describe("yrc writer", () => {
  test("rejects reserved marks without mutating the document", () => {
    const doc = {
      ...wordDocument,
      lines: [
        {
          ...lyricLine,
          p: lyricLine.p.map((syllable, index) =>
            index === 0 ? { ...syllable, text: "Hel(1200,300,-1)lo" } : syllable
          ),
        },
      ],
    } satisfies LyricsDocument;
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "yrc cannot represent reserved marks in text"
    );
    expect(doc).toEqual(before);
  });

  test("preserves literal parentheses and square brackets", () => {
    const doc = {
      ...wordDocument,
      lines: [
        {
          ...lyricLine,
          p: lyricLine.p.map((syllable, index) => ({
            ...syllable,
            text: index === 0 ? "Hel (live) [mix]" : syllable.text,
          })),
        },
      ],
    } satisfies LyricsDocument;

    expect(read(write(doc))).toEqual(doc);
  });

  test("round-trips songwriter metadata through a JSON preamble", () => {
    const doc = {
      ...wordDocument,
      meta: { songwriters: ["One", "Two"] },
    };
    const written = write(doc);

    expect(JSON.parse(written.split("\n")[0] ?? "")).toEqual({
      c: [{ tx: "作词: " }, { tx: "One/Two" }],
      t: 0,
    });
    expect(read(written)).toEqual(doc);
  });

  test("round-trips metadata and consumes document offsets", () => {
    const doc = {
      ...wordDocument,
      meta: {
        album: "Album",
        artist: "Singer",
        author: "Author",
        offset: 25,
        songwriters: ["Writer"],
        title: "Song",
      },
    };
    const written = write(doc);

    expect(written).not.toContain("[offset:");
    expect(written).toContain("[au:Writer]");
    expect(written).toContain("[1001,1502](1001,751,0)Hel");
    expect(read(written)).toEqual({
      ...doc,
      meta: {
        album: "Album",
        artist: "Singer",
        author: "Author",
        songwriters: ["Writer"],
        title: "Song",
      },
    });
  });

  test("round-trips every valid single songwriter string through an au tag", () => {
    for (const songwriter of ["Writer", "One/Two"]) {
      const doc = {
        ...wordDocument,
        meta: { songwriters: [songwriter] },
      } satisfies LyricsDocument;
      const written = write(doc);

      expect(written).toContain(`[au:${songwriter}]`);
      expect(written).toContain("[1001,1502](1001,751,0)Hel");
      expect(read(written)).toEqual(doc);
    }
  });

  test.each([
    { message: "an empty list", songwriters: [] },
    { message: "an empty name", songwriters: [""] },
    { message: "an empty list member", songwriters: ["One", ""] },
    { message: "surrounding whitespace", songwriters: ["One", " Two "] },
    { message: "a slash", songwriters: ["One", "Two/Three"] },
    { message: "duplicates", songwriters: ["One", "One"] },
  ])("rejects songwriter metadata with $message", ({ songwriters }) => {
    expect(() =>
      write({ ...wordDocument, meta: { songwriters: [...songwriters] } })
    ).toThrow();
  });
});
