import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import {
  losses as findLosses,
  type LyricsDocument,
  type LyricsLine,
  ParseError,
  read as readLyrics,
  write as writeLyrics,
} from "../../src";
import { read, write } from "../../src/formats/qrc";

const fixtureCases = [
  {
    fileName: "cjk-per-char.qrc",
    firstText: "爱上了 看见你",
    lineCount: 47,
    lyricIndex: 4,
    title:
      "岁月如歌 (《兄妹》粤语版|《冲上云霄》电影主题曲|《冲上云霄》电视剧主题曲)",
  },
  {
    fileName: "parens-in-text.qrc",
    firstText: "Tryna feel something real",
    lineCount: 61,
    lyricIndex: 4,
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

describe("qrc fixtures", () => {
  test.each(fixtureCases)(
    "reads and round-trips $fileName",
    async ({ fileName, firstText, lineCount, lyricIndex, title }) => {
      const doc = await readFixture(fileName);

      expect(doc).toMatchObject({
        agents: [],
        timing: "word",
        version: 1,
      });
      expect(doc.meta.title).toBe(title);
      expect(doc.lines).toHaveLength(lineCount);
      expect(doc.lines[lyricIndex]?.p.map((word) => word.text).join("")).toBe(
        firstText
      );
      expect(read(write(doc))).toEqual(doc);
    }
  );

  test("keeps CJK characters as separate timed syllables", async () => {
    const doc = await readFixture("cjk-per-char.qrc");

    expect(doc.lines.slice(4, 5).flatMap((line) => line.p.slice(0, 3))).toEqual(
      [
        { begin: 13_434, end: 13_643, id: "l4w0", text: "爱" },
        { begin: 13_643, end: 13_843, id: "l4w1", text: "上" },
        { begin: 13_843, end: 14_227, id: "l4w2", text: "了" },
      ]
    );
  });

  test("keeps literal parentheses inside a lyric line", () => {
    const doc = read("[1000,1000]Sing (1000,500)(live)(1500,500)");

    expect(doc.lines[0]?.p).toEqual([
      { begin: 1000, end: 1500, id: "l0w0", text: "Sing " },
      { begin: 1500, end: 2000, id: "l0w1", text: "(live)" },
    ]);
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

  test("reads metadata and consumes a positive offset", () => {
    const doc = read(
      [
        "[ti:Song]",
        "[ar:Singer]",
        "[al:Album]",
        "[by:Author]",
        "[au:Writer]",
        "[offset:+25]",
        "[1001,1502]Hel(1001,751)lo(1752,751)",
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
    const doc = read("[offset:-25]\n[1001,1502]Hel(1001,751)lo(1752,751)");

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
    "[1000,x]broken",
    "[1000,1000]word(1000,500)tail",
  ])("throws ParseError for unreadable input", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });
});

describe("qrc writer", () => {
  test("rejects empty documents", () => {
    expect(() => write({ ...wordDocument, lines: [] })).toThrow(
      "qrc cannot represent an empty document"
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

  test("rejects line breaks in metadata", () => {
    expect(() =>
      write({ ...wordDocument, meta: { album: "One\rTwo" } })
    ).toThrow("qrc cannot represent line breaks in metadata");
  });

  test("rejects an empty author without mutation", () => {
    const doc = { ...wordDocument, meta: { author: "" } };
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "qrc cannot represent an empty lyric file author"
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
