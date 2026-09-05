import { describe, expect, test } from "bun:test";
import { read, write } from "@/formats/lys";
import type { LyricsDocument, LyricsLine } from "@/index";
import { makeLine } from "./shared";

const lyricLine = {
  agent: "v1",
  b: [],
  begin: 1001,
  end: 2503,
  id: "line",
  p: [
    { begin: 1001, end: 1752, id: "first", text: "Hel" },
    { begin: 1752, end: 2503, id: "second", text: "lo" },
  ],
} satisfies LyricsLine;

const wordDocument = {
  agents: [{ id: "v1", type: "person" }],
  lines: [lyricLine],
  meta: {},
  timing: "word",
  version: 1,
} satisfies LyricsDocument;

describe("lys writer", () => {
  test.each([
    { backing: false, message: "line breaks", text: "Hel\nlo" },
    { backing: true, message: "reserved marks", text: "Echo(1200,300)" },
  ])(
    "rejects $message without mutating the document",
    ({ backing, message, text }) => {
      const doc = {
        ...wordDocument,
        lines: [
          {
            ...lyricLine,
            b: backing ? [{ begin: 1200, end: 1500, id: "backing", text }] : [],
            p: lyricLine.p.map((syllable, index) => ({
              ...syllable,
              text: !backing && index === 0 ? text : syllable.text,
            })),
          },
        ],
      } satisfies LyricsDocument;
      const before = structuredClone(doc);

      expect(() => write(doc)).toThrow(
        `lys cannot represent ${message} in text`
      );
      expect(doc).toEqual(before);
    }
  );

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

    expect(read(write(doc)).lines[0]?.p[0]?.text).toBe("Hel (live) [mix]");
  });

  test("round-trips a canonical right-side carrier", () => {
    const doc = {
      agents: [{ id: "v2", type: "other" }],
      lines: [
        {
          agent: "v2",
          b: [],
          begin: 1000,
          end: 1500,
          id: "l0",
          p: [{ begin: 1000, end: 1500, id: "l0w0", text: "Guest" }],
        },
      ],
      meta: {},
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;

    expect(write(doc)).toBe("[by:]\n[5]Guest(1000,500)");
    expect(read(write(doc))).toEqual(doc);
  });

  test("rejects a leading backing-only line without mutation", () => {
    const doc = {
      agents: [{ id: "v1", type: "person" }],
      lines: [
        makeLine("l0", 1000, "Echo", "b"),
        makeLine("l1", 2000, "Lead", "p"),
      ],
      meta: {},
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;

    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "lys cannot preserve backing-only line l0"
    );
    expect(doc).toEqual(before);
  });

  test("rejects a same-agent backing-only line without mutation", () => {
    const doc = {
      agents: [{ id: "v1", type: "person" }],
      lines: [
        makeLine("l0", 1000, "Lead", "p"),
        makeLine("l1", 2000, "Echo", "b"),
      ],
      meta: {},
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "lys cannot preserve backing-only line l1"
    );
    expect(doc).toEqual(before);
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

    expect(written).toBe(
      [
        "[ti:Song]",
        "[ar:Singer]",
        "[al:Album]",
        "[by:Author]",
        "[au:Writer]",
        "[4]Hel(1001,751)lo(1752,751)",
      ].join("\n")
    );
    expect(written).not.toContain("[offset:");
    expect(read(written)).toMatchObject({
      lines: [
        {
          begin: 1001,
          end: 2503,
          p: [
            { begin: 1001, end: 1752, text: "Hel" },
            { begin: 1752, end: 2503, text: "lo" },
          ],
        },
      ],
      meta: {
        album: "Album",
        artist: "Singer",
        author: "Author",
        songwriters: ["Writer"],
        title: "Song",
      },
    });
  });

  test.each([
    { message: "an empty songwriter list", songwriters: [] },
    { message: "multiple songwriters", songwriters: ["One", "Two"] },
  ])("rejects $message", ({ message, songwriters }) => {
    expect(() =>
      write({ ...wordDocument, meta: { songwriters: [...songwriters] } })
    ).toThrow(`lys cannot represent ${message}`);
  });

  test.each([
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
      message: "lys cannot represent translations",
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
      message: "lys cannot represent pronunciations",
    },
  ])("rejects unrepresentable document fields", ({ doc, message }) => {
    expect(() => write(doc)).toThrow(message);
  });
});
