import { describe, expect, test } from "bun:test";
import type { LyricsDocument, LyricsLine } from "../../../src";
import { read, write } from "../../../src/formats/yrc";

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
  test("rejects empty documents", () => {
    expect(() => write({ ...wordDocument, lines: [] })).toThrow(
      "yrc cannot represent an empty document"
    );
  });

  test.each([
    { message: "line breaks", text: "Hel\nlo" },
    { message: "reserved marks", text: "Hel(1200,300,-1)lo" },
  ])("rejects $message without mutating the document", ({ message, text }) => {
    const doc = {
      ...wordDocument,
      lines: [
        {
          ...lyricLine,
          p: lyricLine.p.map((syllable, index) => ({
            ...syllable,
            text: index === 0 ? text : syllable.text,
          })),
        },
      ],
    } satisfies LyricsDocument;
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(`yrc cannot represent ${message} in text`);
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

  test("rejects line breaks in metadata", () => {
    expect(() =>
      write({ ...wordDocument, meta: { artist: "One\nTwo" } })
    ).toThrow("yrc cannot represent line breaks in metadata");
  });

  test("rejects an empty author without mutation", () => {
    const doc = { ...wordDocument, meta: { author: "" } };
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "yrc cannot represent an empty lyric file author"
    );
    expect(doc).toEqual(before);
  });

  test.each([
    {
      doc: {
        ...wordDocument,
        agents: [{ id: "lead", type: "person" }],
        lines: [{ ...lyricLine, agent: "lead" }],
      } satisfies LyricsDocument,
      message: "yrc cannot represent vocal agents",
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
      message: "yrc cannot represent backing vocals",
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
      message: "yrc cannot represent translations",
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
      message: "yrc cannot represent pronunciations",
    },
  ])("rejects unsupported document fields", ({ doc, message }) => {
    expect(() => write(doc)).toThrow(message);
  });
});
