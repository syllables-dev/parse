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
  // yrc has no backing track, so lossy keeps the words as a parenthesized line of their
  // own, ordered ahead of the line when the backing starts first
  test("writes backing vocals as their own line when lossy", () => {
    const doc = {
      ...wordDocument,
      lines: [
        {
          ...lyricLine,
          b: [{ begin: 600, end: 900, id: "l0b0", text: "Ooh" }],
        },
      ],
    } satisfies LyricsDocument;

    expect(write(doc, { lossy: true })).toBe(
      "[600,300](600,300,0)(Ooh)\n[1001,1502](1001,751,0)Hel(1752,751,0)lo"
    );
  });

  test("does not re-wrap backing vocals that already carry parens", () => {
    const doc = {
      ...wordDocument,
      lines: [
        {
          ...lyricLine,
          b: [
            { begin: 600, end: 750, id: "l0b0", text: "(Ooh" },
            { begin: 750, end: 900, id: "l0b1", text: " ah)" },
          ],
        },
      ],
    } satisfies LyricsDocument;

    expect(write(doc, { lossy: true })).toBe(
      "[600,300](600,150,0)(Ooh(750,150,0) ah)\n[1001,1502](1001,751,0)Hel(1752,751,0)lo"
    );
  });

  test("keeps a backing line after the line it follows", () => {
    const doc = {
      ...wordDocument,
      lines: [
        {
          ...lyricLine,
          b: [{ begin: 2000, end: 2400, id: "l0b0", text: "Ooh" }],
        },
      ],
    } satisfies LyricsDocument;

    expect(write(doc, { lossy: true })).toBe(
      "[1001,1502](1001,751,0)Hel(1752,751,0)lo\n[2000,400](2000,400,0)(Ooh)"
    );
  });

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
        songwriters: ["Writer"],
        title: "Song",
      },
    });
  });

  test("keeps a single songwriter with a slash in an au tag rather than splitting it", () => {
    const doc = {
      ...wordDocument,
      meta: { songwriters: ["One/Two"] },
    } satisfies LyricsDocument;
    const written = write(doc);

    expect(written).toContain("[au:One/Two]");
    expect(read(written)).toEqual(doc);
  });

  test.each([
    {
      message: "yrc cannot represent an empty songwriter name",
      songwriters: ["One", ""],
    },
    {
      message: "yrc cannot preserve this songwriter name",
      songwriters: ["One", "Two/Three"],
    },
    {
      message: "yrc requires unique songwriter names",
      songwriters: ["One", "One"],
    },
  ])("rejects songwriter metadata: $message", ({ message, songwriters }) => {
    expect(() =>
      write({ ...wordDocument, meta: { songwriters: [...songwriters] } })
    ).toThrow(message);
  });
});
