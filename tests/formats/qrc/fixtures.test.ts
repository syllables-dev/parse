import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { read, write } from "@/formats/qrc";

const fixtureCases = [
  {
    fileName: "cjk-per-char.qrc",
    firstText: "爱上了 看见你",
    lineCount: 47,
    lyricIndex: 4,
    title:
      "岁月如歌 (《兄妹》粤语版|《冲上云霄》电影主题曲|《冲上云霄》电视剧主题曲)",
  },
  {
    fileName: "parens-in-text.qrc",
    firstText: "Tryna feel something real",
    lineCount: 61,
    lyricIndex: 4,
    title: "petal (Explicit)",
  },
];

async function readFixture(fileName: string) {
  return read(
    await openFile(
      new URL(`../../fixtures/qrc/${fileName}`, import.meta.url)
    ).text()
  );
}

describe("qrc fixtures", () => {
  test.each(fixtureCases)(
    "reads and round-trips $fileName",
    async ({ fileName, firstText, lineCount, lyricIndex, title }) => {
      const doc = await readFixture(fileName);

      expect(doc).toMatchObject({
        agents: [],
        timing: "word",
        version: 1,
      });
      expect(doc.meta.title).toBe(title);
      expect(doc.lines).toHaveLength(lineCount);
      expect(doc.lines[lyricIndex]?.p.map((word) => word.text).join("")).toBe(
        firstText
      );
      expect(read(write(doc))).toEqual(doc);
    }
  );

  test("keeps CJK characters as separate timed syllables", async () => {
    const doc = await readFixture("cjk-per-char.qrc");

    expect(doc.lines.slice(4, 5).flatMap((line) => line.p)).toEqual([
      { begin: 13_434, end: 13_643, id: "l4w0", text: "爱" },
      { begin: 13_643, end: 13_843, id: "l4w1", text: "上" },
      { begin: 13_843, end: 14_227, id: "l4w2", text: "了 " },
      { begin: 14_227, end: 14_595, id: "l4w3", text: "看" },
      { begin: 14_595, end: 14_819, id: "l4w4", text: "见" },
      { begin: 14_819, end: 15_059, id: "l4w5", text: "你" },
    ]);
  });

  test("keeps a real-duration space as its own syllable", async () => {
    const doc = await readFixture("cjk-per-char.qrc");

    expect(doc.lines[0]?.p[4]).toEqual({
      begin: 836,
      end: 1045,
      id: "l0w4",
      text: " ",
    });
  });

  test("keeps literal parentheses inside a lyric line", () => {
    const doc = read("[1000,1000]Sing (1000,500)(live)(1500,500)");

    expect(doc.lines[0]?.p).toEqual([
      { begin: 1000, end: 1500, id: "l0w0", text: "Sing " },
      { begin: 1500, end: 2000, id: "l0w1", text: "(live)" },
    ]);
    expect(doc.lines[0]?.b).toEqual([]);
  });
});
