import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import type { FormatCapabilities, FormatId } from "../src";
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
      backing: true,
      pronunciation: true,
      translation: true,
      wordTiming: true,
    },
  ],
] satisfies [FormatId, FormatCapabilities][];

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
