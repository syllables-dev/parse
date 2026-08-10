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

  test("combines an au tag with JSON songwriters without duplicates", () => {
    const source = [
      JSON.stringify({ c: [{ tx: "作词: " }, { tx: "One/Two" }], t: 0 }),
      "[au:Two]",
      "[1000,1000](1000,1000,0)lyric",
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

  test("keeps whitespace with the syllable before its next marker", () => {
    const doc = read(
      "[12000,1300](12000,400,0)Hel(12400,300,0)lo (12700,600,0)world"
    );

    expect(doc.lines[0]?.p).toEqual([
      { begin: 12_000, end: 12_400, id: "l0w0", text: "Hel" },
      { begin: 12_400, end: 12_700, id: "l0w1", text: "lo " },
      { begin: 12_700, end: 13_300, id: "l0w2", text: "world" },
    ]);
    expect(write(doc)).toContain(
      "(12000,400,0)Hel(12400,300,0)lo (12700,600,0)world"
    );
  });

  test("reads metadata and consumes a positive offset", () => {
    const doc = read(
      [
        "[ti:Song]",
        "[ar:Singer]",
        "[al:Album]",
        "[by:Author]",
        "[au:Writer]",
        "[offset:+25]",
        "[1001,1502](1001,751,0)Hel(1752,751,0)lo",
      ].join("\n")
    );

    expect(doc.meta).toEqual({
      album: "Album",
      artist: "Singer",
      author: "Author",
      songwriters: ["Writer"],
      title: "Song",
    });
    expect(doc.lines[0]).toMatchObject({ begin: 1026, end: 2528 });
    expect(
      doc.lines
        .slice(0, 1)
        .map((line) => line.p.map((word) => word.text).join(""))
    ).toEqual(["Hello"]);
    expect(
      doc.lines
        .slice(0, 1)
        .flatMap((line) => line.p.map((word) => [word.begin, word.end]))
    ).toEqual([
      [1026, 1777],
      [1777, 2528],
    ]);
  });

  test("adds negative offsets to every timed range", () => {
    const doc = read("[offset:-25]\n[1001,1502](1001,751,0)Hel(1752,751,0)lo");

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
    "{broken",
    JSON.stringify({ t: 0 }),
    "[1000,1000](1000,1000,1)unsupported",
    "[1000,1000]untimed",
  ])("throws ParseError for malformed or unsupported input", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });
});

describe("yrc writer", () => {
  test("rejects empty documents", () => {
    expect(() => write({ ...wordDocument, lines: [] })).toThrow(
      "yrc cannot represent an empty document"
    );
  });

  test.each([
    { message: "line breaks", text: "Hel\nlo" },
    { message: "reserved marks", text: "Hel(1200,300,-1)lo" },
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

    expect(() => write(doc)).toThrow(`yrc cannot represent ${message} in text`);
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

    expect(read(write(doc))).toEqual(doc);
  });

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

    expect(written).not.toContain("[offset:");
    expect(written).toContain("[au:Writer]");
    expect(written).toContain("[1001,1502](1001,751,0)Hel");
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

  test("round-trips every single songwriter string through an au tag", () => {
    for (const songwriter of ["", "Writer", "One/Two"]) {
      const doc = {
        ...wordDocument,
        meta: { songwriters: [songwriter] },
      } satisfies LyricsDocument;
      const written = write(doc);

      expect(written).toContain(`[au:${songwriter}]`);
      expect(written).toContain("[1001,1502](1001,751,0)Hel");
      expect(read(written)).toEqual(doc);
    }
  });

  test.each([
    { message: "an empty list", songwriters: [] },
    { message: "an empty name", songwriters: ["One", ""] },
    { message: "surrounding whitespace", songwriters: ["One", " Two "] },
    { message: "a slash", songwriters: ["One", "Two/Three"] },
    { message: "duplicates", songwriters: ["One", "One"] },
  ])("rejects songwriter metadata with $message", ({ songwriters }) => {
    expect(() =>
      write({ ...wordDocument, meta: { songwriters: [...songwriters] } })
    ).toThrow();
  });

  test("rejects line breaks in metadata", () => {
    expect(() =>
      write({ ...wordDocument, meta: { artist: "One\nTwo" } })
    ).toThrow("yrc cannot represent line breaks in metadata");
  });

  test("rejects an empty author without mutation", () => {
    const doc = { ...wordDocument, meta: { author: "" } };
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "yrc cannot represent an empty lyric file author"
    );
    expect(doc).toEqual(before);
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
