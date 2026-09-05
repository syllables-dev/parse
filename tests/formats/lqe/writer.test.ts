import { describe, expect, test } from "bun:test";
import { read, write } from "@/formats/lqe";
import type { LyricsDocument, LyricsLine } from "@/index";
import { containerMark } from "./shared";

const translatedLine = {
  agent: "v1",
  b: [{ begin: 1200, end: 1700, id: "l0b0", text: "Echo" }],
  begin: 1000,
  end: 2000,
  id: "l0",
  p: [{ begin: 1000, end: 2000, id: "l0w0", text: "Lead" }],
  translations: {
    ja: { p: "こんにちは" },
    und: { b: "", p: "" },
    "zh-Hans": { b: "回声", p: "你好" },
  },
} satisfies LyricsLine;

const translatedDocument = {
  agents: [{ id: "v1", type: "person" }],
  lines: [translatedLine],
  meta: {},
  timing: "word",
  translationTracks: {
    ja: { kind: "subtitle" },
    und: { kind: "subtitle" },
    "zh-Hans": { kind: "subtitle" },
  },
  version: 1,
} satisfies LyricsDocument;

describe("lqe writer", () => {
  test.each([
    {
      doc: {
        ...translatedDocument,
        lines: [
          {
            ...translatedLine,
            p: translatedLine.p.map((syllable) => ({
              ...syllable,
              text: "Lead\nreply",
            })),
          },
        ],
        translationTracks: { ja: { kind: "subtitle" } },
      } satisfies LyricsDocument,
      message: "line breaks in lyric text",
    },
    {
      doc: {
        ...translatedDocument,
        lines: [
          {
            ...translatedLine,
            b: translatedLine.b.map((syllable) => ({
              ...syllable,
              text: "Echo(1200,300)",
            })),
          },
        ],
        translationTracks: { ja: { kind: "subtitle" } },
      } satisfies LyricsDocument,
      message: "reserved lyric marks",
    },
    {
      doc: {
        ...translatedDocument,
        lines: [
          {
            ...translatedLine,
            translations: { ja: { p: "meaning\rreply" } },
          },
        ],
        translationTracks: { ja: { kind: "subtitle" } },
      } satisfies LyricsDocument,
      message: "line breaks in translation text",
    },
    {
      doc: {
        ...translatedDocument,
        lines: [
          {
            ...translatedLine,
            translations: {
              ja: { b: "echo<00:01.200>reply", p: "meaning" },
            },
          },
        ],
        translationTracks: { ja: { kind: "subtitle" } },
      } satisfies LyricsDocument,
      message: "reserved translation marks",
    },
  ])("rejects $message without mutating the document", ({ doc, message }) => {
    const before = structuredClone(doc);
    const error = message.startsWith("line breaks")
      ? "lqe cannot represent line breaks in text"
      : "lqe cannot represent reserved marks in text";

    expect(() => write(doc)).toThrow(error);
    expect(doc).toEqual(before);
  });

  test("preserves literal punctuation in lyrics and translations", () => {
    const doc = {
      ...translatedDocument,
      lines: [
        {
          ...translatedLine,
          p: translatedLine.p.map((syllable) => ({
            ...syllable,
            text: "Lead (live) [mix]",
          })),
          translations: { ja: { p: "意味 <verse> [note]" } },
        },
      ],
      translationTracks: { ja: { kind: "subtitle" } },
    } satisfies LyricsDocument;
    const restored = read(write(doc));

    expect(restored.lines[0]?.p[0]?.text).toBe("Lead (live) [mix]");
    expect(restored.lines[0]).toMatchObject({
      translations: { ja: { p: "意味 <verse> [note]" } },
    });
  });

  test("rejects a same-agent backing-only line without mutation", () => {
    const doc = {
      ...translatedDocument,
      lines: [
        translatedLine,
        {
          agent: "v1",
          b: [{ begin: 3000, end: 3500, id: "l1b0", text: "Reply" }],
          begin: 3000,
          end: 3500,
          id: "l1",
          p: [],
        },
      ],
    } satisfies LyricsDocument;
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "lqe cannot preserve backing-only line l1"
    );
    expect(doc).toEqual(before);
  });

  test("sorts valid language tags and round-trips empty translations", () => {
    const written = write(translatedDocument);

    expect(
      written.split("\n").filter((line) => line.startsWith("[translation:"))
    ).toEqual([
      "[translation: language@ja, format@LRC]",
      "[translation: format@LRC]",
      "[translation: language@zh-Hans, format@LRC]",
    ]);
    expect(read(written)).toEqual(translatedDocument);
  });

  test("emits an empty translation row for a line with no translation, keeping alignment", () => {
    const doc = {
      agents: [],
      lines: [
        {
          agent: null,
          b: [],
          begin: 5000,
          end: 7000,
          id: "l0",
          p: [{ begin: 5000, end: 7000, id: "l0w0", text: "First" }],
          translations: { en: { p: "trans A" } },
        },
        {
          agent: null,
          b: [],
          begin: 7000,
          end: 9000,
          id: "l1",
          p: [{ begin: 7000, end: 9000, id: "l1w0", text: "Second" }],
        },
        {
          agent: null,
          b: [],
          begin: 9000,
          end: 11_000,
          id: "l2",
          p: [{ begin: 9000, end: 11_000, id: "l2w0", text: "Third" }],
          translations: { en: { p: "trans C" } },
        },
      ],
      meta: {},
      timing: "word",
      translationTracks: { en: {} },
      version: 1,
    } satisfies LyricsDocument;

    const written = write(doc);
    const translationIndex = written
      .split("\n")
      .findIndex((line) => line.startsWith("[translation:"));

    expect(written.split("\n").slice(translationIndex + 1)).toEqual([
      "[00:05.000]trans A",
      "[00:07.000]",
      "[00:09.000]trans C",
    ]);
    expect(read(written).lines.map((line) => line.translations)).toEqual([
      { en: { p: "trans A" } },
      { en: { p: "" } },
      { en: { p: "trans C" } },
    ]);
  });

  test("rejects replacement translations without mutation", () => {
    const doc = {
      ...translatedDocument,
      lines: [
        {
          ...translatedLine,
          translations: {
            ...translatedLine.translations,
            ja: { p: "こんにちは" },
          },
        },
      ],
      translationTracks: { ja: { kind: "replacement" } },
    } satisfies LyricsDocument;
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "lqe cannot represent replacement translations"
    );
    expect(doc).toEqual(before);
  });

  test.each([true, false])(
    "rejects automaticallyCreated=%s translations without mutation",
    (automaticallyCreated) => {
      const doc = {
        ...translatedDocument,
        translationTracks: { ja: { automaticallyCreated } },
      } satisfies LyricsDocument;
      const before = structuredClone(doc);

      expect(() => write(doc)).toThrow(
        "lqe cannot represent automaticallyCreated translations"
      );
      expect(doc).toEqual(before);
    }
  );

  test("drops an empty translation track during a lossy write", () => {
    const doc = {
      ...translatedDocument,
      translationTracks: {
        fr: { kind: "subtitle" },
        ja: { kind: "subtitle" },
        und: { kind: "subtitle" },
        "zh-Hans": { kind: "subtitle" },
      },
    } satisfies LyricsDocument;

    expect(() => write(doc)).toThrow(
      "lqe cannot represent an empty translation track"
    );
    expect(read(write(doc, { lossy: true })).translationTracks).toEqual(
      translatedDocument.translationTracks
    );
  });

  test("round-trips container metadata and consumes document offsets", () => {
    const written = write({
      ...translatedDocument,
      meta: {
        album: "Album",
        artist: "Singer",
        author: "Author",
        offset: 25,
        songwriters: ["Writer"],
        title: "Song",
      },
    });

    expect(written.split("\n").slice(0, 9)).toEqual([
      containerMark,
      "[version:1.0]",
      "[by:Author]",
      "[ti:Song]",
      "[ar:Singer]",
      "[al:Album]",
      "[au:Writer]",
      "",
      "[lyrics: format@Lyricify Syllable]",
    ]);
    expect(written).not.toContain("[offset:");
    expect(written).toContain("[4]Lead(1000,1000)");
    expect(read(written).meta).toEqual({
      album: "Album",
      artist: "Singer",
      author: "Author",
      songwriters: ["Writer"],
      title: "Song",
    });
  });

  test.each([
    { message: "an empty songwriter list", songwriters: [] },
    { message: "multiple songwriters", songwriters: ["One", "Two"] },
  ])("rejects $message", ({ message, songwriters }) => {
    expect(() =>
      write({
        ...translatedDocument,
        meta: { songwriters: [...songwriters] },
      })
    ).toThrow(`lqe cannot represent ${message}`);
  });

  test("rejects invalid language tags and pronunciation tracks", () => {
    expect(() =>
      write({
        ...translatedDocument,
        lines: [
          {
            ...translatedLine,
            translations: { "zh!": { p: "invalid" } },
          },
        ],
        translationTracks: { "zh!": { kind: "subtitle" } },
      })
    ).toThrow("invalid lqe translation language zh!");

    expect(() =>
      write({
        ...translatedDocument,
        lines: [
          {
            ...translatedLine,
            pronunciations: { ja: { b: [], p: [] } },
          },
        ],
      })
    ).toThrow("lqe cannot represent pronunciations");
  });
});
