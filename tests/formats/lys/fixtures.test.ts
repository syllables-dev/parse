import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { read, write } from "@/formats/lys";

const fixtureCases = [
  {
    agents: [
      { id: "v1", type: "person" },
      { id: "v2", type: "person" },
    ],
    fileName: "duet-values.lys",
    firstText: "Through the rose-colored lenses",
    lineCount: 50,
  },
  {
    agents: [{ id: "v1", type: "person" }],
    fileName: "primary-background.lys",
    firstText: "Tryna feel something real",
    lineCount: 57,
  },
];

async function readFixture(fileName: string) {
  return read(
    await openFile(
      new URL(`../../fixtures/lys/${fileName}`, import.meta.url)
    ).text()
  );
}

describe("lys fixtures", () => {
  test.each(fixtureCases)(
    "reads and round-trips $fileName",
    async ({ agents, fileName, firstText, lineCount }) => {
      const doc = await readFixture(fileName);

      expect(doc).toMatchObject({ meta: {}, timing: "word", version: 1 });
      expect(doc.agents).toEqual(agents);
      expect(doc.lines).toHaveLength(lineCount);
      expect(
        doc.lines
          .slice(0, 1)
          .map((line) => line.p.map((word) => word.text).join(""))
      ).toEqual([firstText]);
      expect(read(write(doc))).toEqual(doc);
    }
  );

  test("merges the fixture's explicit backing rows", async () => {
    const doc = await readFixture("primary-background.lys");

    expect(doc.lines[20]).toMatchObject({
      agent: "v1",
      begin: 71_459,
      end: 72_967,
      id: "l20",
    });
    expect(
      doc.lines
        .slice(20, 21)
        .map((line) => line.p.map((word) => word.text).join(""))
    ).toEqual(["They say "]);
    expect(
      doc.lines
        .slice(20, 21)
        .map((line) => line.b.map((word) => word.text).join(""))
    ).toEqual(["Ooh-ooh, ooh"]);
  });
});
