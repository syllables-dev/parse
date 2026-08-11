import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { read, write } from "../../../src/formats/lrc";

const fixtureCases = [
  {
    end: 248_777,
    fileName: "header-by-tag.lrc",
    firstText: "吻下去",
    lineCount: 51,
  },
  {
    end: 184_450,
    fileName: "plain-cjk.lrc",
    firstText: "若这一束吊灯倾泻下来",
    lineCount: 31,
  },
];

async function readFixture(fileName: string) {
  return read(
    await openFile(
      new URL(`../../fixtures/lrc/${fileName}`, import.meta.url)
    ).text()
  );
}

describe("lrc fixtures", () => {
  test.each(fixtureCases)(
    "reads and round-trips $fileName",
    async ({ end, fileName, firstText, lineCount }) => {
      const doc = await readFixture(fileName);

      expect(doc).toMatchObject({
        agents: [],
        meta: {},
        timing: "line",
        version: 1,
      });
      expect(doc.lines).toHaveLength(lineCount);
      expect(doc.lines[0]?.p[0]?.text).toBe(firstText);
      expect(doc.lines.at(-1)?.end).toBe(end);
      expect(read(write(doc))).toEqual(doc);
    }
  );
});
