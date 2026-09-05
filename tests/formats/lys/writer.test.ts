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
  test("rejects reserved marks without mutating the document", () => {
    const doc = {
      ...wordDocument,
      lines: [
        {
          ...lyricLine,
          b: [
            { begin: 1200, end: 1500, id: "backing", text: "Echo(1200,300)" },
          ],
        },
      ],
    } satisfies LyricsDocument;
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "lys cannot represent reserved marks in text"
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

    expect(write(doc)).toBe("[5]Guest(1000,500)");
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
        songwriters: ["Writer"],
        title: "Song",
      },
    });
  });
});
