import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { type LyricsDocument, type LyricsLine, ParseError } from "../../src";
import { read, write } from "../../src/formats/lqe";

const containerMark = "[Lyricify Quick Export]";

const fixtureCases = [
  {
    agents: [{ id: "v1", type: "person" }],
    fileName: "translation-by-tag.lqe",
    firstText: "なんでもかんでも みんな",
    firstTranslation: "世间万物 统统",
  },
  {
    agents: [
      { id: "v1", type: "person" },
      { id: "v2", type: "person" },
    ],
    fileName: "translation.lqe",
    firstText: "I've been feeling lonely",
    firstTranslation: "孤独感一直笼罩着我",
  },
];

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

function makeLqe(...lines: string[]) {
  return [containerMark, "[version:1.0]", ...lines].join("\n");
}

async function readFixture(fileName: string) {
  return read(
    await openFile(
      new URL(`../fixtures/lqe/${fileName}`, import.meta.url)
    ).text()
  );
}

describe("lqe fixtures", () => {
  test.each(fixtureCases)(
    "reads and round-trips $fileName",
    async ({ agents, fileName, firstText, firstTranslation }) => {
      const doc = await readFixture(fileName);

      expect(doc).toMatchObject({ meta: {}, timing: "word", version: 1 });
      expect(doc.agents).toEqual(agents);
      expect(doc.lines).toHaveLength(41);
      expect(
        doc.lines
          .slice(0, 1)
          .map((line) => line.p.map((word) => word.text).join(""))
      ).toEqual([firstText]);
      expect(
        doc.lines.slice(0, 1).map((line) => line.translations?.und?.p)
      ).toEqual([firstTranslation]);
      expect(doc.lines.every((line) => line.translations?.und)).toBe(true);
      expect(read(write(doc))).toEqual(doc);
    }
  );

  test("joins primary, backing, and empty translations by exact timestamps", async () => {
    const doc = await readFixture("translation.lqe");

    expect(doc.lines[29]).toMatchObject({
      begin: 104_014,
      end: 108_316,
      translations: {
        und: { b: "迷茫 阴影", p: "活在迷茫里 缩在阴影中" },
      },
    });
    expect(doc.lines[29]?.p[0]?.begin).toBe(104_014);
    expect(doc.lines[29]?.b[0]?.begin).toBe(105_519);
    expect(doc.lines[37]?.translations).toEqual({
      und: { b: "", p: "等待好日子到来" },
    });
  });
});

describe("lqe reader", () => {
  test("accepts a BOM and CRLF endings", () => {
    const source =
      "\uFEFF[Lyricify Quick Export]\r\n[version:1.0]\r\n[lyrics: format@Lyricify Syllable]\r\n[4]one(1001,1001)\r\n";

    expect(read(source).lines[0]).toMatchObject({ begin: 1001, end: 2002 });
  });

  test("delegates zero-time separator normalization to LYS", () => {
    const doc = read(
      makeLqe(
        "[lyrics: format@Lyricify Syllable]",
        "[4]One(1000,500) (0,0),(0,0)，(0,0)Two(1500,500)"
      )
    );

    expect(doc.lines[0]?.p).toEqual([
      { begin: 1000, end: 1500, id: "l0w0", text: "One ,，" },
      { begin: 1500, end: 2000, id: "l0w1", text: "Two" },
    ]);
  });

  test("joins primary and backing translations at their own timestamps", () => {
    const doc = read(
      makeLqe(
        "[lyrics: format@Lyricify Syllable]",
        "[4]Lead(1000,1000)",
        "[7](Echo)(1200,500)",
        "",
        "[translation: language@zh-Hans, format@LRC]",
        "[00:01.000]你好",
        "[00:01.200](回声)"
      )
    );

    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0]?.p[0]?.begin).toBe(1000);
    expect(doc.lines[0]?.b[0]?.begin).toBe(1200);
    expect(doc.lines[0]?.translations).toEqual({
      "zh-Hans": { b: "回声", p: "你好" },
    });
  });

  test("keeps empty primary and backing translations", () => {
    const doc = read(
      makeLqe(
        "[lyrics: format@Lyricify Syllable]",
        "[4]Lead(1000,1000)",
        "[7](Echo)(1200,500)",
        "",
        "[translation: format@LRC]",
        "[00:01.000]",
        "[00:01.200]()"
      )
    );

    expect(doc.lines[0]?.translations).toEqual({
      und: { b: "", p: "" },
    });
  });

  test("reads metadata, consumes its offset, and ignores dead fields", () => {
    const doc = read(
      makeLqe(
        "[by:Author]",
        "[ti:Song]",
        "[ar:Singer]",
        "[al:Album]",
        "[au:Writer]",
        "[offset:900]",
        "",
        "[lyrics: format@Lyricify Syllable]",
        "[offset:800]",
        "[4]Lead(1000,500)",
        "",
        "[translation: format@LRC]",
        "[offset:700]",
        "[00:01.000]Meaning",
        "",
        "[pronunciation: language@ja, format@LRC]",
        "[00:01.000]Rōmaji"
      )
    );

    expect(doc.meta).toEqual({
      album: "Album",
      artist: "Singer",
      author: "Author",
      songwriters: ["Writer"],
      title: "Song",
    });
    expect(doc.lines[0]).toMatchObject({ begin: 1900, end: 2400 });
    expect(doc.lines[0]?.p[0]).toMatchObject({ begin: 1900, end: 2400 });
    expect(doc.lines[0]?.translations).toEqual({
      und: { p: "Meaning" },
    });
    expect(doc.lines[0]?.pronunciations).toBeUndefined();
  });

  test("trims the container version", () => {
    const doc = read(
      [
        containerMark,
        "[version: 1.0 ]",
        "[ti:Song]",
        "[lyrics: format@Lyricify Syllable]",
        "[4]Lyric(1000,500)",
      ].join("\n")
    );

    expect(doc.meta.title).toBe("Song");
    expect(doc.lines[0]?.p[0]?.text).toBe("Lyric");
  });

  test("adds a negative preamble offset after joining translations", () => {
    const doc = read(
      makeLqe(
        "[offset:-25]",
        "[lyrics: format@Lyricify Syllable]",
        "[4]Lead(1000,500)",
        "[7](Echo)(1200,500)",
        "",
        "[translation: format@LRC]",
        "[00:01.000]Meaning",
        "[00:01.200](Reply)"
      )
    );

    expect(doc.meta).toEqual({});
    expect(doc.lines[0]).toMatchObject({ begin: 975, end: 1675 });
    expect(doc.lines[0]?.p[0]).toMatchObject({ begin: 975, end: 1475 });
    expect(doc.lines[0]?.b[0]).toMatchObject({ begin: 1175, end: 1675 });
    expect(doc.lines[0]?.translations).toEqual({
      und: { b: "Reply", p: "Meaning" },
    });
  });

  test.each([
    "[version:1.0]\n[lyrics: format@Lyricify Syllable]\n[4]Hi(0,500)",
    `${containerMark}\n[version:2.0]\n[lyrics: format@Lyricify Syllable]\n[4]Hi(0,500)`,
    makeLqe("[translation: format@LRC]", "[00:00.000]orphan"),
    makeLqe(
      "[lyrics: format@Lyricify Syllable]",
      "[4]One(0,500)",
      "[lyrics: format@Lyricify Syllable]",
      "[4]Two(500,500)"
    ),
    makeLqe("[lyrics: format@LRC]", "[00:00.000]wrong format"),
    makeLqe("[lyrics: format@Lyricify Syllable]", "untimed"),
    makeLqe(
      "[lyrics: format@Lyricify Syllable]",
      "[4]Hi(0,500)",
      "[translation: format@QRC]",
      "[00:00.000]wrong format"
    ),
    makeLqe(
      "[lyrics: format@Lyricify Syllable]",
      "[4]Hi(0,500)",
      "[translation: language@zh!, format@LRC]",
      "[00:00.000]bad language"
    ),
    makeLqe(
      "[lyrics: format@Lyricify Syllable]",
      "[4]Hi(0,500)",
      "[notes:x@y]"
    ),
    makeLqe(
      "[lyrics: format@Lyricify Syllable]",
      "[ti:section metadata]",
      "[4]Hi(0,500)"
    ),
  ])("throws ParseError for malformed or unsupported sections", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });

  test("rejects a translation tag with no matching lyric track", () => {
    expect(() =>
      read(
        makeLqe(
          "[lyrics: format@Lyricify Syllable]",
          "[4]Lead(1000,500)",
          "[translation: format@LRC]",
          "[00:02.000]orphan"
        )
      )
    ).toThrow("lqe translation tag 2000 has no lyric track");
  });

  test("binds a same-timestamp primary and backing track by source order", () => {
    const doc = read(
      makeLqe(
        "[lyrics: format@Lyricify Syllable]",
        "[4]Lead(1000,500)",
        "[7](Echo)(1000,500)",
        "[translation: format@LRC]",
        "[00:01.000]first"
      )
    );

    expect(doc.lines[0]?.translations).toEqual({ und: { p: "first" } });
  });

  test("binds two same-timestamp lyric lines to two translation rows by source order", () => {
    const doc = read(
      makeLqe(
        "[lyrics: format@Lyricify Syllable]",
        "[4]First(1000,500)",
        "[4]Second(1000,500)",
        "[translation: format@LRC]",
        "[00:01.000]one",
        "[00:01.000]two"
      )
    );

    expect(doc.lines).toMatchObject([
      { p: [{ text: "First" }], translations: { und: { p: "one" } } },
      { p: [{ text: "Second" }], translations: { und: { p: "two" } } },
    ]);
  });
});

describe("lqe writer", () => {
  test("rejects empty documents", () => {
    expect(() => write({ ...translatedDocument, lines: [] })).toThrow(
      "lqe cannot represent an empty document"
    );
  });

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

  test("rejects line breaks in metadata", () => {
    expect(() =>
      write({ ...translatedDocument, meta: { author: "One\rTwo" } })
    ).toThrow("lqe cannot represent line breaks in an author");
  });

  test("rejects an empty author without mutation", () => {
    const doc = { ...translatedDocument, meta: { author: "" } };
    const before = structuredClone(doc);

    expect(() => write(doc)).toThrow(
      "lqe cannot represent an empty lyric file author"
    );
    expect(doc).toEqual(before);
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
