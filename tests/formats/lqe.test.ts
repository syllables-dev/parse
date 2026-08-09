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
  agent: "lead",
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
  agents: [{ id: "lead", type: "person" }],
  lines: [translatedLine],
  meta: {},
  timing: "word",
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

    expect(doc.lines[0]?.translations).toEqual({ und: { b: "", p: "" } });
  });

  test("reads metadata and ignores dead offsets and pronunciation sections", () => {
    const doc = read(
      makeLqe(
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
      songwriters: ["Writer"],
      title: "Song",
    });
    expect(doc.lines[0]).toMatchObject({ begin: 1000, end: 1500 });
    expect(doc.lines[0]?.translations).toEqual({ und: { p: "Meaning" } });
    expect(doc.lines[0]?.pronunciations).toBeUndefined();
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
  ])("throws ParseError for malformed or unsupported sections", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });

  test("rejects missing and ambiguous translation targets", () => {
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

    expect(() =>
      read(
        makeLqe(
          "[lyrics: format@Lyricify Syllable]",
          "[4]Lead(1000,500)",
          "[7](Echo)(1000,500)",
          "[translation: format@LRC]",
          "[00:01.000]ambiguous"
        )
      )
    ).toThrow("lqe translation tag 1000 is ambiguous");
  });
});

describe("lqe writer", () => {
  test("sorts valid language tags and round-trips empty translations", () => {
    const written = write(translatedDocument);

    expect(
      written.split("\n").filter((line) => line.startsWith("[translation:"))
    ).toEqual([
      "[translation: language@ja, format@LRC]",
      "[translation: format@LRC]",
      "[translation: language@zh-Hans, format@LRC]",
    ]);
    expect(read(written)).toEqual({
      ...translatedDocument,
      agents: [{ id: "v1", type: "person" }],
      lines: [
        {
          ...translatedLine,
          agent: "v1",
        },
      ],
    });
  });

  test("emits only container, version, and by metadata headers", () => {
    const written = write({
      ...translatedDocument,
      meta: {
        album: "Album",
        artist: "Singer",
        offset: 25,
        songwriters: ["Writer"],
        title: "Song",
      },
    });

    expect(written.split("\n").slice(0, 5)).toEqual([
      containerMark,
      "[version:1.0]",
      "[by:]",
      "",
      "[lyrics: format@Lyricify Syllable]",
    ]);
    expect(written).not.toContain("[ti:");
    expect(written).not.toContain("[offset:");
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
