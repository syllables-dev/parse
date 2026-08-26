import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { read, write } from "@/formats/ttml";

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

async function readFixture(fileName: string) {
  return read(
    await openFile(
      new URL(`../../fixtures/ttml/${fileName}`, import.meta.url)
    ).text()
  );
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

    // the spaces the source wrote inside each span stay, the one separating the line from the
    // backing group that follows it belongs to neither track
    expect(doc.lines[17]?.p).toEqual([
      { begin: 46_341, end: 46_741, id: "L18w0", text: "Thank " },
      { begin: 46_741, end: 47_291, id: "L18w1", text: "u, " },
      { begin: 47_474, end: 47_952, id: "L18w2", text: "next" },
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
