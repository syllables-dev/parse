import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { type LyricsDocument, type LyricsLine, ParseError } from "../../src";
import { read, write } from "../../src/formats/qrc";

const fixtureCases = [
  {
    fileName: "cjk-per-char.qrc",
    firstText: "岁月如歌 - 陈奕迅 (Eason Chan)",
    lineCount: 47,
    title:
      "岁月如歌 (《兄妹》粤语版|《冲上云霄》电影主题曲|《冲上云霄》电视剧主题曲)",
  },
  {
    fileName: "parens-in-text.qrc",
    firstText: "petal (Explicit) - Ariana Grande",
    lineCount: 61,
    title: "petal (Explicit)",
  },
];

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

async function readFixture(fileName: string) {
  return read(
    await openFile(
      new URL(`../fixtures/qrc/${fileName}`, import.meta.url)
    ).text()
  );
}

describe("qrc fixtures", () => {
  test.each(fixtureCases)(
    "reads and round-trips $fileName",
    async ({ fileName, firstText, lineCount, title }) => {
      const doc = await readFixture(fileName);

      expect(doc).toMatchObject({
        agents: [],
        timing: "word",
        version: 1,
      });
      expect(doc.meta.title).toBe(title);
      expect(doc.lines).toHaveLength(lineCount);
      expect(
        doc.lines
          .slice(0, 1)
          .map((line) => line.p.map((word) => word.text).join(""))
      ).toEqual([firstText]);
      expect(read(write(doc))).toEqual(doc);
    }
  );

  test("keeps CJK characters as separate timed syllables", async () => {
    const doc = await readFixture("cjk-per-char.qrc");

    expect(doc.lines.slice(0, 1).flatMap((line) => line.p.slice(0, 4))).toEqual(
      [
        { begin: 0, end: 209, id: "l0w0", text: "岁" },
        { begin: 209, end: 418, id: "l0w1", text: "月" },
        { begin: 418, end: 627, id: "l0w2", text: "如" },
        { begin: 627, end: 836, id: "l0w3", text: "歌" },
      ]
    );
  });

  test("keeps literal parentheses inside primary text", async () => {
    const doc = await readFixture("parens-in-text.qrc");

    expect(doc.lines.slice(0, 1).flatMap((line) => line.p.slice(0, 2))).toEqual(
      [
        { begin: 66, end: 427, id: "l0w0", text: "petal (" },
        { begin: 427, end: 667, id: "l0w1", text: "Explicit) - " },
      ]
    );
    expect(doc.lines[0]?.b).toEqual([]);
  });
});

describe("qrc reader", () => {
  test("accepts a BOM and CRLF endings", () => {
    const doc = read(
      "\uFEFF[1001,1001]one(1001,1001)\r\n[3003,1001]two(3003,1001)\r\n"
    );

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1001, 2002],
      [3003, 4004],
    ]);
  });

  test("reads suffix markers with exact spacing and integer times", () => {
    const doc = read(
      "[12000,1300]Hel(12000,400)lo (12400,300)world(12700,600)"
    );

    expect(doc.lines[0]).toMatchObject({ begin: 12_000, end: 13_300 });
    expect(doc.lines[0]?.p).toEqual([
      { begin: 12_000, end: 12_400, id: "l0w0", text: "Hel" },
      { begin: 12_400, end: 12_700, id: "l0w1", text: "lo " },
      { begin: 12_700, end: 13_300, id: "l0w2", text: "world" },
    ]);
  });

  test("joins an isolated wrapped row as backing vocals", () => {
    const doc = read(
      "[1000,2000]Lead(1000,2000)\n[1500,1000](Echo)(1500,1000)"
    );

    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0]).toMatchObject({ begin: 1000, end: 3000 });
    expect(doc.lines[0]?.p[0]?.text).toBe("Lead");
    expect(doc.lines[0]?.b).toEqual([
      { begin: 1500, end: 2500, id: "l0b0", text: "Echo" },
    ]);
    expect(read(write(doc))).toEqual(doc);
  });

  test("preserves overlapping lyric rows", () => {
    const doc = read("[1000,1000]one(1000,1000)\n[1500,1000]two(1500,1000)");

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1000, 2000],
      [1500, 2500],
    ]);
  });

  test("applies offsets and reads every metadata field", () => {
    const doc = read(
      [
        "[ti:Song]",
        "[ar:Singer]",
        "[al:Album]",
        "[au:Writer]",
        "[offset:25]",
        "[1026,1502]Hel(1026,751)lo(1777,751)",
      ].join("\n")
    );

    expect(doc.meta).toEqual({
      album: "Album",
      artist: "Singer",
      offset: 25,
      songwriters: ["Writer"],
      title: "Song",
    });
    expect(doc.lines[0]).toMatchObject({ begin: 1001, end: 2503 });
    expect(
      doc.lines
        .slice(0, 1)
        .flatMap((line) => line.p.map((word) => [word.begin, word.end]))
    ).toEqual([
      [1001, 1752],
      [1752, 2503],
    ]);
    expect(read(write(doc))).toEqual(doc);
  });

  test.each([
    "plain lyrics",
    "[1000,x]broken",
    "[1000,1000]word(1000,500)tail",
  ])("throws ParseError for unreadable input", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });
});

describe("qrc writer", () => {
  test("round-trips every supported metadata field", () => {
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

    expect(read(write(doc))).toEqual(doc);
  });

  test("rejects multiple songwriters", () => {
    expect(() =>
      write({
        ...wordDocument,
        meta: { songwriters: ["One", "Two"] },
      })
    ).toThrow("qrc cannot represent multiple songwriters");
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
