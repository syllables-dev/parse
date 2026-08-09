import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { type LyricsDocument, type LyricsLine, ParseError } from "../../src";
import { read, write } from "../../src/formats/yrc";

const fixtureCases = [
  {
    fileName: "json-preamble.yrc",
    firstText: "初めてのルーブルは",
    lineCount: 45,
    songwriters: ["宇多田ヒカル"],
  },
  {
    fileName: "word-timed-credits.yrc",
    firstText:
      " 作词 : Ester Dean/Katy Perry/Mikkel S. Eriksen/Tor Erik Hermansen/Sandy Wilhelm",
    lineCount: 61,
    songwriters: undefined,
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
      new URL(`../fixtures/yrc/${fileName}`, import.meta.url)
    ).text()
  );
}

describe("yrc fixtures", () => {
  test.each(fixtureCases)(
    "reads and round-trips $fileName",
    async ({ fileName, firstText, lineCount, songwriters }) => {
      const doc = await readFixture(fileName);

      expect(doc).toMatchObject({
        agents: [],
        timing: "word",
        version: 1,
      });
      expect(doc.meta.songwriters).toEqual(songwriters);
      expect(doc.lines).toHaveLength(lineCount);
      expect(
        doc.lines
          .slice(0, 1)
          .map((line) => line.p.map((word) => word.text).join(""))
      ).toEqual([firstText]);
      expect(read(write(doc))).toEqual(doc);
    }
  );
});

describe("yrc reader", () => {
  test("accepts a BOM and CRLF endings", () => {
    const doc = read(
      "\uFEFF[1001,1001](1001,1001,0)one\r\n[3003,1001](3003,1001,0)two\r\n"
    );

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1001, 2002],
      [3003, 4004],
    ]);
  });

  test("reads songwriter JSON preambles and removes duplicates", () => {
    const source = [
      JSON.stringify({ c: [{ tx: "作词: " }, { tx: "One/Two" }], t: 0 }),
      JSON.stringify({ c: [{ tx: "作曲：" }, { tx: "One" }], t: 1 }),
      JSON.stringify({ c: [{ tx: "编曲: " }, { tx: "Ignored" }], t: 2 }),
      "[1000,1000](1000,1000,0)line",
    ].join("\n");

    expect(read(source).meta.songwriters).toEqual(["One", "Two"]);
  });

  test("preserves empty and whitespace-only lyric lines", () => {
    const doc = read("[1000,1000]\n[2000,1000]   ");

    expect(doc.lines[0]?.p).toEqual([]);
    expect(doc.lines[1]?.p).toEqual([
      { begin: 2000, end: 3000, id: "l1w0", text: "   " },
    ]);
    expect(read(write(doc))).toEqual(doc);
  });

  test("preserves overlapping rows and exact integer word times", () => {
    const doc = read(
      "[1001,1502](1001,751,0)one(1752,751,0)two\n[2002,1001](2002,1001,0)overlap"
    );

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1001, 2503],
      [2002, 3003],
    ]);
    expect(
      doc.lines
        .slice(0, 1)
        .flatMap((line) => line.p.map((word) => [word.begin, word.end]))
    ).toEqual([
      [1001, 1752],
      [1752, 2503],
    ]);
  });

  test.each([
    "plain lyrics",
    "{broken",
    JSON.stringify({ t: 0 }),
    "[1000,1000](1000,1000,1)unsupported",
    "[1000,1000]untimed",
  ])("throws ParseError for malformed or unsupported input", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });
});

describe("yrc writer", () => {
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

  test("rejects unavailable metadata and slash-delimited names", () => {
    expect(() => write({ ...wordDocument, meta: { title: "Song" } })).toThrow(
      "yrc cannot represent title, artist, album, or offset metadata"
    );
    expect(() =>
      write({ ...wordDocument, meta: { songwriters: ["One/Two"] } })
    ).toThrow("yrc cannot represent a slash inside a songwriter name");
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
