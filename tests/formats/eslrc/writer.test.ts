import { describe, expect, test } from "bun:test";
import { read, write } from "@/formats/eslrc";
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

describe("eslrc writer", () => {
  // eslrc has no backing track, so lossy keeps the words as a parenthesized line of their
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
      "[00:00.600](Ooh)[00:00.900]\n[00:01.001]Hel[00:01.752]lo[00:02.503]"
    );
  });

  test("rejects reserved marks without mutating the document", () => {
    const doc = {
      ...wordDocument,
      lines: [
        {
          ...lyricLine,
          p: lyricLine.p.map((syllable, index) =>
            index === 0 ? { ...syllable, text: "Hel[00:01.500]lo" } : syllable
          ),
        },
      ],
    } satisfies LyricsDocument;
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "eslrc cannot represent reserved marks in text"
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
    expect(written.split("\n").slice(0, 4)).toEqual([
      "[ti:Song]",
      "[ar:Singer]",
      "[al:Album]",
      "[au:Writer]",
    ]);
    expect(written).not.toContain("[offset:");
  });
});
