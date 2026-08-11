import { describe, expect, test } from "bun:test";
import type { LyricsDocument, LyricsLine } from "../../../src";
import { read, write } from "../../../src/formats/eslrc";

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

describe("eslrc writer", () => {
  test("rejects empty documents", () => {
    expect(() => write({ ...wordDocument, lines: [] })).toThrow(
      "eslrc cannot represent an empty document"
    );
  });

  test.each([
    { message: "line breaks", text: "Hel\rlo" },
    { message: "reserved marks", text: "Hel[00:01.500]lo" },
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

    expect(() => write(doc)).toThrow(
      `eslrc cannot represent ${message} in text`
    );
    expect(doc).toEqual(before);
  });

  test("preserves literal square brackets", () => {
    const doc = {
      ...wordDocument,
      lines: [
        {
          ...lyricLine,
          p: lyricLine.p.map((syllable, index) => ({
            ...syllable,
            text: index === 0 ? "Hel [chorus]" : syllable.text,
          })),
        },
      ],
    } satisfies LyricsDocument;

    expect(read(write(doc))).toEqual(doc);
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

    expect(read(written)).toEqual({
      ...doc,
      meta: {
        album: "Album",
        artist: "Singer",
        songwriters: ["Writer"],
        title: "Song",
      },
    });
    expect(written.split("\n").slice(0, 5)).toEqual([
      "[ti:Song]",
      "[ar:Singer]",
      "[al:Album]",
      "[by:]",
      "[au:Writer]",
    ]);
    expect(written).not.toContain("[offset:");
  });

  test("rejects multiple songwriters", () => {
    expect(() =>
      write({
        ...wordDocument,
        meta: { songwriters: ["One", "Two"] },
      })
    ).toThrow("eslrc cannot represent multiple songwriters");
  });

  test("rejects an empty songwriter list", () => {
    expect(() => write({ ...wordDocument, meta: { songwriters: [] } })).toThrow(
      "eslrc cannot represent an empty songwriter list"
    );
  });

  test("rejects line breaks in metadata", () => {
    expect(() =>
      write({ ...wordDocument, meta: { title: "One\nTwo" } })
    ).toThrow("eslrc cannot represent line breaks in metadata");
  });

  test("rejects an empty author without mutation", () => {
    const doc = { ...wordDocument, meta: { author: "" } };
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "eslrc cannot represent an empty lyric file author"
    );
    expect(doc).toEqual(before);
  });

  test("keeps an empty primary track as a positional placeholder", () => {
    const doc = {
      ...wordDocument,
      lines: [{ ...lyricLine, p: [] }],
    } satisfies LyricsDocument;

    expect(write(doc)).toBe("[by:]\n[00:01.001][00:02.503]");
    expect(read(write(doc))).toMatchObject({
      lines: [{ p: [{ text: "" }] }],
    });
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
