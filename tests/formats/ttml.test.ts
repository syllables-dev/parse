import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import {
  createDocument,
  type LyricsDocument,
  type LyricsLine,
  ParseError,
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
      begin: 7421,
      end: 9200,
      id: "L1",
      text: "Thought I'd end up with Sean",
      word: { begin: 7421, end: 7590, id: "L1w0", text: "Thought " },
    },
    lineCount: 87,
    meta: {
      offset: 801,
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
      begin: -149,
      end: 2757,
      id: "L1",
      text: "Is this the real life?",
      word: { begin: -149, end: 309, id: "L1w0", text: "Is " },
    },
    lineCount: 73,
    meta: { offset: 149, songwriters: ["Freddie Mercury"] },
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
      { begin: 44_739, end: 45_139, id: "L18w0", text: "Thank " },
      { begin: 45_139, end: 45_689, id: "L18w1", text: "u, " },
      { begin: 45_872, end: 46_350, id: "L18w2", text: "next " },
    ]);
    expect(doc.lines[17]?.b).toEqual([
      { begin: 46_405, end: 46_906, id: "L18b0", text: "Next" },
    ]);
  });

  test("keeps overlapping lines and instrumental gaps", async () => {
    const doc = await readFixture("instrumental-gap.ttml");

    expect(doc.lines[52]).toMatchObject({ begin: 227_478, end: 231_966 });
    expect(doc.lines[53]).toMatchObject({ begin: 230_933, end: 233_662 });
    expect(doc.lines[34]?.end).toBe(156_911);
    expect(doc.lines[35]?.begin).toBe(185_659);
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
    { begin: -250, end: 1750, offset: 1250, sourceOffset: "+1.250" },
    { begin: 2250, end: 4250, offset: -1250, sourceOffset: "-1.250" },
  ])(
    "applies $sourceOffset lyric offsets exactly",
    ({ begin, end, offset, sourceOffset }) => {
      const apple = `<itunes:iTunesMetadata><itunes:audio lyricOffset="${sourceOffset}"/></itunes:iTunesMetadata>`;
      const source = makeTtml(
        '<div begin="1.000" end="3.000"><p begin="1.000" end="3.000" itunes:key="offset"><span begin="1.000" end="3.000">Time</span></p></div>',
        apple
      );
      const doc = read(source);

      expect(doc.meta.offset).toBe(offset);
      expect(doc.lines[0]).toMatchObject({ begin, end });
      expect(doc.lines[0]?.p[0]).toMatchObject({ begin, end });
    }
  );

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

  test("reads primary and backing translations in every language", () => {
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

    expect(read(source).lines[0]?.translations).toEqual({
      "fr-CA": { b: "Écho ", p: "Salut " },
      "yue-Hant-HK": { p: "你好" },
    });
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
          translations: { "fr-CA": { b: "Écho &", p: "Une <ligne>" } },
        },
      ],
      meta: { offset: 1250, songwriters: ["Writer & Partner"] },
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;

    const source = write(doc);

    expect(source).toContain('xml:id="voice&amp;&quot;&apos;&lt;tag&gt;"');
    expect(source).toContain('itunes:key="line&amp;&quot;&apos;&lt;tag&gt;"');
    expect(source).toContain("A &amp; &lt; &gt; \" ' ");
    expect(read(source)).toEqual(doc);
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
