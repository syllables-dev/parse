import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import {
  createDocument,
  type LyricsDocument,
  type LyricsLine,
  ParseError,
  read as readLyrics,
  write as writeLyrics,
} from "../../src";
import { read, write } from "../../src/formats/ttml";

const ttmlUri = "http://www.w3.org/ns/ttml";
const ttmUri = "http://www.w3.org/ns/ttml#metadata";
const itunesUri = "http://music.apple.com/lyric-ttml-internal";

const fixtureCases = [
  {
    agents: [{ id: "v1", type: "person" }],
    fileName: "backing-vocals.ttml",
    firstLine: {
      agent: "v1",
      begin: 9023,
      end: 10_802,
      id: "L1",
      text: "Thought I'd end up with Sean",
      word: { begin: 9023, end: 9192, id: "L1w0", text: "Thought " },
    },
    lineCount: 87,
    meta: {
      songwriters: [
        "Ariana Grande",
        "Charles Anderson",
        "Kimberly Krysiuk",
        "Michael Foster",
        "Njomza Vitia",
        "Tayla Parx",
        "Tommy Brown",
        "Victoria Monét",
      ],
    },
    pronunciationLanguages: [],
    timing: "word",
    translationLanguages: [],
  },
  {
    agents: [{ id: "v1", type: "person" }],
    fileName: "instrumental-gap.ttml",
    firstLine: {
      agent: "v1",
      begin: 149,
      end: 3055,
      id: "L1",
      text: "Is this the real life?",
      word: { begin: 149, end: 607, id: "L1w0", text: "Is " },
    },
    lineCount: 73,
    meta: { songwriters: ["Freddie Mercury"] },
    pronunciationLanguages: [],
    timing: "word",
    translationLanguages: [],
  },
  {
    agents: [{ id: "v1", type: "person" }],
    fileName: "line-timed.ttml",
    firstLine: {
      agent: "v1",
      begin: 15_923,
      end: 17_110,
      id: "L1",
      text: "There's no doubt",
      word: {
        begin: 15_923,
        end: 17_110,
        id: "L1w0",
        text: "There's no doubt",
      },
    },
    lineCount: 43,
    meta: { songwriters: ["Porter Robinson"] },
    pronunciationLanguages: [],
    timing: "line",
    translationLanguages: [],
  },
  {
    agents: [
      { id: "v1", type: "person" },
      { id: "v2000", type: "other" },
    ],
    fileName: "pronunciation.ttml",
    firstLine: {
      agent: "v1",
      begin: 649,
      end: 3257,
      id: "L1",
      text: "無敵の笑顔で荒らすメディア",
      word: { begin: 649, end: 1456, id: "L1w0", text: "無敵の" },
    },
    lineCount: 74,
    meta: { songwriters: ["Ayase"] },
    pronunciationLanguages: ["ja-Latn"],
    timing: "word",
    translationLanguages: ["en-US"],
  },
  {
    agents: [
      { id: "v1", type: "person" },
      { id: "v2000", type: "other" },
    ],
    fileName: "translation.ttml",
    firstLine: {
      agent: "v1",
      begin: 649,
      end: 3257,
      id: "L1",
      text: "無敵の笑顔で荒らすメディア",
      word: { begin: 649, end: 1456, id: "L1w0", text: "無敵の" },
    },
    lineCount: 74,
    meta: { songwriters: ["Ayase"] },
    pronunciationLanguages: ["ja-Latn"],
    timing: "word",
    translationLanguages: ["en-US"],
  },
  {
    agents: [
      { id: "v1", type: "person" },
      { id: "v2", type: "person" },
      { id: "v1000", type: "group" },
    ],
    fileName: "word-timed-duet.ttml",
    firstLine: {
      agent: "v2",
      begin: 3432,
      end: 6045,
      id: "L1",
      text: "Ooh, ooh",
      word: { begin: 3432, end: 4763, id: "L1w0", text: "Ooh, " },
    },
    lineCount: 50,
    meta: {
      songwriters: [
        "Andrew Watt",
        "Bruno Mars",
        "Dernst Mile",
        "James Fauntleroy",
        "Lady Gaga",
      ],
    },
    pronunciationLanguages: [],
    timing: "word",
    translationLanguages: [],
  },
];

const lyricLine = {
  agent: "lead",
  b: [],
  begin: 1000,
  end: 3000,
  id: "line",
  p: [
    { begin: 1000, end: 2000, id: "linew0", text: "Hel " },
    { begin: 2000, end: 3000, id: "linew1", text: "lo" },
  ],
} satisfies LyricsLine;

const wordDocument = {
  agents: [{ id: "lead", type: "person" }],
  lines: [lyricLine],
  meta: {},
  timing: "word",
  version: 1,
} satisfies LyricsDocument;

async function readFixture(fileName: string) {
  return read(
    await openFile(
      new URL(`../fixtures/ttml/${fileName}`, import.meta.url)
    ).text()
  );
}

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

describe("ttml fixtures", () => {
  test.each(fixtureCases)(
    "reads and round-trips $fileName",
    async ({
      agents,
      fileName,
      firstLine,
      lineCount,
      meta,
      pronunciationLanguages,
      timing,
      translationLanguages,
    }) => {
      const doc = await readFixture(fileName);
      const [first] = doc.lines;

      expect(doc).toMatchObject({ agents, meta, timing, version: 1 });
      expect(doc.lines).toHaveLength(lineCount);
      expect(first).toMatchObject({
        agent: firstLine.agent,
        begin: firstLine.begin,
        end: firstLine.end,
        id: firstLine.id,
      });
      expect(
        doc.lines.slice(0, 1).flatMap((line) => line.p.slice(0, 1))
      ).toEqual([firstLine.word]);
      expect(
        doc.lines
          .slice(0, 1)
          .map((line) => line.p.map((syllable) => syllable.text).join(""))
      ).toEqual([firstLine.text]);
      expect([
        ...new Set(
          doc.lines.flatMap((line) => Object.keys(line.translations ?? {}))
        ),
      ]).toEqual(translationLanguages);
      expect([
        ...new Set(
          doc.lines.flatMap((line) => Object.keys(line.pronunciations ?? {}))
        ),
      ]).toEqual(pronunciationLanguages);
      expect(read(write(doc))).toEqual(doc);
    }
  );

  test("covers the complete fixture line and backing inventory", async () => {
    const docs = await Promise.all(
      fixtureCases.map(({ fileName }) => readFixture(fileName))
    );

    expect(docs.reduce((sum, doc) => sum + doc.lines.length, 0)).toBe(401);
    expect(
      docs.reduce(
        (sum, doc) =>
          sum + doc.lines.filter((line) => line.b.length > 0).length,
        0
      )
    ).toBe(34);
  });

  test("preserves fixture whitespace and removes backing wrappers", async () => {
    const doc = await readFixture("backing-vocals.ttml");

    expect(doc.lines[17]?.p).toEqual([
      { begin: 46_341, end: 46_741, id: "L18w0", text: "Thank " },
      { begin: 46_741, end: 47_291, id: "L18w1", text: "u, " },
      { begin: 47_474, end: 47_952, id: "L18w2", text: "next " },
    ]);
    expect(doc.lines[17]?.b).toEqual([
      { begin: 48_007, end: 48_508, id: "L18b0", text: "Next" },
    ]);
  });

  test("keeps overlapping lines and instrumental gaps", async () => {
    const doc = await readFixture("instrumental-gap.ttml");

    expect(doc.lines[52]).toMatchObject({ begin: 227_776, end: 232_264 });
    expect(doc.lines[53]).toMatchObject({ begin: 231_231, end: 233_960 });
    expect(doc.lines[34]?.end).toBe(157_209);
    expect(doc.lines[35]?.begin).toBe(185_957);
  });

  test("keeps every fixture translation and pronunciation line", async () => {
    const docs = await Promise.all(
      ["pronunciation.ttml", "translation.ttml"].map(readFixture)
    );
    for (const doc of docs) {
      expect(
        doc.lines.filter((line) => line.translations?.["en-US"])
      ).toHaveLength(74);
      expect(
        doc.lines.filter((line) => line.pronunciations?.["ja-Latn"])
      ).toHaveLength(74);
    }
  });
});

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

    expect(read(source).lines[0]).toEqual({
      agent: null,
      b: [],
      begin: 62_003,
      end: 754_567,
      id: "nested",
      p: [
        { begin: 62_003, end: 62_100, id: "nestedw0", text: "loose A" },
        { begin: 62_100, end: 754_567, id: "nestedw1", text: "B tail" },
      ],
    });
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

      const written = writeLyrics(doc, "ttml");
      expect(written).toContain(`begin="${writtenBegin}"`);
      expect(written.includes("lyricOffset")).toBe(false);
      expect(readLyrics(written, "ttml")).toEqual(doc);
    }
  );

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
      "fr-CA": { b: "Écho ", kind: "subtitle", p: "Salut " },
      "yue-Hant-HK": { kind: "replacement", p: "你好" },
    });
    expect(writeLyrics(doc, "ttml")).toContain(
      '<translation type="replacement" xml:lang="yue-Hant-HK">'
    );
    expect(readLyrics(writeLyrics(doc, "ttml"), "ttml")).toEqual(doc);
  });

  test("rejects inconsistent source translation kinds", () => {
    const apple = [
      "<itunes:iTunesMetadata><itunes:translations>",
      '<itunes:translation type="subtitle" xml:lang="fr"><itunes:text for="first">Un</itunes:text></itunes:translation>',
      '<itunes:translation type="replacement" xml:lang="fr"><itunes:text for="second">Deux</itunes:text></itunes:translation>',
      "</itunes:translations></itunes:iTunesMetadata>",
    ].join("");
    const source = makeTtml(
      '<div begin="1.000" end="3.000"><p begin="1.000" end="2.000" itunes:key="first"><span begin="1.000" end="2.000">One</span></p><p begin="2.000" end="3.000" itunes:key="second"><span begin="2.000" end="3.000">Two</span></p></div>',
      apple
    );

    expect(() => readLyrics(source, "ttml")).toThrow(
      "ttml fr translation kind must be consistent across lines"
    );
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
        ...createdField,
        kind: "subtitle",
        p: "Bonjour le monde",
      });
      expect(doc.lines[0]?.pronunciations?.["en-Latn"]).toEqual({
        ...createdField,
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
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000" ttm:agent="lead"><span begin="1.000" end="2.000" ttm:agent="guest">Text</span></p></div>',
      '<ttm:agent xml:id="lead" type="person"/><ttm:agent xml:id="guest" type="person"/>'
    ),
  ])("rejects unresolved and syllable-level agent changes", (source) => {
    expect(() => read(source)).toThrow(ParseError);
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
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000" itunes:key="line"><span begin="1.000" end="2.000">Text</span></p></div>',
      '<itunes:iTunesMetadata><itunes:translations><itunes:translation type="subtitle" xml:lang="en"><itunes:text for="line">One</itunes:text></itunes:translation><itunes:translation type="subtitle" xml:lang="en"><itunes:text for="line">Two</itunes:text></itunes:translation></itunes:translations></itunes:iTunesMetadata>'
    ),
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000" itunes:key="line"><span begin="1.000" end="2.000">Text</span></p></div>',
      '<itunes:iTunesMetadata><itunes:transliterations><itunes:transliteration xml:lang="en"><itunes:text for="line"><span begin="1.000" end="2.000">One</span></itunes:text></itunes:transliteration><itunes:transliteration xml:lang="en"><itunes:text for="line"><span begin="1.000" end="2.000">Two</span></itunes:text></itunes:transliteration></itunes:transliterations></itunes:iTunesMetadata>'
    ),
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000"><span begin="1.000" end="1.500" ttm:role="x-bg">(One)</span><span begin="1.500" end="2.000" ttm:role="x-bg">(Two)</span></p></div>'
    ),
  ])("rejects duplicate keys, languages, and backing groups", (source) => {
    expect(() => read(source)).toThrow(ParseError);
  });

  test.each([
    makeTtml(
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000"><span begin="1.000" end="2.000" ttm:role="x-chorus">Text</span></p></div>'
    ),
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
      '<div begin="1.000" end="2.000"><p begin="1.000" end="2.000"><span begin="1.500" end="1.500">Text</span></p></div>'
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

describe("ttml writer", () => {
  test("round-trips an empty document", () => {
    const doc = createDocument();

    expect(read(write(doc))).toEqual(doc);
  });

  test("escapes opaque ids and round-trips every representable field", () => {
    const lineId = "line&\"'<tag>";
    const agentId = "voice&\"'<tag>";
    const doc = {
      agents: [{ id: agentId, type: "character & guest" }],
      lines: [
        {
          agent: agentId,
          b: [
            {
              begin: 63_200,
              end: 64_000,
              id: `${lineId}b0`,
              text: "Echo & ",
            },
          ],
          begin: 62_003,
          end: 65_009,
          id: lineId,
          p: [
            {
              begin: 62_003,
              end: 63_004,
              id: `${lineId}w0`,
              text: "A & < > \" ' ",
            },
          ],
          pronunciations: {
            "ja-Latn": {
              b: [
                {
                  begin: 63_250,
                  end: 63_900,
                  id: `${lineId}r0b0`,
                  text: "ekō",
                },
              ],
              p: [
                {
                  begin: 62_050,
                  end: 63_000,
                  id: `${lineId}r0w0`,
                  text: "ē ",
                },
              ],
            },
          },
          translations: {
            "fr-CA": {
              b: "Écho &",
              kind: "subtitle",
              p: "Une <ligne>",
            },
          },
        },
      ],
      meta: { songwriters: ["Writer & Partner"] },
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;

    const source = write(doc);

    expect(source).toContain('xml:id="voice&amp;&quot;&apos;&lt;tag&gt;"');
    expect(source).toContain('itunes:key="line&amp;&quot;&apos;&lt;tag&gt;"');
    expect(source).toContain("A &amp; &lt; &gt; \" ' ");
    expect(read(source)).toEqual(doc);
  });

  test("writes adjusted times directly without audio offset metadata", () => {
    const source = writeLyrics(
      { ...wordDocument, meta: { offset: 1250 } },
      "ttml"
    );

    expect(source).toContain('<p begin="0:01.000" end="0:03.000"');
    expect(source.includes("lyricOffset")).toBe(false);
    expect(readLyrics(source, "ttml")).toEqual(wordDocument);
  });

  test.each([
    { backingBegin: 1100, primaryBegin: 1200, state: "earlier" },
    { backingBegin: 1200, primaryBegin: 1200, state: "equal" },
    { backingBegin: 1300, primaryBegin: 1200, state: "later" },
  ])(
    "writes $state x-bg tracks in chronological order across timed content",
    ({ backingBegin, primaryBegin }) => {
      const doc = {
        agents: [],
        lines: [
          {
            agent: null,
            b: [
              {
                begin: backingBegin,
                end: 1500,
                id: "lineb0",
                text: "Echo",
              },
            ],
            begin: 1000,
            end: 2000,
            id: "line",
            p: [
              {
                begin: primaryBegin,
                end: 1800,
                id: "linew0",
                text: "Lead",
              },
            ],
            pronunciations: {
              "en-Latn": {
                b: [
                  {
                    begin: backingBegin,
                    end: 1500,
                    id: "liner0b0",
                    text: "echo",
                  },
                ],
                p: [
                  {
                    begin: primaryBegin,
                    end: 1800,
                    id: "liner0w0",
                    text: "lead",
                  },
                ],
              },
            },
          },
        ],
        meta: {},
        timing: "word",
        version: 1,
      } satisfies LyricsDocument;
      const source = writeLyrics(doc, "ttml");
      const body = source.slice(
        source.indexOf('<p begin="0:01.000"'),
        source.indexOf("</p>")
      );
      const pronunciation = source.slice(
        source.indexOf('<transliteration xml:lang="en-Latn">'),
        source.indexOf("</transliteration>")
      );
      const backingFirst = backingBegin < primaryBegin;

      expect(
        body.indexOf('ttm:role="x-bg"') < body.indexOf(">Lead</span>")
      ).toBe(backingFirst);
      expect(
        pronunciation.indexOf('ttm:role="x-bg"') <
          pronunciation.indexOf(">lead</span>")
      ).toBe(backingFirst);
      expect(readLyrics(source, "ttml")).toEqual(doc);
    }
  );

  test("round-trips backing-only timed lines", () => {
    const doc = {
      agents: [],
      lines: [
        {
          agent: null,
          b: [{ begin: 1100, end: 1800, id: "lineb0", text: "Echo" }],
          begin: 1000,
          end: 2000,
          id: "line",
          p: [],
          pronunciations: {
            "en-Latn": {
              b: [{ begin: 1100, end: 1800, id: "liner0b0", text: "echo" }],
              p: [],
            },
          },
        },
      ],
      meta: {},
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;

    const source = writeLyrics(doc, "ttml");

    expect(source).toContain(
      '<p begin="0:01.000" end="0:02.000" itunes:key="line"><span ttm:role="x-bg"><span begin="0:01.100" end="0:01.800">(Echo)</span></span></p>'
    );
    expect(readLyrics(source, "ttml")).toEqual(doc);
  });

  test("rejects inconsistent automaticallyCreated track states", () => {
    const laterLine = {
      ...lyricLine,
      begin: 4000,
      end: 6000,
      id: "later",
      p: [{ begin: 4000, end: 6000, id: "laterw0", text: "Again" }],
    } satisfies LyricsLine;

    expect(() =>
      writeLyrics(
        {
          ...wordDocument,
          lines: [
            {
              ...lyricLine,
              translations: {
                fr: { automaticallyCreated: true, p: "Bonjour" },
              },
            },
            {
              ...laterLine,
              translations: {
                fr: { automaticallyCreated: false, p: "Encore" },
              },
            },
          ],
        },
        "ttml"
      )
    ).toThrow("inconsistent automaticallyCreated values");
    expect(() =>
      writeLyrics(
        {
          ...wordDocument,
          lines: [
            {
              ...lyricLine,
              pronunciations: {
                "en-Latn": {
                  automaticallyCreated: false,
                  b: [],
                  p: lyricLine.p,
                },
              },
            },
            {
              ...laterLine,
              pronunciations: {
                "en-Latn": { b: [], p: laterLine.p },
              },
            },
          ],
        },
        "ttml"
      )
    ).toThrow("inconsistent automaticallyCreated values");
  });

  test("rejects inconsistent translation kinds across one language", () => {
    const laterLine = {
      ...lyricLine,
      begin: 4000,
      end: 6000,
      id: "later",
      p: [{ begin: 4000, end: 6000, id: "laterw0", text: "Again" }],
    } satisfies LyricsLine;
    const doc = {
      ...wordDocument,
      lines: [
        {
          ...lyricLine,
          translations: { fr: { kind: "subtitle", p: "Bonjour" } },
        },
        {
          ...laterLine,
          translations: { fr: { kind: "replacement", p: "Encore" } },
        },
      ],
    } satisfies LyricsDocument;
    const before = structuredClone(doc);

    expect(() => writeLyrics(doc, "ttml")).toThrow(
      "ttml fr translation kind must be consistent across lines"
    );
    expect(doc).toEqual(before);
  });

  test("defaults an omitted translation kind to subtitle", () => {
    const doc = {
      ...wordDocument,
      lines: [
        {
          ...lyricLine,
          translations: { fr: { p: "Bonjour" } },
        },
      ],
    } satisfies LyricsDocument;

    expect(writeLyrics(doc, "ttml")).toContain(
      '<translation type="subtitle" xml:lang="fr">'
    );
  });

  test("preserves padded songwriter text", () => {
    const doc = {
      ...wordDocument,
      meta: { songwriters: ["  Writer  "] },
    } satisfies LyricsDocument;

    expect(readLyrics(writeLyrics(doc, "ttml"), "ttml")).toEqual(doc);
  });

  test("rejects metadata fields outside the Apple lyric profile", () => {
    expect(() =>
      write({
        ...wordDocument,
        meta: { album: "Album", artist: "Artist", title: "Title" },
      })
    ).toThrow("ttml cannot represent title, artist, or album metadata");
    expect(() => write({ ...wordDocument, meta: { songwriters: [] } })).toThrow(
      "ttml cannot preserve an empty songwriter list"
    );
  });

  test("rejects unrepresentable maps, agents, and line timing", () => {
    expect(() =>
      write({
        ...wordDocument,
        lines: [{ ...lyricLine, translations: {} }],
      })
    ).toThrow("ttml cannot preserve an empty translation map");
    expect(() =>
      write({
        ...wordDocument,
        lines: [{ ...lyricLine, pronunciations: {} }],
      })
    ).toThrow("ttml cannot preserve an empty pronunciation map");
    expect(() =>
      write({
        ...wordDocument,
        lines: [{ ...lyricLine, agent: "missing" }],
      })
    ).toThrow("references an undeclared ttml agent");
    expect(() => write({ ...wordDocument, timing: "line" })).toThrow(
      "ttml line timing cannot preserve"
    );
  });

  test("rejects invalid document ranges", () => {
    expect(() =>
      write({
        ...wordDocument,
        lines: [
          {
            ...lyricLine,
            p: [{ begin: 500, end: 1500, id: "outside", text: "Text" }],
          },
        ],
      })
    ).toThrow();
    expect(() =>
      write({
        ...wordDocument,
        lines: [
          {
            ...lyricLine,
            p: [{ begin: 1500, end: 1500, id: "empty", text: "Text" }],
          },
        ],
      })
    ).toThrow();
  });
});
