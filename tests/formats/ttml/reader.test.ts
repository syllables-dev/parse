import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { read, write } from "@/formats/ttml";
import {
  ParseError,
  read as readLyrics,
  validate,
  write as writeLyrics,
} from "@/index";

const ttmlUri = "http://www.w3.org/ns/ttml";
const ttmUri = "http://www.w3.org/ns/ttml#metadata";
const itunesUri = "http://music.apple.com/lyric-ttml-internal";

function makeTtml(
  bodyContent: string,
  metadataContent = "",
  timing = "Word",
  bodyAttrs = 'dur="10.000"'
) {
  return [
    `<tt xmlns="${ttmlUri}" xmlns:ttm="${ttmUri}" xmlns:itunes="${itunesUri}" itunes:timing="${timing}" xml:lang="en">`,
    `<head><metadata>${metadataContent}</metadata></head>`,
    `<body ${bodyAttrs}>${bodyContent}</body>`,
    "</tt>",
  ].join("");
}

describe("ttml reader", () => {
  test("treats agent ids and types as opaque strings with inheritance", () => {
    const agents = [
      '<ttm:agent xml:id="v2" type="personish"/>',
      '<ttm:agent xml:id="v1" type="group/raw"/>',
      '<ttm:agent xml:id="voice&amp;guest" type="character &amp; guest"/>',
    ].join("");
    const source = makeTtml(
      [
        '<div begin="1.000" end="3.000" ttm:agent="voice&amp;guest">',
        '<p begin="1.000" end="2.000" itunes:key="guest"><span begin="1.000" end="2.000">Guest</span></p>',
        '<p begin="2.000" end="3.000" itunes:key="lead" ttm:agent="v1"><span begin="2.000" end="3.000">Lead</span></p>',
        "</div>",
        '<div begin="3.000" end="4.000"><p begin="3.000" end="4.000" itunes:key="body"><span begin="3.000" end="4.000">Body</span></p></div>',
      ].join(""),
      agents,
      "Word",
      'dur="4.000" ttm:agent="v2"'
    );

    const doc = read(source);

    expect(doc.agents).toEqual([
      { id: "v2", type: "personish" },
      { id: "v1", type: "group/raw" },
      { id: "voice&guest", type: "character & guest" },
    ]);
    expect(doc.lines.map((line) => line.agent)).toEqual([
      "voice&guest",
      "v1",
      "v2",
    ]);
  });

  test("reads minute timestamps and nested syllable spans as exact integers", () => {
    const source = makeTtml(
      [
        '<div begin="1:02.003" end="12:34.567">',
        '<p begin="1:02.003" end="12:34.567" itunes:key="nested">',
        '<span begin="1:02.003" end="12:34.567">loose ',
        '<itunes:span begin="1:02.003" end="1:02.100">A</itunes:span>',
        '<span begin="1:02.100" end="12:34.567">B</span> tail',
        "</span></p></div>",
      ].join(""),
      "",
      "Word",
      'dur="13:00.000"'
    );

    const doc = read(source);

    expect(doc.lines[0]).toEqual({
      agent: null,
      b: [],
      begin: 62_003,
      end: 754_567,
      id: "nested",
      p: [
        {
          begin: 62_003,
          content: [
            "loose ",
            { begin: 62_003, end: 62_100, id: "nestedw0s0", text: "A" },
            { begin: 62_100, end: 754_567, id: "nestedw0s1", text: "B" },
            " tail",
          ],
          end: 754_567,
          id: "nestedw0",
          text: "loose AB tail",
        },
      ],
    });
    expect(read(write(doc))).toEqual(doc);
  });

  test("round-trips nested backing text after wrapper removal", () => {
    const source = makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000"><span begin="1.000" end="2.000">Lead</span><span ttm:role="x-bg"><span begin="1.000" end="2.000"><span begin="1.000" end="1.500">(Ec</span>ho)</span></span></p></div>'
    );
    const doc = read(source);

    expect(doc.lines[0]?.b[0]).toMatchObject({
      content: [{ text: "Ec" }, "ho"],
      text: "Echo",
    });
    expect(read(write(doc))).toEqual(doc);
  });

  test.each([
    { offset: 1250, sourceOffset: "+1.250", writtenBegin: "0:03.250" },
    { offset: -1250, sourceOffset: "-1.250", writtenBegin: "0:00.750" },
  ])(
    "consumes $sourceOffset across every timed track",
    ({ offset, sourceOffset, writtenBegin }) => {
      const apple = [
        "<itunes:iTunesMetadata>",
        `<itunes:audio lyricOffset="${sourceOffset}"/>`,
        "<itunes:transliterations>",
        '<itunes:transliteration xml:lang="en-Latn"><itunes:text for="offset"><span begin="2.100" end="4.800">hello </span><span ttm:role="x-bg"><span begin="2.800" end="4.000">(echo)</span></span></itunes:text></itunes:transliteration>',
        "</itunes:transliterations>",
        "</itunes:iTunesMetadata>",
      ].join("");
      const source = makeTtml(
        '<div begin="2.000" end="5.000"><p begin="2.000" end="5.000" itunes:key="offset"><span begin="2.000" end="3.000">Hello </span><span begin="3.000" end="5.000">world</span><span ttm:role="x-bg"><span begin="2.500" end="4.500">(echo)</span></span></p></div>',
        apple
      );
      const doc = readLyrics(source, "ttml");
      const [line] = doc.lines;

      expect(doc.meta).toEqual({});
      expect(line).toMatchObject({
        b: [{ begin: 2500 + offset, end: 4500 + offset }],
        begin: 2000 + offset,
        end: 5000 + offset,
        p: [
          { begin: 2000 + offset, end: 3000 + offset },
          { begin: 3000 + offset, end: 5000 + offset },
        ],
        pronunciations: {
          "en-Latn": {
            b: [{ begin: 2800 + offset, end: 4000 + offset }],
            p: [{ begin: 2100 + offset, end: 4800 + offset }],
          },
        },
      });
      expect(doc.apple?.sections?.[0]).toMatchObject({
        begin: 2000 + offset,
        end: 5000 + offset,
      });

      const written = writeLyrics(doc, "ttml");
      expect(written).toContain(`begin="${writtenBegin}"`);
      expect(written.includes("lyricOffset")).toBe(false);
      expect(readLyrics(written, "ttml")).toEqual(doc);
    }
  );

  test("reads an untimed document without any range", () => {
    const source = makeTtml(
      "<div><p>First line</p><p>Second line</p></div><div><p>Third line</p></div>",
      "",
      "None",
      ""
    );
    const doc = readLyrics(source, "ttml");

    expect(doc.timing).toBe("static");
    expect(doc.lines).toEqual([
      {
        agent: null,
        b: [],
        begin: 0,
        end: 0,
        id: "L1",
        p: [{ begin: 0, end: 0, id: "L1w0", text: "First line" }],
      },
      {
        agent: null,
        b: [],
        begin: 0,
        end: 0,
        id: "L2",
        p: [{ begin: 0, end: 0, id: "L2w0", text: "Second line" }],
      },
      {
        agent: null,
        b: [],
        begin: 0,
        end: 0,
        id: "L3",
        p: [{ begin: 0, end: 0, id: "L3w0", text: "Third line" }],
      },
    ]);
    expect(doc.apple?.sections).toEqual([
      { lines: ["L1", "L2"] },
      { lines: ["L3"] },
    ]);
    expect(doc.apple?.body).toBeUndefined();
  });

  test("keeps a body duration declared by an untimed document", () => {
    const doc = readLyrics(
      makeTtml("<div><p>Only line</p></div>", "", "None"),
      "ttml"
    );

    expect(doc.apple?.body).toEqual({ duration: 10_000 });
  });

  test("rejects lyric offsets that shift timestamps below zero", () => {
    const apple =
      '<itunes:iTunesMetadata><itunes:audio lyricOffset="-1.250"/></itunes:iTunesMetadata>';
    const source = makeTtml(
      '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000" itunes:key="underflow"><span begin="1.000" end="3.000">Too early</span></p></div>',
      apple
    );

    expect(() => readLyrics(source, "ttml")).toThrow(ParseError);
  });

  test("preserves raw line-timed primary and backing text", () => {
    const source = makeTtml(
      '<div begin="1.001" end="3.003"><p begin="1.001" end="3.003" itunes:key="raw">Lead <span>raw </span>text <span ttm:role="x-bg">(Echo )</span></p></div>',
      "",
      "Line"
    );

    expect(read(source).lines[0]).toEqual({
      agent: null,
      b: [{ begin: 1001, end: 3003, id: "rawb0", text: "Echo " }],
      begin: 1001,
      end: 3003,
      id: "raw",
      p: [{ begin: 1001, end: 3003, id: "raww0", text: "Lead raw text " }],
    });
  });

  test("keeps Apple backing parentheses as literal timed text", () => {
    const source = makeTtml(
      '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000" itunes:key="kept"><span begin="1.000" end="3.000">Lead</span><span ttm:role="x-bg" itunes:parenthesis="keep"><span begin="1.200" end="1.800">(（Echo</span><span begin="1.800" end="2.700">）)</span></span></p></div>'
    );
    const doc = readLyrics(source, "ttml");
    const original = structuredClone(doc);

    expect(doc.lines[0]?.b).toEqual([
      { begin: 1200, end: 1800, id: "keptb0", text: "(（Echo" },
      { begin: 1800, end: 2700, id: "keptb1", text: "）)" },
    ]);

    for (const format of ["ttml", "qrc"] as const) {
      const written = writeLyrics(doc, format);
      expect(written).toContain("((（Echo");
      expect(written).toContain("）))");
      expect(
        readLyrics(written, format)
          .lines.at(0)
          ?.b.map(({ begin, end, text }) => ({
            begin,
            end,
            text,
          }))
      ).toEqual(
        doc.lines.at(0)?.b.map(({ begin, end, text }) => ({ begin, end, text }))
      );
    }
    expect(doc).toEqual(original);
  });

  test("keeps Apple backing parentheses as literal line-timed text", () => {
    const source = makeTtml(
      '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000" itunes:key="kept">Lead<span ttm:role="x-bg" itunes:parenthesis="keep">(（Echo）)</span></p></div>',
      "",
      "Line"
    );
    const doc = readLyrics(source, "ttml");

    expect(doc.lines[0]?.b).toEqual([
      { begin: 1000, end: 3000, id: "keptb0", text: "(（Echo）)" },
    ]);
    expect(writeLyrics(doc, "ttml")).toContain("((（Echo）))");
    expect(readLyrics(writeLyrics(doc, "ttml"), "ttml")).toEqual(doc);
  });

  test("removes ordinary Apple backing wrappers while preserving full-width text", () => {
    const source = makeTtml(
      '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000" itunes:key="ordinary"><span begin="1.000" end="3.000">Lead</span><span ttm:role="x-bg"><span begin="1.200" end="2.700">(（Echo）)</span></span></p></div>'
    );

    expect(readLyrics(source, "ttml").lines[0]?.b).toEqual([
      { begin: 1200, end: 2700, id: "ordinaryb0", text: "（Echo）" },
    ]);
  });

  test("reads the ttml title into document metadata", () => {
    const doc = readLyrics(
      makeTtml(
        '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000">Hi</p></div>',
        "<ttm:title>Everything Goes On</ttm:title>"
      ),
      "ttml"
    );

    expect(doc.meta.title).toBe("Everything Goes On");
  });

  test("reads past presentation and parameter vocabularies", () => {
    const source = makeTtml(
      '<div begin="1.000" end="3.000" region="r1"><p begin="1.000" end="3.000" region="r1" style="s1"><span begin="1.000" end="2.000" style="s1">Hi</span><br/><span begin="2.000" end="3.000">there</span></p></div>',
      '<amll:meta key="album" value="Everything Goes On - Single"/>',
      "Word",
      'dur="10.000" region="r1"'
    )
      .replace(
        "<tt ",
        '<tt xmlns:amll="urn:example:amll" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="30" '
      )
      .replace(
        "<head>",
        '<head><styling xmlns:tts="http://www.w3.org/ns/ttml#styling"><style xml:id="s1" tts:color="white"/></styling><layout><region xml:id="r1"/></layout>'
      );
    const doc = readLyrics(source, "ttml");

    expect(doc.lines[0]?.p).toMatchObject([{ text: "Hi" }, { text: "there" }]);
  });

  test("keeps lyric text flowing around a foreign inline element", () => {
    const source = makeTtml(
      '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000"><span begin="1.000" end="2.000">Hi</span><x:note>skip me</x:note><span begin="2.000" end="3.000">there</span></p><x:aside/></div>',
      ""
    ).replace("<tt ", '<tt xmlns:x="urn:example:x" ');
    const doc = readLyrics(source, "ttml");

    expect(doc.lines[0]?.p).toMatchObject([{ text: "Hi" }, { text: "there" }]);
  });

  test("accepts an unknown Apple attribute rather than failing the read", () => {
    const source = makeTtml(
      '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000"><span begin="1.000" end="3.000">Hi</span></p></div>'
    ).replace("itunes:timing=", 'itunes:someFutureField="7" itunes:timing=');

    expect(readLyrics(source, "ttml").lines).toHaveLength(1);
  });

  test("still rejects an unknown element in a namespace this profile owns", () => {
    expect(() =>
      readLyrics(
        makeTtml(
          '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000">Hi</p></div>',
          "<ttm:copyright>anything</ttm:copyright>"
        ),
        "ttml"
      )
    ).toThrow(ParseError);
  });

  test("keeps Apple translation and pronunciation backing parentheses", () => {
    const metadata = [
      "<itunes:iTunesMetadata>",
      "<itunes:translations>",
      '<itunes:translation type="subtitle" xml:lang="fr"><itunes:text for="kept">Salut<span ttm:role="x-bg" itunes:parenthesis="keep">(（Écho）)</span></itunes:text></itunes:translation>',
      "</itunes:translations>",
      "<itunes:transliterations>",
      '<itunes:transliteration xml:lang="en-Latn"><itunes:text for="kept"><span begin="1.000" end="3.000">lead</span><span ttm:role="x-bg" itunes:parenthesis="keep"><span begin="1.200" end="2.700">(（echo）)</span></span></itunes:text></itunes:transliteration>',
      "</itunes:transliterations>",
      "</itunes:iTunesMetadata>",
    ].join("");
    const source = makeTtml(
      '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000" itunes:key="kept"><span begin="1.000" end="3.000">Lead</span></p></div>',
      metadata
    );
    const doc = readLyrics(source, "ttml");

    expect(doc.lines.at(0)?.translations?.fr?.b).toBe("(（Écho）)");
    expect(doc.lines.at(0)?.pronunciations?.["en-Latn"]?.b).toEqual([
      { begin: 1200, end: 2700, id: "keptr0b0", text: "(（echo）)" },
    ]);
    expect(readLyrics(writeLyrics(doc, "ttml"), "ttml")).toEqual(doc);
  });

  test("round-trips subtitle and replacement translations", () => {
    const apple = [
      "<itunes:iTunesMetadata><itunes:translations>",
      '<itunes:translation type="subtitle" xml:lang="fr-CA"><itunes:text for="line">Salut <span ttm:role="x-bg">(Écho )</span></itunes:text></itunes:translation>',
      '<itunes:translation type="replacement" xml:lang="yue-Hant-HK"><itunes:text itunes:key="line">你好</itunes:text></itunes:translation>',
      "</itunes:translations></itunes:iTunesMetadata>",
    ].join("");
    const source = makeTtml(
      '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000" itunes:key="line"><span begin="1.000" end="3.000">Hello</span></p></div>',
      apple
    );

    const doc = readLyrics(source, "ttml");

    expect(doc.lines[0]?.translations).toEqual({
      "fr-CA": { b: "Écho ", p: "Salut " },
      "yue-Hant-HK": { p: "你好" },
    });
    expect(doc.translationTracks).toEqual({
      "fr-CA": { kind: "subtitle" },
      "yue-Hant-HK": { kind: "replacement" },
    });
    expect(writeLyrics(doc, "ttml")).toContain(
      '<translation type="replacement" xml:lang="yue-Hant-HK">'
    );
    expect(readLyrics(writeLyrics(doc, "ttml"), "ttml")).toEqual(doc);
  });

  test("keeps independently timed primary and backing pronunciations", () => {
    const apple = [
      "<itunes:iTunesMetadata><itunes:transliterations>",
      '<itunes:transliteration xml:lang="ja-Latn"><itunes:text for="line"><span begin="1.100" end="1.900">koe </span><span begin="1.900" end="2.700">uta</span><span ttm:role="x-bg"><span begin="1.500" end="2.500">(echo)</span></span></itunes:text></itunes:transliteration>',
      '<itunes:transliteration xml:lang="ja-Kana"><itunes:text for="line"><span begin="1.200" end="2.600">こえうた</span></itunes:text></itunes:transliteration>',
      "</itunes:transliterations></itunes:iTunesMetadata>",
    ].join("");
    const source = makeTtml(
      '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000" itunes:key="line"><span begin="1.000" end="3.000">声歌</span></p></div>',
      apple
    );

    expect(read(source).lines[0]?.pronunciations).toEqual({
      "ja-Kana": {
        b: [],
        p: [{ begin: 1200, end: 2600, id: "liner1w0", text: "こえうた" }],
      },
      "ja-Latn": {
        b: [{ begin: 1500, end: 2500, id: "liner0b0", text: "echo" }],
        p: [
          { begin: 1100, end: 1900, id: "liner0w0", text: "koe " },
          { begin: 1900, end: 2700, id: "liner0w1", text: "uta" },
        ],
      },
    });
  });

  test("carries a QRC spacer folded into its syllable through Apple TTML", async () => {
    const qrc = readLyrics(
      await openFile(
        new URL("../../fixtures/qrc/cjk-per-char.qrc", import.meta.url)
      ).text(),
      "qrc"
    );
    const [, , , , sourceLine] = qrc.lines;
    const ttml = writeLyrics(qrc, "ttml", { lossy: true });
    const roundTripped = readLyrics(ttml, "ttml");

    expect(sourceLine?.p).toContainEqual({
      begin: 13_843,
      end: 14_227,
      id: "l4w2",
      text: "了 ",
    });
    expect(validate(qrc)).toEqual([]);
    expect(ttml).toContain('<span begin="0:13.843" end="0:14.227">了 </span>');
    expect(ttml).not.toContain('end="0:14.227"> </span>');
    expect(roundTripped.lines).toEqual(qrc.lines);
  });

  test.each([
    {
      attribute: ' automaticallyCreated="true"',
      created: true,
      state: "true",
    },
    {
      attribute: ' automaticallyCreated="false"',
      created: false,
      state: "false",
    },
    {
      attribute: ' automaticallyCreated="TRUE"',
      created: false,
      state: "case-sensitive false",
    },
    { attribute: "", created: undefined, state: "absent" },
  ])(
    "preserves the $state automaticallyCreated state on parallel tracks",
    ({ attribute, created }) => {
      const apple = [
        "<itunes:iTunesMetadata>",
        "<itunes:translations>",
        `<itunes:translation type="subtitle" xml:lang="fr"${attribute}><itunes:text for="line">Bonjour le monde</itunes:text></itunes:translation>`,
        "</itunes:translations>",
        "<itunes:transliterations>",
        `<itunes:transliteration xml:lang="en-Latn"${attribute}><itunes:text for="line"><span begin="1.100" end="2.900">hello world</span></itunes:text></itunes:transliteration>`,
        "</itunes:transliterations>",
        "</itunes:iTunesMetadata>",
      ].join("");
      const source = makeTtml(
        '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000" itunes:key="line"><span begin="1.000" end="2.000">Hello </span><span begin="2.000" end="3.000">world</span></p></div>',
        apple
      );
      const doc = readLyrics(source, "ttml");
      const createdField =
        created === undefined ? {} : { automaticallyCreated: created };

      expect(doc.lines[0]?.translations?.fr).toEqual({
        p: "Bonjour le monde",
      });
      expect(doc.lines[0]?.pronunciations?.["en-Latn"]).toEqual({
        b: [],
        p: [
          {
            begin: 1100,
            end: 2900,
            id: "liner0w0",
            text: "hello world",
          },
        ],
      });
      expect(doc.translationTracks).toEqual({
        fr: { ...createdField, kind: "subtitle" },
      });
      expect(doc.pronunciationTracks).toEqual({
        "en-Latn": createdField,
      });

      const written = writeLyrics(doc, "ttml");
      const writtenAttribute =
        created === undefined ? "" : ` automaticallyCreated="${created}"`;
      expect(written).toContain(
        `<translation type="subtitle" xml:lang="fr"${writtenAttribute}>`
      );
      expect(written).toContain(
        `<transliteration xml:lang="en-Latn"${writtenAttribute}>`
      );
      expect(written.match(/automaticallyCreated=/gu)?.length ?? 0).toBe(
        created === undefined ? 0 : 2
      );
      expect(written.includes(`automaticallyCreated="${created}"`)).toBe(
        created !== undefined
      );
      expect(readLyrics(written, "ttml")).toEqual(doc);
    }
  );

  test.each([
    "<tt>",
    '<tt xmlns="urn:generic"><head/><body/></tt>',
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000"><span begin="1.000" end="2.000">Text</span></p></div>'
    ).replace(' itunes:timing="Word"', ""),
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000"><span begin="1.000" end="2.000">Text</span></p></div>',
      "",
      "Syllable"
    ),
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000"><span begin="1.000" end="2.000">Text</span></p></div>'
    ).replace("<head><metadata></metadata></head>", ""),
  ])("rejects malformed XML and unsupported profiles", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });

  test.each([
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000" ttm:agent="missing"><span begin="1.000" end="2.000">Text</span></p></div>'
    ),
  ])("rejects unresolved agent references", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });

  test("preserves syllable agent overrides and custom roles", () => {
    const source = makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000" ttm:agent="lead"><span begin="1.000" end="2.000" ttm:agent="guest" ttm:role="x-chorus">Text</span></p></div>',
      '<ttm:agent xml:id="lead" type="person"/><ttm:agent xml:id="guest" type="person"/>'
    );

    expect(read(source).lines[0]?.p[0]).toMatchObject({
      agent: "guest",
      role: "x-chorus",
    });
  });

  test("rejects backing-only lyric lines", () => {
    const source = makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000"><span ttm:role="x-bg"><span begin="1.100" end="1.800">(Echo)</span></span></p></div>'
    );

    expect(() => read(source)).toThrow(
      "ttml backing track requires primary text on line L1"
    );
  });

  test.each([
    makeTtml(
      '<div begin="1.000" end="3.000"><p begin="1.000" end="2.000" itunes:key="same"><span begin="1.000" end="2.000">One</span></p><p begin="2.000" end="3.000" itunes:key="same"><span begin="2.000" end="3.000">Two</span></p></div>'
    ),
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000"><span begin="1.000" end="2.000">Text</span></p></div>',
      '<ttm:agent xml:id="same" type="person"/><ttm:agent xml:id="same" type="group"/>'
    ),
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000"><span begin="1.000" end="1.500" ttm:role="x-bg">(One)</span><span begin="1.500" end="2.000" ttm:role="x-bg">(Two)</span></p></div>'
    ),
  ])("rejects duplicate keys, languages, and backing groups", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });

  test("preserves repeated pronunciation tracks for one language", () => {
    const source = makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000" itunes:key="line"><span begin="1.000" end="2.000">Text</span></p></div>',
      '<itunes:iTunesMetadata><itunes:transliterations><itunes:transliteration xml:lang="en" automaticallyCreated="true"><itunes:text for="line"><span begin="1.000" end="2.000">One</span></itunes:text></itunes:transliteration><itunes:transliteration xml:lang="en"><itunes:text for="line"><span begin="1.000" end="2.000">Two</span></itunes:text></itunes:transliteration></itunes:transliterations></itunes:iTunesMetadata>'
    );
    const doc = read(source);

    expect(doc.apple?.pronunciationOrder).toEqual([
      { language: "en", variant: 0 },
      { language: "en", variant: 1 },
    ]);
    expect(doc.pronunciationTracks?.en).toEqual({
      automaticallyCreated: true,
      variants: [{}],
    });
    expect(doc.lines[0]?.pronunciations?.en).toMatchObject({
      p: [{ text: "One" }],
      variants: [{ p: [{ text: "Two" }] }],
    });
    expect(read(write(doc))).toEqual(doc);
  });

  test("keeps sparse repeated pronunciation line associations", () => {
    const source = makeTtml(
      '<div begin="1.000" end="3.000"><p begin="1.000" end="2.000" itunes:key="one"><span begin="1.000" end="2.000">One</span></p><p begin="2.000" end="3.000" itunes:key="two"><span begin="2.000" end="3.000">Two</span></p></div>',
      '<itunes:iTunesMetadata><itunes:transliterations><itunes:transliteration xml:lang="en"><itunes:text for="one"><span begin="1.000" end="2.000">One</span></itunes:text></itunes:transliteration><itunes:transliteration xml:lang="en"><itunes:text for="two"><span begin="2.000" end="3.000">Two</span></itunes:text></itunes:transliteration></itunes:transliterations></itunes:iTunesMetadata>'
    );
    const doc = read(source);

    expect(doc.lines[1]?.pronunciations?.en).toMatchObject({
      absent: true,
      variants: [{ p: [{ text: "Two" }] }],
    });
    expect(read(write(doc))).toEqual(doc);
  });

  test("round-trips parallel line attributes", () => {
    const source = makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000" itunes:key="line"><span begin="1.000" end="2.000">Text</span></p></div>',
      '<ttm:agent xml:id="guest" type="person"/><itunes:iTunesMetadata><itunes:translations><itunes:translation type="subtitle" xml:lang="fr"><itunes:text for="line" begin="1.100" end="1.900" ttm:agent="guest" ttm:role="x-note" itunes:parenthesis="keep" xml:id="translated">Texte</itunes:text></itunes:translation></itunes:translations><itunes:transliterations><itunes:transliteration xml:lang="en"><itunes:text for="line" begin="1.100" end="1.900" ttm:agent="guest" ttm:role="x-note" itunes:parenthesis="keep" xml:id="pronounced"><span begin="1.100" end="1.900">Text</span></itunes:text></itunes:transliteration></itunes:transliterations></itunes:iTunesMetadata>'
    );
    const doc = read(source);

    expect(doc.lines[0]).toMatchObject({
      pronunciations: {
        en: {
          agent: "guest",
          begin: 1100,
          end: 1900,
          keepParentheses: true,
          role: "x-note",
          xmlId: "pronounced",
        },
      },
      translations: {
        fr: {
          agent: "guest",
          begin: 1100,
          end: 1900,
          keepParentheses: true,
          role: "x-note",
          xmlId: "translated",
        },
      },
    });
    expect(read(write(doc))).toEqual(doc);
  });

  test("reads plain Apple roles on containers", () => {
    const source = makeTtml(
      '<div begin="1.000" end="2.000" role="x-section"><p begin="1.000" end="2.000" itunes:key="line">Text</p></div>',
      "",
      "Line",
      'dur="2.000" role="x-body"'
    ).replace("<tt ", '<tt role="x-root" ');

    expect(read(source)).toMatchObject({
      apple: {
        body: { role: "x-body" },
        root: { role: "x-root" },
        sections: [{ role: "x-section" }],
      },
    });
  });

  test("preserves false Apple spatial audio", () => {
    const source = makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000">Text</p></div>',
      '<itunes:iTunesMetadata><itunes:audio spatial="false"/></itunes:iTunesMetadata>',
      "Line"
    );

    expect(read(source).apple).toMatchObject({
      audio: { spatial: false },
    });
  });

  test("round-trips nested timed translation words and backing text", () => {
    const source = makeTtml(
      '<div begin="1.000" end="4.000"><p begin="1.000" end="4.000" itunes:key="line"><span begin="1.000" end="4.000">Original</span></p></div>',
      '<ttm:agent xml:id="guest" type="person"/><itunes:iTunesMetadata><itunes:translations><itunes:translation type="subtitle" xml:lang="fr"><itunes:text for="line" begin="1.000" end="4.000" ttm:agent="guest" ttm:role="x-note" xml:id="translation">Avant <span begin="1.000" end="3.000">bon<span begin="2.000" end="3.000">jour</span> </span>après<span ttm:role="x-bg" itunes:parenthesis="keep"><span begin="1.500" end="3.500">(écho <span begin="2.000" end="3.000">ici</span>)</span></span></itunes:text></itunes:translation></itunes:translations></itunes:iTunesMetadata>'
    );
    const doc = read(source);
    const translation = doc.lines[0]?.translations?.fr;
    if (
      // biome-ignore lint/suspicious/noUnnecessaryConditions: validates parsed words
      translation === undefined ||
      translation.pWords === undefined ||
      translation.bWords === undefined
    ) {
      throw new Error("translation words did not parse");
    }

    expect(translation).toMatchObject({
      agent: "guest",
      b: "(écho ici)",
      bKeepParentheses: true,
      p: "Avant bonjour après",
      role: "x-note",
      xmlId: "translation",
    });
    expect(translation.pWords[0]).toMatchObject({
      content: ["Avant bon", { text: "jour" }, " après"],
      text: "Avant bonjour après",
    });
    expect(translation.bWords[0]).toMatchObject({
      content: ["(écho ", { text: "ici" }, ")"],
      text: "(écho ici)",
    });
    expect(read(write(doc))).toEqual(doc);
  });

  test("round-trips nested translation spans in line timing", () => {
    const source = makeTtml(
      '<div begin="1.000" end="4.000"><p begin="1.000" end="4.000" itunes:key="line">Original</p></div>',
      '<ttm:agent xml:id="guest" type="person"/><itunes:iTunesMetadata><itunes:translations><itunes:translation type="subtitle" xml:lang="fr"><itunes:text for="line"><span ttm:agent="guest">Avant <span begin="2.000" end="3.000" ttm:role="x-note">mot</span> après</span><span ttm:role="x-bg" itunes:parenthesis="keep"><span>(écho <span begin="2.000" end="3.000">ici</span>)</span></span></itunes:text></itunes:translation></itunes:translations></itunes:iTunesMetadata>',
      "Line"
    );
    const doc = read(source);
    const translation = doc.lines[0]?.translations?.fr;
    if (
      // biome-ignore lint/suspicious/noUnnecessaryConditions: validates parsed words
      translation === undefined ||
      translation.pWords === undefined ||
      translation.bWords === undefined
    ) {
      throw new Error("translation words did not parse");
    }

    expect(translation.pWords[0]).toMatchObject({
      agent: "guest",
      content: ["Avant ", { text: "mot", timed: true }, " après"],
    });
    expect(translation.bWords[0]).toMatchObject({
      content: ["(écho ", { text: "ici", timed: true }, ")"],
    });
    expect(read(write(doc))).toEqual(doc);
  });

  test("keeps the final same-language translation", () => {
    const source = makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000" itunes:key="line"><span begin="1.000" end="2.000">Text</span></p></div>',
      '<itunes:iTunesMetadata><itunes:translations><itunes:translation type="subtitle" xml:lang="en"><itunes:text for="line">One</itunes:text></itunes:translation><itunes:translation type="replacement" xml:lang="en"><itunes:text for="line">Two</itunes:text></itunes:translation></itunes:translations></itunes:iTunesMetadata>'
    );

    expect(read(source)).toMatchObject({
      lines: [{ translations: { en: { p: "Two" } } }],
      translationTracks: { en: { kind: "replacement" } },
    });
  });

  test.each([
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000" color="red"><span begin="1.000" end="2.000">Text</span></p></div>'
    ),
  ])("rejects unsupported roles and attributes", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });

  test.each([
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="2.000" end="1.000"><span begin="1.000" end="2.000">Text</span></p></div>'
    ),
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000"><span begin="0.500" end="1.500">Text</span></p></div>'
    ),
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000"><span begin="1.000" end="2.000">Text</span><span begin="0.500" end="1.500" ttm:role="x-bg">(Echo)</span></p></div>'
    ),
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000" itunes:key="line"><span begin="1.000" end="2.000">Text</span></p></div>',
      '<itunes:iTunesMetadata><itunes:transliterations><itunes:transliteration xml:lang="en-Latn"><itunes:text for="line"><span begin="0.500" end="1.500">Text</span></itunes:text></itunes:transliteration></itunes:transliterations></itunes:iTunesMetadata>'
    ),
    makeTtml(
      '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000"><span begin="1.000" end="3.000">Text</span></p></div>',
      "",
      "Word",
      'dur="2.000"'
    ),
  ])("rejects invalid source ranges", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });
});

describe("ttml whitespace", () => {
  const open = '<p begin="0.000" end="3.000" itunes:key="L1">';
  const group =
    '<span ttm:role="x-bg"><span begin="0.000" end="1.000">(oh)</span></span>';
  const timed = [
    '<span begin="1.000" end="2.000">You </span>',
    '<span begin="2.000" end="3.000">should</span>',
  ];
  const words = [
    { begin: 1000, end: 2000, id: "L1w0", text: "You " },
    { begin: 2000, end: 3000, id: "L1w1", text: "should" },
  ];

  function line(paragraph: string) {
    const doc = read(
      makeTtml(`<div begin="0.000" end="3.000">${paragraph}</div>`)
    );
    expect(read(write(doc))).toEqual(doc);
    return doc.lines[0];
  }

  test("a backing group after the words does not pad the primary track", () => {
    // the writer orders tracks by their start, so a trailing group must start last
    const late =
      '<span ttm:role="x-bg"><span begin="2.500" end="3.000">(oh)</span></span>';
    expect(line(`${open}${timed.join("")} ${late}</p>`)).toMatchObject({
      b: [{ text: "oh" }],
      p: words,
    });
  });

  test("a space the source wrote inside the last span is that syllable's own text", () => {
    const late =
      '<span ttm:role="x-bg"><span begin="2.500" end="3.000">(oh)</span></span>';
    expect(
      line(
        `${open}${timed[0]}<span begin="2.000" end="2.500">should </span>${late}</p>`
      )?.p
    ).toEqual([
      { begin: 1000, end: 2000, id: "L1w0", text: "You " },
      { begin: 2000, end: 2500, id: "L1w1", text: "should " },
    ]);
  });

  test("indentation and linefeeds collapse the way xml:space default requires", () => {
    const indent = "\n  ";
    expect(line(`${open}${indent}${timed.join(indent)}\n</p>`)?.p).toEqual(
      words
    );
  });

  test("a whitespace run spanning a tag boundary collapses to one space", () => {
    expect(
      line(
        `${open}<span begin="1.000" end="2.000">You \t\n</span>  ${timed[1]}</p>`
      )?.p
    ).toEqual(words);
  });

  test("a pretty-printed backing group still finds its wrapping parentheses", () => {
    const indent = "\n  ";
    expect(
      line(
        `${open}${indent}<span ttm:role="x-bg">\n    <span begin="0.000" end="1.000">(oh)</span></span>${indent}${timed.join(indent)}\n</p>`
      )
    ).toMatchObject({ b: [{ text: "oh" }], p: words });
  });

  test("a backing group is the only content of a whitespace-padded line", () => {
    expect(() =>
      read(
        makeTtml(`<div begin="0.000" end="3.000">${open} ${group} </p></div>`)
      )
    ).toThrow(ParseError);
  });
});
