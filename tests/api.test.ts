import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import type { FormatCapabilities, FormatId, LyricsDocument } from "../src";
import {
  capabilities,
  convert,
  detect,
  ParseError,
  parse,
  read,
  write,
} from "../src";

const fixtureCases = [
  ["eslrc/cjk-trailing-stamp.eslrc", "eslrc"],
  ["lqe/translation-by-tag.lqe", "lqe"],
  ["lqe/translation.lqe", "lqe"],
  ["lrc/header-by-tag.lrc", "lrc"],
  ["lrc/plain-cjk.lrc", "lrc"],
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

const capabilityCases = [
  [
    "lrc",
    {
      agents: false,
      author: true,
      backing: false,
      pronunciation: false,
      translation: false,
      wordTiming: false,
    },
  ],
  [
    "eslrc",
    {
      agents: false,
      author: true,
      backing: false,
      pronunciation: false,
      translation: false,
      wordTiming: true,
    },
  ],
  [
    "qrc",
    {
      agents: false,
      author: true,
      backing: true,
      pronunciation: false,
      translation: false,
      wordTiming: true,
    },
  ],
  [
    "yrc",
    {
      agents: false,
      author: true,
      backing: false,
      pronunciation: false,
      translation: false,
      wordTiming: true,
    },
  ],
  [
    "lys",
    {
      agents: true,
      author: true,
      backing: true,
      pronunciation: false,
      translation: false,
      wordTiming: true,
    },
  ],
  [
    "lqe",
    {
      agents: true,
      author: true,
      backing: true,
      pronunciation: false,
      translation: true,
      wordTiming: true,
    },
  ],
  [
    "ttml",
    {
      agents: true,
      author: false,
      backing: true,
      pronunciation: true,
      translation: true,
      wordTiming: true,
    },
  ],
] satisfies [FormatId, FormatCapabilities][];

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

const paddedWriterCases = authorCases.flatMap(({ format }) =>
  paddedMetadataCases.map(({ field, meta }) => ({ field, format, meta }))
);

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

  test("converts through the detected reader and selected writer", () => {
    const converted = convert("[00:01.250]One\n[00:02.000]Two", "eslrc");

    expect(converted).toBe(
      "[by:]\n[00:01.250]One[00:02.000]\n[00:02.000]Two[00:07.000]"
    );
    expect(detect(converted)).toBe("eslrc");
  });

  test("expands repeated lrc timestamps only when requested", () => {
    const source = "[00:01.000][00:02.000]chorus\n[00:03.000]following";

    expect(read(source, "lrc").lines.map((line) => line.begin)).toEqual([
      1000, 3000,
    ]);
    expect(
      read(source, "lrc", { expandRepeats: true }).lines.map(
        (line) => line.begin
      )
    ).toEqual([1000, 2000, 3000]);
  });

  test("rejects repeat expansion for other readers", () => {
    expect(() =>
      read("[0,500]Hi(0,500)", "qrc", { expandRepeats: true })
    ).toThrow("expandRepeats is available for lrc input");
  });

  test("reports malformed input through an explicit reader", () => {
    expect(() => read("[00:xx]broken", "lrc")).toThrow(ParseError);
  });

  test("returns deterministic plain documents and ids", () => {
    const source = "[00:00.000]first\n[00:01.000]second";
    const first = read(source, "lrc");
    const second = read(source, "lrc");

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(structuredClone(first)).toEqual(first);
    expect(first.lines.map((line) => line.id)).toEqual(["l0", "l1"]);
    expect(
      first.lines.flatMap((line) => line.p.map((word) => word.id))
    ).toEqual(["l0w0", "l1w0"]);
  });

  test.each(capabilityCases)(
    "dispatches %s capabilities",
    (format, expected) => {
      expect(capabilities(format)).toEqual(expected);
    }
  );

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

  test.each(paddedWriterCases)(
    "rejects $field padding in $format metadata without mutation",
    ({ format, meta }) => {
      const doc = { ...metadataDocument, meta: structuredClone(meta) };
      const before = structuredClone(doc);

      expect(() => write(doc, format)).toThrow(
        `${format} cannot preserve leading or trailing metadata whitespace`
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
      kind: "subtitle",
      p: "Bonjour",
    });
    expect(ttml).toContain('<translation type="subtitle" xml:lang="fr">');
    expect(read(ttml, "ttml")).toEqual(doc);
  });

  test.each(authorCases)(
    "rejects line breaks in $format authors",
    ({ format, source }) => {
      const doc = read(source, format);
      doc.meta.author = "There\nallo";

      expect(() => write(doc, format)).toThrow(
        `${format} cannot represent line breaks in an author`
      );
    }
  );

  test("rejects lyric authors in ttml output", () => {
    const doc = read("[00:01.000]Hello", "lrc");
    doc.meta.author = "Thereallo";

    expect(() => write(doc, "ttml")).toThrow(
      "ttml cannot represent a lyric file author"
    );
  });

  test("returns isolated capability snapshots", () => {
    const exposed = capabilities("lrc");
    const wordTimed = read("[00:00.000]Hel[00:00.500]lo[00:01.000]", "eslrc");

    exposed.wordTiming = true;

    expect(capabilities("lrc")).not.toBe(exposed);
    expect(capabilities("lrc").wordTiming).toBeFalse();
    expect(() => write(wordTimed, "lrc")).toThrow(
      "lrc cannot represent word timing"
    );
  });
});
