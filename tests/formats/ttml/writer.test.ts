import { describe, expect, test } from "bun:test";
import {
  createDocument,
  type LyricsDocument,
  type LyricsLine,
  read as readLyrics,
  write as writeLyrics,
} from "../../../src";
import { read, write } from "../../../src/formats/ttml";

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

describe("ttml writer", () => {
  test("round-trips an empty document", () => {
    const doc = createDocument();

    expect(read(write(doc))).toEqual(doc);
  });

  test("silently drops a line with no primary and no backing syllables", () => {
    const doc = {
      agents: [],
      lines: [
        {
          agent: null,
          b: [],
          begin: 1000,
          end: 2000,
          id: "l0",
          p: [{ begin: 1000, end: 2000, id: "l0w0", text: "Lead" }],
        },
        { agent: null, b: [], begin: 2000, end: 3000, id: "l1", p: [] },
        {
          agent: null,
          b: [],
          begin: 3000,
          end: 4000,
          id: "l2",
          p: [{ begin: 3000, end: 4000, id: "l2w0", text: "Last" }],
        },
      ],
      meta: {},
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;
    const before = structuredClone(doc);

    expect(read(write(doc)).lines).toMatchObject([
      { id: "l0", p: [{ text: "Lead" }] },
      { id: "l2", p: [{ text: "Last" }] },
    ]);
    expect(doc).toEqual(before);
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
              p: "Une <ligne>",
            },
          },
        },
      ],
      meta: { songwriters: ["Writer & Partner"] },
      pronunciationTracks: { "ja-Latn": {} },
      timing: "word",
      translationTracks: { "fr-CA": { kind: "subtitle" } },
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
        pronunciationTracks: { "en-Latn": {} },
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

  test("rejects backing-only timed lines", () => {
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

    expect(() => writeLyrics(doc, "ttml")).toThrow(
      "ttml backing track requires primary text on line line"
    );
  });

  test("writes track states once per language", () => {
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
          translations: { fr: { p: "Bonjour" } },
        },
        {
          ...laterLine,
          translations: { fr: { p: "Encore" } },
        },
      ],
      translationTracks: { fr: { automaticallyCreated: true } },
    } satisfies LyricsDocument;

    expect(
      writeLyrics(doc, "ttml").match(/automaticallyCreated=/gu)
    ).toHaveLength(1);
  });

  test("stores one translation kind for each language", () => {
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
          translations: { fr: { p: "Bonjour" } },
        },
        {
          ...laterLine,
          translations: { fr: { p: "Encore" } },
        },
      ],
      translationTracks: { fr: { kind: "replacement" } },
    } satisfies LyricsDocument;

    expect(writeLyrics(doc, "ttml")).toContain(
      '<translation type="replacement" xml:lang="fr">'
    );
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

  test("round-trips Apple metadata, sections, and agent details", () => {
    const doc = {
      agents: [
        { artistId: "11", id: "lead", name: "Lead", type: "person" },
        { artistId: "22", id: "guest", name: "Guest", type: "person" },
      ],
      apple: {
        audio: { role: "spatial", spatial: true },
        body: { duration: 7000 },
        language: "ja",
        leadingSilence: 500,
        lyricGenerationId: "gen-7",
        root: { agent: "lead", role: "x-song", xmlId: "root" },
        sections: [
          {
            begin: 1000,
            end: 5000,
            lines: ["line"],
            part: "chorus",
            xmlId: "section",
          },
        ],
      },
      lines: [
        {
          agent: "lead",
          b: [],
          begin: 1000,
          end: 5000,
          id: "line",
          p: [
            { begin: 1000, end: 3000, id: "linew0", text: "He " },
            {
              agent: "guest",
              begin: 3000,
              end: 5000,
              id: "linew1",
              role: "x-chorus",
              text: "llo",
              xmlId: "word",
            },
          ],
          role: "x-verse",
          xmlId: "paragraph",
        },
      ],
      meta: {
        songwriterIds: ["33"],
        songwriters: ["Writer"],
      },
      timing: "word",
      version: 1,
    } satisfies LyricsDocument;

    const source = write(doc);

    expect(source).toContain('itunes:lyricGenId="gen-7"');
    expect(source).toContain('<audio role="spatial" spatial="true"/>');
    expect(source).toContain('artistId="33"');
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
            p: [{ begin: 1500, end: 1400, id: "reversed", text: "Text" }],
          },
        ],
      })
    ).toThrow();
  });
});
