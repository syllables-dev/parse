import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { type LyricsDocument, type LyricsLine, ParseError } from "../../src";
import { read, write } from "../../src/formats/lys";

const fixtureCases = [
  {
    agents: [
      { id: "v1", type: "group" },
      { id: "v2", type: "other" },
    ],
    fileName: "duet-values.lys",
    firstText: "Through the rose-colored lenses",
    lineCount: 50,
  },
  {
    agents: [{ id: "v1", type: "group" }],
    fileName: "primary-background.lys",
    firstText: "Tryna feel something real",
    lineCount: 57,
  },
];

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
  agents: [{ id: "v1", type: "group" }],
  lines: [lyricLine],
  meta: {},
  timing: "word",
  version: 1,
} satisfies LyricsDocument;

async function readFixture(fileName: string) {
  return read(
    await openFile(
      new URL(`../fixtures/lys/${fileName}`, import.meta.url)
    ).text()
  );
}

function makeLine(id: string, begin: number, text: string, track: "b" | "p") {
  const syllable = {
    begin,
    end: begin + 500,
    id: `${id}${track === "b" ? "b" : "w"}0`,
    text,
  };
  return {
    agent: "v1",
    b: track === "b" ? [syllable] : [],
    begin,
    end: begin + 500,
    id,
    p: track === "p" ? [syllable] : [],
  } satisfies LyricsLine;
}

describe("lys fixtures", () => {
  test.each(fixtureCases)(
    "reads and round-trips $fileName",
    async ({ agents, fileName, firstText, lineCount }) => {
      const doc = await readFixture(fileName);

      expect(doc).toMatchObject({ meta: {}, timing: "word", version: 1 });
      expect(doc.agents).toEqual(agents);
      expect(doc.lines).toHaveLength(lineCount);
      expect(
        doc.lines
          .slice(0, 1)
          .map((line) => line.p.map((word) => word.text).join(""))
      ).toEqual([firstText]);
      expect(read(write(doc))).toEqual(doc);
    }
  );

  test("merges the fixture's explicit backing rows", async () => {
    const doc = await readFixture("primary-background.lys");

    expect(doc.lines[20]).toMatchObject({
      agent: "v1",
      begin: 71_459,
      end: 72_967,
      id: "l20",
    });
    expect(
      doc.lines
        .slice(20, 21)
        .map((line) => line.p.map((word) => word.text).join(""))
    ).toEqual(["They say "]);
    expect(
      doc.lines
        .slice(20, 21)
        .map((line) => line.b.map((word) => word.text).join(""))
    ).toEqual(["Ooh-ooh, ooh"]);
  });
});

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
      { id: "v1", type: "group" },
      { id: "v2", type: "other" },
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

  test("reads corrected suffix spacing without moving text", () => {
    const doc = read("[4]Hel(12000,400)lo (12400,300)world(12700,600)");

    expect(doc.lines[0]).toMatchObject({ begin: 12_000, end: 13_300 });
    expect(doc.lines[0]?.p).toEqual([
      { begin: 12_000, end: 12_400, id: "l0w0", text: "Hel" },
      { begin: 12_400, end: 12_700, id: "l0w1", text: "lo " },
      { begin: 12_700, end: 13_300, id: "l0w2", text: "world" },
    ]);
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

describe("lys writer", () => {
  test("rejects empty documents", () => {
    expect(() => write({ ...wordDocument, lines: [] })).toThrow(
      "lys cannot represent an empty document"
    );
  });

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

  test("preserves a leading backing-only line", () => {
    const doc = {
      agents: [{ id: "v1", type: "group" }],
      lines: [
        makeLine("l0", 1000, "Echo", "b"),
        makeLine("l1", 2000, "Lead", "p"),
      ],
      meta: {},
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;

    expect(read(write(doc))).toEqual(doc);
  });

  test("rejects a same-agent backing-only line without mutation", () => {
    const doc = {
      agents: [{ id: "v1", type: "group" }],
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

  test("rejects line breaks in metadata", () => {
    expect(() =>
      write({ ...wordDocument, meta: { songwriters: ["One\nTwo"] } })
    ).toThrow("lys cannot represent line breaks in metadata");
  });

  test("rejects an empty author without mutation", () => {
    const doc = { ...wordDocument, meta: { author: "" } };
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "lys cannot represent an empty lyric file author"
    );
    expect(doc).toEqual(before);
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
