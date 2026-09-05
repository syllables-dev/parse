import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { write as writeTtml } from "@/formats/ttml";
import type { FormatId, LyricsDocument } from "@/index";
import {
  capabilities,
  convert,
  detect,
  losses,
  ParseError,
  parse,
  read,
  write,
} from "@/index";

const fixtureCases = [
  ["eslrc/cjk-trailing-stamp.eslrc", "eslrc"],
  ["lqe/translation-by-tag.lqe", "lqe"],
  ["lqe/translation.lqe", "lqe"],
  ["lrc/header-by-tag.lrc", "lrc"],
  ["lrc/plain-cjk.lrc", "lrc"],
  ["lyl/gapped-lines.lyl", "lyl"],
  ["lys/duet-values.lys", "lys"],
  ["lys/primary-background.lys", "lys"],
  ["qrc/cjk-per-char.qrc", "qrc"],
  ["qrc/parens-in-text.qrc", "qrc"],
  ["ttml/backing-vocals.ttml", "ttml"],
  ["ttml/instrumental-gap.ttml", "ttml"],
  ["ttml/line-timed.ttml", "ttml"],
  ["ttml/pronunciation.ttml", "ttml"],
  ["ttml/translation.ttml", "ttml"],
  ["ttml/word-timed-duet.ttml", "ttml"],
  ["yrc/json-preamble.yrc", "yrc"],
  ["yrc/word-timed-credits.yrc", "yrc"],
] satisfies [string, FormatId][];

const authorCases = [
  {
    format: "lrc",
    source: "[by:Thereallo]\n[00:01.000]Hello",
  },
  {
    format: "eslrc",
    source: "[by:Thereallo]\n[00:01.000]Hello[00:02.000]",
  },
  {
    format: "qrc",
    source: "[by:Thereallo]\n[1000,1000]Hello(1000,1000)",
  },
  {
    format: "yrc",
    source: `${JSON.stringify({ c: [{ tx: "作词: Writer" }], t: 0 })}\n[by:Thereallo]\n[1000,1000](1000,1000,0)Hello`,
  },
  {
    format: "lys",
    source: "[by:Thereallo]\n[4]Hello(1000,1000)",
  },
  {
    format: "lqe",
    source:
      "[Lyricify Quick Export]\n[version:1.0]\n[by:Thereallo]\n[lyrics: format@Lyricify Syllable]\n[4]Hello(1000,1000)",
  },
] satisfies { format: FormatId; source: string }[];

const metadataDocument = {
  agents: [],
  lines: [
    {
      agent: null,
      b: [],
      begin: 1000,
      end: 6000,
      id: "l0",
      p: [{ begin: 1000, end: 6000, id: "l0w0", text: "Hello" }],
    },
  ],
  meta: {},
  timing: "line",
  version: 1,
} satisfies LyricsDocument;

const paddedMetadataCases = [
  { field: "title", meta: { title: " Song" } },
  { field: "artist", meta: { artist: "Artist " } },
  { field: "album", meta: { album: " Album " } },
  { field: "author", meta: { author: " Author" } },
  { field: "songwriter", meta: { songwriters: ["Writer "] } },
] satisfies { field: string; meta: LyricsDocument["meta"] }[];

const precedenceCases = [
  {
    format: "lqe",
    name: "lqe before embedded lys",
    source:
      "[Lyricify Quick Export]\n[version:1.0]\n[lyrics: format@Lyricify Syllable]\n[4]Hi(0,500)",
  },
  {
    format: "yrc",
    name: "yrc before qrc",
    source: "[1000,500](1000,500,0)Hello",
  },
  {
    format: "qrc",
    name: "qrc before lyl",
    source: "[0,1300]Hel(0,400)lo(400,900)",
  },
  {
    format: "eslrc",
    name: "eslrc before lrc",
    source: "[00:00.000]Hel[00:00.500]lo[00:01.000]",
  },
] satisfies { format: FormatId; name: string; source: string }[];

describe("detect", () => {
  test.each(fixtureCases)(
    "detects the %s fixture as %s",
    async (path, format) => {
      expect(
        detect(
          await openFile(new URL(`fixtures/${path}`, import.meta.url)).text()
        )
      ).toBe(format);
    }
  );

  for (const precedence of precedenceCases) {
    test(`chooses ${precedence.name}`, () => {
      expect(detect(precedence.source)).toBe(precedence.format);
    });
  }

  test("treats A2 word tags as lrc", () => {
    const parsed = parse(
      "[00:01.000]<00:01.000>Hello <00:01.500>world\n[00:02.000]next"
    );

    expect(parsed.format).toBe("lrc");
    expect(parsed.doc.timing).toBe("word");
    expect(parsed.doc.lines[0]?.p).toEqual([
      { begin: 1000, end: 1500, id: "l0w0", text: "Hello " },
      { begin: 1500, end: 2000, id: "l0w1", text: "world" },
    ]);
  });

  test("accepts one BOM and CRLF line endings", () => {
    expect(detect("\uFEFF[00:01.000]one\r\n[00:02.000]two\r\n")).toBe("lrc");
  });

  test("recognizes a prefixed Apple TTML root after XML prolog content", () => {
    const source = `<?xml version="1.0"?>\r\n<!-- lyric -->\r\n<x:tt xmlns:x="http://www.w3.org/ns/ttml" xmlns:a="http://music.apple.com/lyric-ttml-internal" a:timing="Word">`;

    expect(detect(source)).toBe("ttml");
  });

  test.each([
    '<tt xmlns="http://www.w3.org/ns/ttml" timing="Word"/>',
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:a="http://music.apple.com/lyric-ttml-internal"/>',
    "<lyrics><line>hello</line></lyrics>",
  ])("returns null for generic XML", (source) => {
    expect(detect(source)).toBeNull();
  });
});

describe("public dispatch", () => {
  test("throws ParseError for unknown input", () => {
    expect(() => parse("plain untimed lyrics")).toThrow(ParseError);
    expect(() => parse("plain untimed lyrics")).toThrow(
      "input contains no recognizable lyric format"
    );
  });

  test("dispatches read and write with exact millisecond timestamps", () => {
    const doc = read("[00:01.250]One\n[00:02.000]Two", "lrc");
    const before = structuredClone(doc);

    expect(
      doc.lines.map((line) => ({
        begin: line.begin,
        end: line.end,
        text: line.p.map((syllable) => syllable.text).join(""),
      }))
    ).toEqual([
      { begin: 1250, end: 2000, text: "One" },
      { begin: 2000, end: 7000, text: "Two" },
    ]);
    expect(write(doc, "lrc")).toBe("[by:]\n[00:01.250]One\n[00:02.000]Two");
    expect(doc).toEqual(before);
  });

  test("projects arbitrary ttml person ids into lys and lqe alignment sides", () => {
    const lyricDocument = {
      agents: [
        { id: "voice-401", type: "person" },
        { id: "guest-92", type: "person" },
        { id: "chorus", type: "group" },
        { id: "reply", type: "other" },
        { id: "unclassified", type: "character" },
      ],
      lines: [
        {
          agent: "voice-401",
          b: [],
          begin: 1000,
          end: 1500,
          id: "l0",
          p: [{ begin: 1000, end: 1500, id: "l0w0", text: "Lead" }],
        },
        {
          agent: "voice-401",
          b: [],
          begin: 2000,
          end: 2500,
          id: "l1",
          p: [{ begin: 2000, end: 2500, id: "l1w0", text: "Lead again" }],
        },
        {
          agent: "guest-92",
          b: [],
          begin: 3000,
          end: 3500,
          id: "l2",
          p: [{ begin: 3000, end: 3500, id: "l2w0", text: "Guest" }],
        },
        {
          agent: null,
          b: [],
          begin: 4000,
          end: 4500,
          id: "l3",
          p: [{ begin: 4000, end: 4500, id: "l3w0", text: "Inherited" }],
        },
        {
          agent: "chorus",
          b: [],
          begin: 5000,
          end: 5500,
          id: "l4",
          p: [{ begin: 5000, end: 5500, id: "l4w0", text: "Chorus" }],
        },
        {
          agent: "reply",
          b: [],
          begin: 6000,
          end: 6500,
          id: "l5",
          p: [{ begin: 6000, end: 6500, id: "l5w0", text: "Reply" }],
        },
        {
          agent: "unclassified",
          b: [],
          begin: 7000,
          end: 7500,
          id: "l6",
          p: [{ begin: 7000, end: 7500, id: "l6w0", text: "Unknown" }],
        },
      ],
      meta: {},
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;
    const before = structuredClone(lyricDocument);
    const ttml = write(lyricDocument, "ttml");
    const expectedRows = [
      "[4]Lead(1000,500)",
      "[4]Lead again(2000,500)",
      "[5]Guest(3000,500)",
      "[5]Inherited(4000,500)",
      "[4]Chorus(5000,500)",
      "[5]Reply(6000,500)",
      "[5]Unknown(7000,500)",
    ];
    const lys = convert(ttml, "lys");
    const lqe = convert(ttml, "lqe");

    expect(read(ttml, "ttml").agents).toEqual(lyricDocument.agents);
    expect(lys).toBe(`[by:]\n${expectedRows.join("\n")}`);
    expect(lqe).toContain(expectedRows.join("\n"));
    for (const format of ["lys", "lqe"] satisfies FormatId[]) {
      const aligned = read(format === "lys" ? lys : lqe, format);

      expect(aligned.agents).toEqual([
        { id: "v1", type: "person" },
        { id: "v2", type: "person" },
      ]);
      expect(aligned.lines.map((line) => line.agent)).toEqual([
        "v1",
        "v1",
        "v2",
        "v2",
        "v1",
        "v2",
        "v2",
      ]);
    }
    expect(capabilities("ttml").agents).toBe("identity");
    expect(capabilities("lys").agents).toBe("alignment");
    expect(capabilities("lqe").agents).toBe("alignment");
    expect(lyricDocument).toEqual(before);
  });

  test("writes lys duet sides as ttml agents", () => {
    const paired = read(
      "[4]Left(1000,500)\n[5]Right(2000,500)\n[5]Right again(3000,500)",
      "lys"
    );
    const isolated = read("[5]Right(1000,500)", "lys");

    expect(paired.agents).toEqual([
      { id: "v1", type: "person" },
      { id: "v2", type: "person" },
    ]);
    expect(write(paired, "ttml")).toContain(
      '<ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/>'
    );
    expect(isolated.agents).toEqual([{ id: "v2", type: "other" }]);
    expect(write(isolated, "ttml")).toContain(
      '<ttm:agent type="other" xml:id="v2"/>'
    );
  });

  test("projects lys line bounds to timed syllable bounds", () => {
    const lyricDocument = {
      agents: [],
      lines: [
        {
          agent: null,
          b: [{ begin: 1200, end: 1800, id: "l0b0", text: "Reply" }],
          begin: 1000,
          end: 2000,
          id: "l0",
          p: [{ begin: 1100, end: 1900, id: "l0w0", text: "Lead" }],
        },
      ],
      meta: {},
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;
    const before = structuredClone(lyricDocument);

    expect(losses(lyricDocument, "lys")).toEqual(["lineRange"]);
    expect(() => write(lyricDocument, "lys")).toThrow(
      "lys cannot represent the range of line l0"
    );
    expect(
      read(write(lyricDocument, "lys", { lossy: true }), "lys").lines[0]
    ).toMatchObject({
      b: [{ begin: 1200, end: 1800, text: "Reply" }],
      begin: 1100,
      end: 1900,
      p: [{ begin: 1100, end: 1900, text: "Lead" }],
    });
    expect(lyricDocument).toEqual(before);
  });

  test("silently drops empty lys lines without reporting a loss", () => {
    const lyricDocument = {
      agents: [],
      lines: [
        {
          agent: null,
          b: [],
          begin: 1000,
          end: 1500,
          id: "l0",
          p: [{ begin: 1000, end: 1500, id: "l0w0", text: "Lead" }],
        },
        { agent: null, b: [], begin: 2000, end: 2500, id: "l1", p: [] },
      ],
      meta: {},
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;
    const before = structuredClone(lyricDocument);

    expect(losses(lyricDocument, "lys")).toEqual([]);
    expect(read(write(lyricDocument, "lys"), "lys").lines).toMatchObject([
      { id: "l0", p: [{ text: "Lead" }] },
    ]);
    expect(lyricDocument).toEqual(before);
  });

  test("removes orphan backing-only lys lines only during lossy writes", () => {
    const lyricDocument = {
      agents: [{ id: "v1", type: "person" }],
      lines: [
        {
          agent: "v1",
          b: [{ begin: 1200, end: 1500, id: "l0b0", text: "Reply" }],
          begin: 1000,
          end: 1500,
          id: "l0",
          p: [{ begin: 1000, end: 1500, id: "l0w0", text: "Lead" }],
        },
        {
          agent: "v1",
          b: [{ begin: 2000, end: 2500, id: "l1b0", text: "Echo" }],
          begin: 2000,
          end: 2500,
          id: "l1",
          p: [],
        },
      ],
      meta: {},
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;
    const before = structuredClone(lyricDocument);

    expect(losses(lyricDocument, "lys")).toEqual(["backing"]);
    expect(() => write(lyricDocument, "lys")).toThrow(
      "lys cannot preserve backing-only line l1"
    );
    expect(
      read(write(lyricDocument, "lys", { lossy: true }), "lys").lines
    ).toMatchObject([
      {
        b: [{ begin: 1200, end: 1500, text: "Reply" }],
        id: "l0",
        p: [{ text: "Lead" }],
      },
    ]);
    expect(lyricDocument).toEqual(before);
  });

  test("reports and removes LQE translations on orphan backing-only lines", () => {
    const lyricDocument = {
      agents: [],
      lines: [
        {
          agent: null,
          b: [],
          begin: 1000,
          end: 1500,
          id: "l0",
          p: [{ begin: 1000, end: 1500, id: "l0w0", text: "Lead" }],
        },
        {
          agent: null,
          b: [{ begin: 2000, end: 2500, id: "l1b0", text: "Echo" }],
          begin: 2000,
          end: 2500,
          id: "l1",
          p: [],
          translations: { fr: { b: "Écho", p: "" } },
        },
      ],
      meta: {},
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;
    const before = structuredClone(lyricDocument);

    expect(losses(lyricDocument, "lqe")).toEqual(["backing", "translations"]);
    expect(
      read(write(lyricDocument, "lqe", { lossy: true }), "lqe").lines
    ).toMatchObject([{ id: "l0", p: [{ text: "Lead" }] }]);
    expect(lyricDocument).toEqual(before);
  });

  test("rejects undeclared lys agents", () => {
    const lyricDocument = {
      agents: [],
      lines: [
        {
          agent: "missing",
          b: [],
          begin: 1000,
          end: 1500,
          id: "l0",
          p: [{ begin: 1000, end: 1500, id: "l0w0", text: "Missing" }],
        },
      ],
      meta: {},
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;
    const before = structuredClone(lyricDocument);

    expect(() => write(lyricDocument, "lys")).toThrow(
      "line l0 references an undeclared lys agent"
    );
    expect(lyricDocument).toEqual(before);
  });

  test("converts through the detected reader and selected writer", () => {
    const converted = convert(
      "[00:01.250]One[00:02.000]\n[00:02.000]Two[00:07.000]",
      "qrc"
    );

    expect(converted).toBe(
      "[by:]\n[1250,750]One(1250,750)\n[2000,5000]Two(2000,5000)"
    );
    expect(detect(converted)).toBe("qrc");
  });

  test.each(["eslrc", "lqe", "lys", "qrc", "yrc"] satisfies FormatId[])(
    "refuses a line-timed document in %s even when lossy",
    (format) => {
      const doc = read("[00:01.250]One\n[00:02.000]Two", "lrc");

      expect(() => write(doc, format)).toThrow(
        `${format} cannot represent line timing`
      );
      expect(() => write(doc, format, { lossy: true })).toThrow(
        `${format} cannot represent line timing`
      );
    }
  );

  test("requires an explicit lossy QRC to TTML conversion", () => {
    const source = [
      "[ti:Song]",
      "[ar:Artist]",
      "[al:Album]",
      "[by:Writer]",
      "[au:Composer]",
      "[12000,3320]Hel(12000,400)lo (12400,300)world(12700,600)",
    ].join("\n");
    const doc = read(source, "qrc");
    const before = structuredClone(doc);

    expect(doc.meta).toEqual({
      album: "Album",
      artist: "Artist",
      author: "Writer",
      songwriters: ["Composer"],
      title: "Song",
    });
    expect(
      doc.lines
        .flatMap((line) => line.p)
        .map((syllable) => syllable.text)
        .join("")
    ).toBe("Hello world");
    expect(losses(doc, "ttml")).toEqual([
      "metadata.album",
      "metadata.artist",
      "metadata.author",
      "metadata.title",
    ]);
    expect(() => convert(source, "ttml")).toThrow(
      "ttml cannot represent a lyric file author"
    );

    const converted = convert(source, "ttml", { lossy: true });
    const restored = read(converted, "ttml");

    expect(restored.meta).toEqual({ songwriters: ["Composer"] });
    expect(
      restored.lines
        .flatMap((line) => line.p)
        .map((syllable) => syllable.text)
        .join("")
    ).toBe("Hello world");
    expect(write(doc, "ttml", { lossy: true })).toBe(converted);
    expect(writeTtml(doc, { lossy: true })).toBe(converted);
    expect(doc).toEqual(before);
  });

  test("projects unsupported tracks, agents, and word timing when requested", () => {
    const lyricDocument = {
      agents: [{ id: "voice", type: "person" }],
      lines: [
        {
          agent: "voice",
          b: [{ begin: 1000, end: 1500, id: "l0b0", text: "Back" }],
          begin: 1000,
          end: 2000,
          id: "l0",
          p: [
            { begin: 1000, end: 1500, id: "l0w0", text: "Hel" },
            { begin: 1500, end: 2000, id: "l0w1", text: "lo" },
          ],
          pronunciations: { en: { b: [], p: [] } },
          translations: { fr: { p: "Bonjour" } },
        },
        {
          agent: "voice",
          b: [],
          begin: 2000,
          end: 7000,
          id: "l1",
          p: [{ begin: 2000, end: 7000, id: "l1w0", text: "World" }],
        },
      ],
      meta: {},
      pronunciationTracks: { en: { automaticallyCreated: true } },
      timing: "word",
      translationTracks: { fr: { automaticallyCreated: true } },
      version: 1,
    } satisfies LyricsDocument;

    expect(losses(lyricDocument, "lrc")).toEqual([
      "wordTiming",
      "lineRange",
      "agents",
      "backing",
      "translations",
      "pronunciations",
    ]);
    expect(() => write(lyricDocument, "lrc")).toThrow(
      "lrc cannot represent word timing"
    );
    expect(write(lyricDocument, "lrc", { lossy: true })).toBe(
      "[by:]\n[00:01.000]Hello\n[00:02.000]World"
    );
  });

  test("rejects repeat expansion for other readers", () => {
    expect(() =>
      read("[0,500]Hi(0,500)", "qrc", { expandRepeats: true })
    ).toThrow("expandRepeats is available for lrc input");
  });

  test.each(authorCases)(
    "round-trips $format lyric authors",
    ({ format, source }) => {
      const doc = read(source, format);
      const restored = read(write(doc, format), format);

      expect(doc.meta.author).toBe("Thereallo");
      expect(
        doc.lines
          .slice(0, 1)
          .flatMap((line) => line.p.map((syllable) => syllable.text))
          .join("")
      ).toBe("Hello");
      expect(restored.meta.author).toBe("Thereallo");
    }
  );

  test.each(authorCases)(
    "treats empty $format authors as absent",
    ({ format, source }) => {
      const doc = read(source.replace("[by:Thereallo]", "[by:]"), format);

      expect(doc.meta.author).toBeUndefined();
      expect(
        doc.lines
          .slice(0, 1)
          .flatMap((line) => line.p.map((syllable) => syllable.text))
          .join("")
      ).toBe("Hello");
    }
  );

  test("trims whitespace inside lyric author tags", () => {
    const doc = read("[by:  There:allo [mix]  ]\n[00:01.000]Hello", "lrc");

    expect(doc.meta.author).toBe("There:allo [mix]");
    expect(doc.lines[0]?.p[0]?.text).toBe("Hello");
    expect(write(doc, "lrc").split("\n")[0]).toBe("[by:There:allo [mix]]");
  });

  test("places the lqe author directly after its version", () => {
    const source =
      "[Lyricify Quick Export]\n[version:1.0]\n[by:Thereallo]\n[lyrics: format@Lyricify Syllable]\n[4]Hello(1000,1000)";

    expect(write(read(source, "lqe"), "lqe").split("\n").slice(0, 3)).toEqual([
      "[Lyricify Quick Export]",
      "[version:1.0]",
      "[by:Thereallo]",
    ]);
  });

  test.each(paddedMetadataCases)(
    "rejects $field padding in metadata without mutation",
    ({ meta }) => {
      const doc = { ...metadataDocument, meta: structuredClone(meta) };
      const before = structuredClone(doc);

      expect(() => write(doc, "lrc")).toThrow(
        "lrc cannot preserve leading or trailing metadata whitespace"
      );
      expect(doc).toEqual(before);
    }
  );

  test("keeps LQE translations stable when writing TTML", () => {
    const source = [
      "[Lyricify Quick Export]",
      "[version:1.0]",
      "[lyrics: format@Lyricify Syllable]",
      "[4]Hello(1000,1000)",
      "[translation: language@fr, format@LRC]",
      "[00:01.000]Bonjour",
    ].join("\n");
    const doc = read(source, "lqe");
    const ttml = write(doc, "ttml");

    expect(doc.lines[0]?.translations?.fr).toEqual({
      p: "Bonjour",
    });
    expect(doc.translationTracks).toEqual({ fr: { kind: "subtitle" } });
    expect(ttml).toContain('<translation type="subtitle" xml:lang="fr">');
    expect(read(ttml, "ttml")).toEqual(doc);
  });

  test("projects LQE translation metadata without losing unrelated languages", () => {
    const doc: LyricsDocument = {
      agents: [],
      lines: [
        {
          agent: null,
          b: [{ begin: 1500, end: 2000, id: "l0b0", text: "Reply" }],
          begin: 1000,
          end: 2000,
          id: "l0",
          p: [{ begin: 1000, end: 2000, id: "l0w0", text: "Lead" }],
          translations: {
            fr: {
              b: "Réponse",
              p: "Bonjour",
            },
            ja: { p: "一" },
          },
        },
        {
          agent: null,
          b: [],
          begin: 2000,
          end: 2500,
          id: "l1",
          p: [{ begin: 2000, end: 2500, id: "l1w0", text: "Next" }],
          translations: {
            de: { p: "Zwei" },
            ja: { p: "二" },
          },
        },
      ],
      meta: {},
      timing: "word",
      translationTracks: {
        de: { automaticallyCreated: false },
        fr: { automaticallyCreated: true, kind: "replacement" },
      },
      version: 1,
    };
    const before = structuredClone(doc);

    expect(losses(doc, "lqe")).toEqual(["translations"]);
    expect(() => write(doc, "lqe")).toThrow(
      "lqe cannot represent replacement translations"
    );

    const restored = read(write(doc, "lqe", { lossy: true }), "lqe");

    expect(restored.lines.map((line) => line.translations)).toEqual([
      {
        de: { p: "" },
        fr: { b: "Réponse", p: "Bonjour" },
        ja: { p: "一" },
      },
      {
        de: { p: "Zwei" },
        fr: { p: "" },
        ja: { p: "二" },
      },
    ]);
    expect(restored.translationTracks).toEqual({
      de: { kind: "subtitle" },
      fr: { kind: "subtitle" },
      ja: { kind: "subtitle" },
    });
    expect(doc).toEqual(before);
  });

  test("binds same-timestamp primary and backing translations by track order", () => {
    const doc: LyricsDocument = {
      agents: [],
      lines: [
        {
          agent: null,
          b: [{ begin: 1000, end: 1500, id: "l0b0", text: "Reply" }],
          begin: 1000,
          end: 1500,
          id: "l0",
          p: [{ begin: 1000, end: 1500, id: "l0w0", text: "Lead" }],
          translations: { fr: { b: "Réponse", p: "Bonjour" } },
        },
      ],
      meta: {},
      timing: "word",
      version: 1,
    };
    const before = structuredClone(doc);

    expect(losses(doc, "lqe")).toEqual([]);
    expect(read(write(doc, "lqe"), "lqe").lines[0]?.translations).toEqual({
      fr: { b: "Réponse", p: "Bonjour" },
    });
    expect(doc).toEqual(before);
  });

  test("drops a backing translation with no backing lyric target", () => {
    const doc: LyricsDocument = {
      agents: [],
      lines: [
        {
          agent: null,
          b: [],
          begin: 1000,
          end: 1500,
          id: "l0",
          p: [{ begin: 1000, end: 1500, id: "l0w0", text: "Lead" }],
          translations: { fr: { b: "Réponse", p: "Bonjour" } },
        },
      ],
      meta: {},
      timing: "word",
      version: 1,
    };

    expect(losses(doc, "lqe")).toEqual(["translations"]);
    expect(() => write(doc, "lqe")).toThrow(
      "lqe cannot place backing translation for line l0"
    );
    expect(
      read(write(doc, "lqe", { lossy: true }), "lqe").lines[0]?.translations
    ).toEqual({ fr: { p: "Bonjour" } });
  });

  test("rejects line breaks in authors", () => {
    const doc = read("[by:Thereallo]\n[00:01.000]Hello", "lrc");
    doc.meta.author = "There\nallo";

    expect(() => write(doc, "lrc")).toThrow(
      "lrc cannot represent line breaks in an author"
    );
  });

  test("rejects lyric authors in ttml output", () => {
    const doc = read("[00:01.000]Hello", "lrc");
    doc.meta.author = "Thereallo";

    expect(() => write(doc, "ttml")).toThrow(
      "ttml cannot represent a lyric file author"
    );
  });

  test("projects songwriter cardinality without mutation", () => {
    const doc = read("[00:01.000]Hello", "lrc");
    doc.meta.songwriters = ["One", "Two"];
    const before = structuredClone(doc);

    expect(losses(doc, "lrc")).toEqual(["metadata.songwriters"]);
    expect(() => write(doc, "lrc")).toThrow(
      "lrc cannot represent multiple songwriters"
    );
    expect(
      read(write(doc, "lrc", { lossy: true }), "lrc").meta.songwriters
    ).toEqual(["One"]);
    expect(doc).toEqual(before);
  });

  test.each([
    ["lrc", "[00:01.000]Hello"],
    ["yrc", "[1000,1000](1000,1000,0)Hello"],
  ] satisfies [FormatId, string][])(
    "omits empty %s songwriter metadata during a lossy write",
    (format, source) => {
      const doc = read(source, format);
      doc.meta.songwriters = [];
      const before = structuredClone(doc);

      expect(losses(doc, format)).toEqual(["metadata.songwriters"]);
      expect(() => write(doc, format)).toThrow(
        `${format} cannot represent an empty songwriter list`
      );
      expect(
        read(write(doc, format, { lossy: true }), format).meta.songwriters
      ).toBeUndefined();
      expect(doc).toEqual(before);
    }
  );

  test("omits empty songwriter names during a lossy write", () => {
    const doc = read("[00:01.000]Hello", "lrc");
    doc.meta.songwriters = [""];

    expect(losses(doc, "lrc")).toEqual(["metadata.songwriters"]);
    expect(() => write(doc, "lrc")).toThrow(
      "lrc cannot represent an empty songwriter name"
    );
    expect(
      read(write(doc, "lrc", { lossy: true }), "lrc").meta.songwriters
    ).toBeUndefined();
  });

  test("projects invalid yrc songwriter lists in source order without mutation", () => {
    const doc = read("[1000,1000](1000,1000,0)Hello", "yrc");
    doc.meta.songwriters = [" One ", "Two/Three", "Good"];
    const before = structuredClone(doc);

    expect(losses(doc, "yrc")).toEqual(["metadata.songwriters"]);
    expect(() => write(doc, "yrc")).toThrow(
      "yrc cannot preserve leading or trailing metadata whitespace"
    );
    expect(
      read(write(doc, "yrc", { lossy: true }), "yrc").meta.songwriters
    ).toEqual(["Good"]);
    expect(doc).toEqual(before);
  });

  test("uses the first trimmed slash-safe yrc songwriter when none is valid", () => {
    const doc = read("[1000,1000](1000,1000,0)Hello", "yrc");
    doc.meta.songwriters = [" One ", "Two/Three"];

    expect(
      read(write(doc, "yrc", { lossy: true }), "yrc").meta.songwriters
    ).toEqual(["One"]);
  });

  test("normalizes padded multiline metadata during a lossy write", () => {
    const doc = read("[00:01.000]Hello", "lrc");
    doc.meta.title = " Song\nTitle ";
    const before = structuredClone(doc);

    expect(losses(doc, "lrc")).toEqual(["metadata.title"]);
    expect(read(write(doc, "lrc", { lossy: true }), "lrc").meta.title).toBe(
      "Song Title"
    );
    expect(doc).toEqual(before);
  });

  test("omits a normalized-empty author during a lossy write", () => {
    const doc = read("[00:01.000]Hello", "lrc");
    doc.meta.author = " \r\n ";
    const before = structuredClone(doc);

    expect(losses(doc, "lrc")).toEqual(["metadata.author"]);
    expect(() => write(doc, "lrc")).toThrow(
      "lrc cannot represent line breaks in an author"
    );
    expect(
      read(write(doc, "lrc", { lossy: true }), "lrc").meta.author
    ).toBeUndefined();
    expect(doc).toEqual(before);
  });

  test("projects lrc implicit line ends and primary syllable ranges", () => {
    const doc = read("[00:01.000]One\n[00:03.000]Two", "lrc");
    const [firstLine, secondLine] = doc.lines;
    if (!(firstLine && secondLine)) {
      throw new Error("lrc source must produce two lines");
    }
    const [secondSyllable] = secondLine.p;
    if (secondSyllable === undefined) {
      throw new Error("lrc source must produce a final syllable");
    }
    doc.lines[0] = {
      ...firstLine,
      end: 2600,
      p: [
        { begin: 1000, end: 1500, id: "l0w0", text: "O" },
        { begin: 1500, end: 2600, id: "l0w1", text: "ne" },
      ],
    };
    doc.lines[1] = {
      ...secondLine,
      end: 9000,
      p: [{ ...secondSyllable, end: 9000 }],
    };
    const before = structuredClone(doc);

    expect(losses(doc, "lrc")).toEqual(["lineRange"]);
    expect(() => write(doc, "lrc")).toThrow(
      "lrc cannot represent the end time of line l0"
    );
    const restored = read(write(doc, "lrc", { lossy: true }), "lrc");

    expect(restored.lines.map((line) => [line.begin, line.end])).toEqual([
      [1000, 3000],
      [3000, 8000],
    ]);
    expect(restored.lines[0]?.p).toEqual([
      { begin: 1000, end: 3000, id: "l0w0", text: "One" },
    ]);
    expect(restored.lines[1]?.p).toEqual([
      { begin: 3000, end: 8000, id: "l1w0", text: "Two" },
    ]);
    expect(doc).toEqual(before);
  });

  test("drops an empty lrc line rather than keeping a placeholder", () => {
    const doc = read("[00:01.000]One\n[00:02.000]Two", "lrc");
    const [firstLine, secondLine] = doc.lines;
    if (!(firstLine && secondLine)) {
      throw new Error("lrc source must produce two lines");
    }
    doc.lines[0] = { ...firstLine, end: 2000, p: [] };
    const before = structuredClone(doc);

    expect(losses(doc, "lrc")).toEqual([]);
    expect(
      read(write(doc, "lrc"), "lrc").lines.map((line) => [
        line.begin,
        line.end,
        line.p.map((syllable) => syllable.text),
      ])
    ).toEqual([[2000, 7000, ["Two"]]]);
    expect(doc).toEqual(before);
  });

  test("projects out-of-order lrc starts into chronological line order", () => {
    const doc = read("[00:01.000]One\n[00:02.000]Two", "lrc");
    const [firstLine, secondLine] = doc.lines;
    if (!(firstLine && secondLine)) {
      throw new Error("lrc source must produce two lines");
    }
    doc.lines = [
      { ...firstLine, begin: 3000, end: 4000 },
      { ...secondLine, begin: 1000, end: 6000 },
    ];
    const before = structuredClone(doc);

    expect(losses(doc, "lrc")).toEqual(["lineRange"]);
    const restored = read(write(doc, "lrc", { lossy: true }), "lrc");

    expect(restored.lines.map((line) => [line.begin, line.end])).toEqual([
      [1000, 3000],
      [3000, 8000],
    ]);
    expect(restored.lines.map((line) => line.p[0]?.text)).toEqual([
      "Two",
      "One",
    ]);
    expect(doc).toEqual(before);
  });

  test.each([
    "eslrc",
    "lqe",
    "lrc",
    "lyl",
    "lys",
    "qrc",
    "yrc",
  ] satisfies FormatId[])(
    "refuses a static document in %s even when lossy",
    (format) => {
      const staticDocument = {
        agents: [],
        lines: [
          {
            agent: null,
            b: [],
            begin: 0,
            end: 0,
            id: "l0",
            p: [{ begin: 0, end: 0, id: "l0w0", text: "Hello" }],
          },
        ],
        meta: {},
        timing: "static",
        version: 1,
      } satisfies LyricsDocument;

      expect(() => write(staticDocument, format)).toThrow(
        `${format} cannot represent static timing`
      );
      expect(() => write(staticDocument, format, { lossy: true })).toThrow(
        `${format} cannot represent static timing`
      );
    }
  );

  test("returns isolated capability snapshots", () => {
    const exposed = capabilities("lrc");

    exposed.timing.word = true;
    exposed.metadata.title = false;
    exposed.trackGenerated = true;
    exposed.trackKind = true;

    expect(capabilities("lrc")).not.toBe(exposed);
    expect(capabilities("lrc").timing).not.toBe(exposed.timing);
    expect(capabilities("lrc").timing.word).toBeFalse();
    expect(capabilities("lrc").metadata).not.toBe(exposed.metadata);
    expect(capabilities("lrc").metadata.title).toBeTrue();
    expect(capabilities("lrc").trackGenerated).toBeFalse();
    expect(capabilities("lrc").trackKind).toBeFalse();
  });
});
