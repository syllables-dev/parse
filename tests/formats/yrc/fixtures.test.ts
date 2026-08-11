import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { read, write } from "../../../src/formats/yrc";

const fixtureCases = [
  {
    fileName: "json-preamble.yrc",
    lineCount: 45,
    lyricIndex: 0,
    lyricText: "初めてのルーブルは",
    songwriters: ["宇多田ヒカル"],
  },
  {
    fileName: "word-timed-credits.yrc",
    lineCount: 61,
    lyricIndex: 2,
    lyricText: "Do you ever feel like a plastic bag",
    songwriters: undefined,
  },
];

async function readFixture(fileName: string) {
  return read(
    await openFile(
      new URL(`../../fixtures/yrc/${fileName}`, import.meta.url)
    ).text()
  );
}

describe("yrc fixtures", () => {
  test.each(fixtureCases)(
    "reads and round-trips $fileName",
    async ({ fileName, lineCount, lyricIndex, lyricText, songwriters }) => {
      const doc = await readFixture(fileName);

      expect(doc).toMatchObject({
        agents: [],
        timing: "word",
        version: 1,
      });
      expect(doc.meta.songwriters).toEqual(songwriters);
      expect(doc.lines).toHaveLength(lineCount);
      expect(doc.lines[lyricIndex]?.p.map((word) => word.text).join("")).toBe(
        lyricText
      );
      expect(read(write(doc))).toEqual(doc);
    }
  );
});
