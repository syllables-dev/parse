import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { type LyricsDocument, type LyricsLine, ParseError } from "../../src";
import { read, write } from "../../src/formats/lrc";

const fixtureCases = [
  {
    end: 248_777,
    fileName: "header-by-tag.lrc",
    firstText: "吻下去",
    lineCount: 51,
  },
  {
    end: 184_450,
    fileName: "plain-cjk.lrc",
    firstText: "若这一束吊灯倾泻下来",
    lineCount: 31,
  },
];

const lyricLine = {
  agent: null,
  b: [],
  begin: 1000,
  end: 6000,
  id: "line",
  p: [{ begin: 1000, end: 6000, id: "word", text: "Hello" }],
} satisfies LyricsLine;

const lineDocument = {
  agents: [],
  lines: [lyricLine],
  meta: {},
  timing: "line",
  version: 1,
} satisfies LyricsDocument;

async function readFixture(fileName: string) {
  return read(
    await openFile(
      new URL(`../fixtures/lrc/${fileName}`, import.meta.url)
    ).text()
  );
}

describe("lrc fixtures", () => {
  test.each(fixtureCases)(
    "reads and round-trips $fileName",
    async ({ end, fileName, firstText, lineCount }) => {
      const doc = await readFixture(fileName);

      expect(doc).toMatchObject({
        agents: [],
        meta: {},
        timing: "line",
        version: 1,
      });
      expect(doc.lines).toHaveLength(lineCount);
      expect(doc.lines[0]?.p[0]?.text).toBe(firstText);
      expect(doc.lines.at(-1)?.end).toBe(end);
      expect(read(write(doc))).toEqual(doc);
    }
  );
});

describe("lrc reader", () => {
  test("accepts a BOM and CRLF endings", () => {
    const doc = read("\uFEFF[00:01.001]one\r\n[00:02.002]two\r\n");

    expect(doc.lines.map((line) => [line.begin, line.end])).toEqual([
      [1001, 2002],
      [2002, 7002],
    ]);
  });

  test("expands repeated timestamps only when requested", () => {
    const source = "[00:01.000][00:02.000]chorus\n[00:03.000]following";

    expect(read(source).lines.map((line) => line.begin)).toEqual([1000, 3000]);
    expect(
      read(source, { expandRepeats: true }).lines.map((line) => [
        line.begin,
        line.p[0]?.text,
      ])
    ).toEqual([
      [1000, "chorus"],
      [2000, "chorus"],
      [3000, "following"],
    ]);
  });

  test("treats A2 markers as starts and inherits the line end", () => {
    const doc = read(
      "[00:01.111]<00:01.111>Hel <00:01.789>lo\n[00:02.345]next"
    );

    expect(doc.timing).toBe("word");
    expect(doc.lines[0]?.p).toEqual([
      { begin: 1111, end: 1789, id: "l0w0", text: "Hel " },
      { begin: 1789, end: 2345, id: "l0w1", text: "lo" },
    ]);
  });

  test("preserves exact metadata and consumes a positive offset", () => {
    const doc = read(
      [
        "[ti: Song ]",
        "[ar: Singer ]",
        "[al: Album ]",
        "[by: Author ]",
        "[au: Writer ]",
        "[offset: +250 ]",
        "[00:01.234]<00:01.234>one <00:01.999>two",
        "[00:02.500]next",
      ].join("\n")
    );

    expect(doc.meta).toEqual({
      album: " Album ",
      artist: " Singer ",
      author: " Author ",
      songwriters: [" Writer "],
      title: " Song ",
    });
    expect(doc.lines[0]).toMatchObject({ begin: 1484, end: 2750 });
    expect(
      doc.lines
        .slice(0, 1)
        .map((line) => line.p.map((word) => word.text).join(""))
    ).toEqual(["one two"]);
    expect(
      doc.lines
        .slice(0, 1)
        .flatMap((line) => line.p.map((word) => [word.begin, word.end]))
    ).toEqual([
      [1484, 2249],
      [2249, 2750],
    ]);
  });

  test("adds negative offsets to line and A2 word timestamps", () => {
    const doc = read(
      "[offset: -250 ]\n[00:01.000]<00:01.000>one <00:01.500>two\n[00:02.000]next"
    );

    expect(doc.meta).toEqual({});
    expect(doc.lines[0]).toMatchObject({ begin: 750, end: 1750 });
    expect(doc.lines[0]?.p).toEqual([
      { begin: 750, end: 1250, id: "l0w0", text: "one " },
      { begin: 1250, end: 1750, id: "l0w1", text: "two" },
    ]);
  });

  test.each([
    "plain lyrics",
    "[00:60.000]bad seconds",
    "[00:01.000]prefix<00:01.000>word",
    "[offset:-1]\n[00:00.000]negative time",
    "[offset:+9007199254740991]\n[00:00.001]unsafe time",
  ])("throws ParseError for unreadable input", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });
});

describe("lrc writer", () => {
  test("rejects empty documents", () => {
    expect(() => write({ ...lineDocument, lines: [] })).toThrow(
      "lrc cannot represent an empty document"
    );
  });

  test.each([
    { message: "line breaks", text: "Hel\nlo" },
    { message: "reserved marks", text: "Hel<00:01.500>lo" },
  ])("rejects $message without mutating the document", ({ message, text }) => {
    const doc = {
      ...lineDocument,
      lines: [
        {
          ...lyricLine,
          p: [{ begin: 1000, end: 6000, id: "word", text }],
        },
      ],
    } satisfies LyricsDocument;
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(`lrc cannot represent ${message} in text`);
    expect(doc).toEqual(before);
  });

  test("preserves literal angle and square brackets", () => {
    const doc = {
      ...lineDocument,
      lines: [
        {
          ...lyricLine,
          p: [
            {
              begin: 1000,
              end: 6000,
              id: "word",
              text: "Hello <verse> [chorus]",
            },
          ],
        },
      ],
    } satisfies LyricsDocument;

    expect(read(write(doc)).lines[0]?.p[0]?.text).toBe(
      "Hello <verse> [chorus]"
    );
  });

  test("round-trips exact metadata and consumes document offsets", () => {
    const doc = {
      ...lineDocument,
      meta: {
        album: " Album ",
        artist: " Singer ",
        author: " Author ",
        offset: 25,
        songwriters: [" Writer "],
        title: " Song ",
      },
    };
    const written = write(doc);

    expect(written).toBe(
      [
        "[ti: Song ]",
        "[ar: Singer ]",
        "[al: Album ]",
        "[by: Author ]",
        "[au: Writer ]",
        "[00:01.000]Hello",
      ].join("\n")
    );
    expect(read(written)).toMatchObject({
      lines: [
        {
          begin: 1000,
          end: 6000,
          p: [{ begin: 1000, end: 6000, text: "Hello" }],
        },
      ],
      meta: {
        album: " Album ",
        artist: " Singer ",
        author: " Author ",
        songwriters: [" Writer "],
        title: " Song ",
      },
    });
  });

  test.each([
    { message: "an empty songwriter list", songwriters: [] },
    { message: "multiple songwriters", songwriters: ["One", "Two"] },
  ])("rejects $message", ({ message, songwriters }) => {
    expect(() =>
      write({ ...lineDocument, meta: { songwriters: [...songwriters] } })
    ).toThrow(`lrc cannot represent ${message}`);
  });

  test("rejects line breaks in metadata", () => {
    expect(() =>
      write({ ...lineDocument, meta: { title: "Song\nTitle" } })
    ).toThrow("lrc cannot represent line breaks in metadata");
  });

  test("rejects unsupported document fields", () => {
    expect(() => write({ ...lineDocument, timing: "word" })).toThrow(
      "lrc cannot represent word timing"
    );
    expect(() =>
      write({
        ...lineDocument,
        agents: [{ id: "lead", type: "person" }],
        lines: [{ ...lyricLine, agent: "lead" }],
      })
    ).toThrow("lrc cannot represent vocal agents");
    expect(() =>
      write({
        ...lineDocument,
        lines: [
          {
            ...lyricLine,
            b: [{ begin: 1000, end: 2000, id: "backing", text: "echo" }],
          },
        ],
      })
    ).toThrow("lrc cannot represent backing vocals");
    expect(() =>
      write({
        ...lineDocument,
        lines: [
          {
            ...lyricLine,
            translations: { ja: { p: "こんにちは" } },
          },
        ],
      })
    ).toThrow("lrc cannot represent translations");
    expect(() =>
      write({
        ...lineDocument,
        lines: [
          {
            ...lyricLine,
            pronunciations: { ja: { b: [], p: [] } },
          },
        ],
      })
    ).toThrow("lrc cannot represent pronunciations");
  });

  test("requires line ends derived from the following start", () => {
    expect(() =>
      write({
        ...lineDocument,
        lines: [{ ...lyricLine, end: 5999 }],
      })
    ).toThrow("lrc cannot represent the end time of line line");
  });
});
