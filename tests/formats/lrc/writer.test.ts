import { describe, expect, test } from "bun:test";
import { read, write } from "@/formats/lrc";
import type { LyricsDocument, LyricsLine } from "@/index";

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

  test("round-trips metadata and consumes document offsets", () => {
    const doc = {
      ...lineDocument,
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
        album: "Album",
        artist: "Singer",
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
      write({ ...lineDocument, meta: { songwriters: [...songwriters] } })
    ).toThrow(`lrc cannot represent ${message}`);
  });

  test("rejects line breaks in metadata", () => {
    expect(() =>
      write({ ...lineDocument, meta: { title: "Song\nTitle" } })
    ).toThrow("lrc cannot represent line breaks in metadata");
  });

  test("drops a line with no lyric text instead of keeping a placeholder", () => {
    const doc = {
      ...lineDocument,
      lines: [
        {
          ...lyricLine,
          begin: 1000,
          end: 3000,
          id: "one",
          p: [{ begin: 1000, end: 3000, id: "onew0", text: "One" }],
        },
        {
          ...lyricLine,
          begin: 2000,
          end: 3000,
          id: "empty",
          p: [{ begin: 2000, end: 3000, id: "emptyw0", text: "" }],
        },
        {
          ...lyricLine,
          begin: 3000,
          end: 8000,
          id: "three",
          p: [{ begin: 3000, end: 8000, id: "threew0", text: "Three" }],
        },
      ],
    } satisfies LyricsDocument;

    expect(write(doc)).toBe("[00:01.000]One\n[00:03.000]Three");
  });

  test.each([
    {
      createPrimaryDocument: () =>
        ({
          ...lineDocument,
          lines: [
            {
              ...lyricLine,
              p: [
                { begin: 1000, end: 3000, id: "first", text: "Hel" },
                { begin: 3000, end: 6000, id: "second", text: "lo" },
              ],
            },
          ],
        }) satisfies LyricsDocument,
      message: "count",
    },
    {
      createPrimaryDocument: () =>
        ({
          ...lineDocument,
          lines: [
            {
              ...lyricLine,
              p: [{ begin: 1001, end: 6000, id: "word", text: "Hello" }],
            },
          ],
        }) satisfies LyricsDocument,
      message: "range",
    },
  ])(
    "rejects a lossy primary syllable $message without mutation",
    ({ createPrimaryDocument, message }) => {
      const primaryDocument = createPrimaryDocument();
      const before = structuredClone(primaryDocument);

      expect(() => write(primaryDocument)).toThrow(
        `lrc cannot represent the primary syllable ${message} of line line`
      );
      expect(primaryDocument).toEqual(before);
    }
  );

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
