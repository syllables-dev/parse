import { describe, expect, test } from "bun:test";
import { read, write } from "@/formats/qrc";
import {
  losses as findLosses,
  type LyricsDocument,
  type LyricsLine,
  read as readLyrics,
  write as writeLyrics,
} from "@/index";

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

function makeLine(
  id: string,
  begin: number,
  text: string,
  track: "b" | "p" = "p"
) {
  const syllable = {
    begin,
    end: begin + 500,
    id: `${id}${track === "b" ? "b" : "w"}0`,
    text,
  };
  return {
    agent: null,
    b: track === "b" ? [syllable] : [],
    begin,
    end: begin + 500,
    id,
    p: track === "p" ? [syllable] : [],
  } satisfies LyricsLine;
}

describe("qrc writer", () => {
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
        `qrc cannot represent ${message} in text`
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

    expect(read(write(doc))).toEqual(doc);
  });

  test("preserves adjacent wrapped primary lines", () => {
    const doc = {
      ...wordDocument,
      lines: [makeLine("l0", 1000, "(One)"), makeLine("l1", 2000, "（Two）")],
    } satisfies LyricsDocument;

    expect(findLosses(doc, "qrc")).toEqual([]);
    expect(readLyrics(writeLyrics(doc, "qrc"), "qrc")).toEqual(doc);
  });

  test("preserves mixed outer parentheses as primary lyric text", () => {
    const doc = {
      ...wordDocument,
      lines: [
        makeLine("l0", 1000, "One"),
        makeLine("l1", 2000, "(Two）"),
        makeLine("l2", 3000, "Three"),
      ],
    } satisfies LyricsDocument;

    expect(findLosses(doc, "qrc")).toEqual([]);
    expect(readLyrics(writeLyrics(doc, "qrc"), "qrc")).toEqual(doc);
  });

  test("keeps adjacent wrapped primaries while projecting a later isolated row", () => {
    const doc = {
      ...wordDocument,
      lines: [
        makeLine("l0", 1000, "(One)"),
        makeLine("l1", 2000, "（Two）"),
        makeLine("l2", 3000, "Three"),
        makeLine("l3", 4000, "(Four)"),
        makeLine("l4", 5000, "Five"),
      ],
    } satisfies LyricsDocument;

    expect(findLosses(doc, "qrc")).toEqual(["lyricText"]);
    expect(
      readLyrics(writeLyrics(doc, "qrc", { lossy: true }), "qrc")
    ).toMatchObject({
      lines: [
        { p: [{ text: "(One)" }] },
        { p: [{ text: "（Two）" }] },
        { p: [{ text: "Three" }] },
        { p: [{ text: "Four" }] },
        { p: [{ text: "Five" }] },
      ],
    });
  });

  test("preserves leading and adjacent backing-only lines", () => {
    const doc = {
      ...wordDocument,
      lines: [
        {
          ...makeLine("l0", 1000, "Echo", "b"),
          b: [{ begin: 1100, end: 1200, id: "l0b0", text: "Echo" }],
        },
        {
          ...makeLine("l2", 2000, "Answer", "b"),
          b: [{ begin: 2100, end: 2200, id: "l2b0", text: "Answer" }],
        },
        makeLine("l4", 3000, "Lead"),
      ],
    } satisfies LyricsDocument;
    const before = structuredClone(doc);
    const written = writeLyrics(doc, "qrc");

    expect(written.split("\n")).toEqual([
      "[by:]",
      "[1000,500]",
      "[1100,100](Echo)(1100,100)",
      "[2000,500]",
      "[2100,100](Answer)(2100,100)",
      "[3000,500]Lead(3000,500)",
    ]);
    expect(readLyrics(written, "qrc")).toEqual(doc);
    expect(doc).toEqual(before);
  });

  test("silently drops a line with no primary and no backing syllables", () => {
    const doc = {
      ...wordDocument,
      lines: [
        makeLine("l0", 1000, "Lead"),
        { ...makeLine("l1", 2000, ""), b: [], p: [] },
        makeLine("l2", 3000, "Last"),
      ],
    } satisfies LyricsDocument;
    const before = structuredClone(doc);

    expect(findLosses(doc, "qrc")).toEqual([]);
    expect(readLyrics(writeLyrics(doc, "qrc"), "qrc").lines).toMatchObject([
      { p: [{ text: "Lead" }] },
      { p: [{ text: "Last" }] },
    ]);
    expect(doc).toEqual(before);
  });

  test.each([
    { close: ")", open: "(", text: "ASCII" },
    { close: "）", open: "（", text: "full-width" },
  ])(
    "reports and projects an isolated $text wrapped primary without mutation",
    ({ close, open }) => {
      const wrapped = {
        agent: null,
        b: [],
        begin: 2000,
        end: 2500,
        id: "l1",
        p: [
          { begin: 2000, end: 2100, id: "l1w0", text: open },
          { begin: 2100, end: 2200, id: "l1w1", text: "Two" },
          { begin: 2200, end: 2300, id: "l1w2", text: close },
        ],
      } satisfies LyricsLine;
      const doc = {
        ...wordDocument,
        lines: [
          makeLine("l0", 1000, "One"),
          wrapped,
          makeLine("l2", 3000, "Three"),
        ],
      } satisfies LyricsDocument;
      const before = structuredClone(doc);

      expect(findLosses(doc, "qrc")).toEqual(["lyricText"]);
      expect(() => writeLyrics(doc, "qrc")).toThrow(
        "qrc cannot preserve lyric text"
      );

      const restored = readLyrics(
        writeLyrics(doc, "qrc", { lossy: true }),
        "qrc"
      );

      expect(restored.lines[1]?.p).toEqual([
        { begin: 2000, end: 2100, id: "l1w0", text: "" },
        { begin: 2100, end: 2200, id: "l1w1", text: "Two" },
        { begin: 2200, end: 2300, id: "l1w2", text: "" },
      ]);
      expect(restored.lines[1]).toMatchObject({ begin: 2000, end: 2500 });
      expect(doc).toEqual(before);
    }
  );

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

    expect(written.split("\n").slice(0, 6)).toEqual([
      "[ti:Song]",
      "[ar:Singer]",
      "[al:Album]",
      "[by:Author]",
      "[au:Writer]",
      "[1001,1502]Hel(1001,751)lo(1752,751)",
    ]);
    expect(written).not.toContain("[offset:");
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

  test.each([
    { message: "an empty songwriter list", songwriters: [] },
    { message: "multiple songwriters", songwriters: ["One", "Two"] },
  ])("rejects $message", ({ message, songwriters }) => {
    expect(() =>
      write({ ...wordDocument, meta: { songwriters: [...songwriters] } })
    ).toThrow(`qrc cannot represent ${message}`);
  });

  test.each([
    {
      doc: {
        ...wordDocument,
        agents: [{ id: "lead", type: "person" }],
        lines: [{ ...lyricLine, agent: "lead" }],
      } satisfies LyricsDocument,
      message: "qrc cannot represent vocal agents",
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
      message: "qrc cannot represent translations",
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
      message: "qrc cannot represent pronunciations",
    },
  ])("rejects unsupported document fields", ({ doc, message }) => {
    expect(() => write(doc)).toThrow(message);
  });
});
