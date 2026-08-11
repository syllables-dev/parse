import { describe, expect, test } from "bun:test";
import { read, write } from "@/formats/lys";
import { type LyricsDocument, ParseError } from "@/index";
import { makeLine } from "./shared";

describe("lys reader", () => {
  test("accepts a BOM and CRLF endings", () => {
    const doc = read("\uFEFF[4]one(1001,1001)\r\n[4]two(3003,1001)\r\n");

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1001, 2002],
      [3003, 4004],
    ]);
  });

  test("maps properties zero through eight to tracks and agents", () => {
    const doc = read(
      Array.from(
        { length: 9 },
        (_, property) => `[${property}]p${property}(${property * 1000},500)`
      ).join("\n")
    );

    expect(doc.agents).toEqual([
      { id: "v1", type: "person" },
      { id: "v2", type: "person" },
    ]);
    expect(
      doc.lines.map((line) => ({
        agent: line.agent,
        track: line.p.length > 0 ? "primary" : "backing",
      }))
    ).toEqual([
      { agent: null, track: "primary" },
      { agent: "v1", track: "primary" },
      { agent: "v2", track: "primary" },
      { agent: null, track: "primary" },
      { agent: "v1", track: "primary" },
      { agent: "v2", track: "primary" },
      { agent: null, track: "backing" },
      { agent: "v1", track: "backing" },
      { agent: "v2", track: "backing" },
    ]);
  });

  test("uses person identity changes rather than agent ids for sides", () => {
    const doc = {
      agents: [
        { id: "v2", type: "person" },
        { id: "guest-92", type: "person" },
        { id: "voice-401", type: "person" },
      ],
      lines: [
        { ...makeLine("l0", 1000, "First", "p"), agent: "v2" },
        { ...makeLine("l1", 2000, "Second", "p"), agent: "guest-92" },
        { ...makeLine("l2", 3000, "Third", "p"), agent: "voice-401" },
      ],
      meta: {},
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;

    expect(write(doc)).toBe(
      "[by:]\n[4]First(1000,500)\n[5]Second(2000,500)\n[4]Third(3000,500)"
    );
  });

  test("reads corrected suffix spacing without moving text", () => {
    const doc = read("[4]Hel(12000,400)lo (12400,300)world(12700,600)");

    expect(doc.lines[0]).toMatchObject({ begin: 12_000, end: 13_300 });
    expect(doc.lines[0]?.p).toEqual([
      { begin: 12_000, end: 12_400, id: "l0w0", text: "Hel" },
      { begin: 12_400, end: 12_700, id: "l0w1", text: "lo " },
      { begin: 12_700, end: 13_300, id: "l0w2", text: "world" },
    ]);
  });

  test("folds zero-time separators into the preceding timed syllable", () => {
    const doc = read("[4]One(1000,500) (0,0),(0,0)，(0,0)Two(1500,500)");

    expect(doc.lines[0]?.p).toEqual([
      { begin: 1000, end: 1500, id: "l0w0", text: "One ,，" },
      { begin: 1500, end: 2000, id: "l0w1", text: "Two" },
    ]);
  });

  test("folds a zero-duration token with real lyric text into its left neighbor", () => {
    const doc = read("[4]Hello(120,1250)there(1370,0)");

    expect(doc.lines[0]?.p).toEqual([
      { begin: 120, end: 1370, id: "l0w0", text: "Hellothere" },
    ]);
  });

  test("rejects a leading zero-time separator", () => {
    expect(() => read("[4],(0,0)One(1000,500)")).toThrow(
      "lys line 1 begins with a zero-time separator"
    );
  });

  test("merges explicit and inferred backing rows", () => {
    const explicit = read("[4]Lead(1000,1000)\n[7](Echo)(1200,500)");
    const inferred = read("[4]Lead(1000,1000)\n[1](Echo)(1200,500)");

    for (const doc of [explicit, inferred]) {
      expect(doc.lines).toHaveLength(1);
      expect(doc.lines[0]?.b).toEqual([
        { begin: 1200, end: 1700, id: "l0b0", text: "Echo" },
      ]);
    }
  });

  test("preserves overlapping lyric rows", () => {
    const doc = read(
      "[4]one(1000,1000)\n[4]two(1500,1000)\n[5]three(1750,1000)"
    );

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1000, 2000],
      [1500, 2500],
      [1750, 2750],
    ]);
  });

  test("reads metadata and consumes a positive offset", () => {
    const doc = read(
      [
        "[ti:Song]",
        "[ar:Singer]",
        "[al:Album]",
        "[by:Author]",
        "[au:Writer]",
        "[offset:+900]",
        "[4]Hello(1000,500)",
      ].join("\n")
    );

    expect(doc.meta).toEqual({
      album: "Album",
      artist: "Singer",
      author: "Author",
      songwriters: ["Writer"],
      title: "Song",
    });
    expect(doc.lines[0]).toMatchObject({ begin: 1900, end: 2400 });
    expect(doc.lines[0]?.p[0]).toMatchObject({
      begin: 1900,
      end: 2400,
      text: "Hello",
    });
  });

  test("adds negative offsets to every timed range", () => {
    const doc = read("[offset:-25]\n[4]Hel(1001,751)lo(1752,751)");

    expect(doc.meta).toEqual({});
    expect(doc.lines[0]).toMatchObject({ begin: 976, end: 2478 });
    expect(
      doc.lines
        .slice(0, 1)
        .flatMap((line) => line.p.map((word) => [word.begin, word.end]))
    ).toEqual([
      [976, 1727],
      [1727, 2478],
    ]);
  });

  test.each([
    "plain lyrics",
    "[9]unknown(1000,500)",
    "[4]   ",
    "[4]word(1000,500)tail",
  ])("throws ParseError for malformed or unsupported input", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });
});
