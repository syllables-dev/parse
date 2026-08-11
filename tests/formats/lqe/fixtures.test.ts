import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { read, write } from "../../../src/formats/lqe";

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

async function readFixture(fileName: string) {
  return read(
    await openFile(
      new URL(`../../fixtures/lqe/${fileName}`, import.meta.url)
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
