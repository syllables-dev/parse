import { describe, expect, test } from "bun:test";
import { read, write } from "@/formats/lyl";
import { read as readQrc } from "@/formats/qrc";
import type { LyricsDocument, LyricsLine } from "@/index";

const lyricLine = {
  agent: null,
  b: [],
  begin: 1000,
  end: 2000,
  id: "l0",
  p: [{ begin: 1000, end: 2000, id: "l0w0", text: "Hello" }],
} satisfies LyricsLine;

const lineDocument = {
  agents: [],
  lines: [lyricLine],
  meta: {},
  timing: "line",
  version: 1,
} satisfies LyricsDocument;

describe("lyl writer", () => {
  test("declares the type and writes explicit line ends", () => {
    expect(write(lineDocument)).toBe("[type:LyricifyLines]\n[1000,2000]Hello");
  });

  test("rejects reserved marks without mutating the document", () => {
    const doc = {
      ...lineDocument,
      lines: [
        {
          ...lyricLine,
          p: [{ begin: 1000, end: 2000, id: "l0w0", text: "Hel[1,2]lo" }],
        },
      ],
    } satisfies LyricsDocument;
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "lyl cannot represent reserved marks in text"
    );
    expect(doc).toEqual(before);
  });

  test("collapses word timing onto the line range only when lossy", () => {
    const doc = readQrc("[0,1300]Hel(0,400)lo (400,300)world(700,600)");

    expect(() => write(doc)).toThrow("lyl cannot represent word timing");
    expect(read(write(doc, { lossy: true })).lines[0]).toMatchObject({
      begin: 0,
      end: 1300,
      p: [{ begin: 0, end: 1300, text: "Hello world" }],
    });
  });

  test("collapses a line-timed primary track that does not span its line", () => {
    const doc = {
      ...lineDocument,
      lines: [
        {
          ...lyricLine,
          end: 3000,
          p: [{ begin: 1000, end: 1800, id: "l0w0", text: "Hello" }],
        },
      ],
    } satisfies LyricsDocument;

    expect(() => write(doc)).toThrow(
      "lyl cannot represent the primary syllable range of line l0"
    );
    expect(write(doc, { lossy: true })).toBe(
      "[type:LyricifyLines]\n[1000,3000]Hello"
    );
  });

  test("keeps a collapsed backing track as its own parenthesized line", () => {
    const doc = {
      ...lineDocument,
      lines: [
        {
          ...lyricLine,
          b: [{ begin: 2000, end: 3000, id: "l0b0", text: "oh yeah" }],
          end: 3000,
          p: [{ begin: 1000, end: 1800, id: "l0w0", text: "Hello" }],
        },
      ],
    } satisfies LyricsDocument;

    expect(write(doc, { lossy: true })).toBe(
      "[type:LyricifyLines]\n[1000,3000]Hello\n[2000,3000](oh yeah)"
    );
  });

  test("rejects an inverted line range", () => {
    expect(() =>
      write({
        ...lineDocument,
        lines: [{ ...lyricLine, begin: 2000, end: 1000 }],
      })
    ).toThrow("lyl cannot represent the inverted range of line l0");
  });
});
