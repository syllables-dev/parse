import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { read, write } from "@/formats/eslrc";

describe("eslrc fixture", () => {
  test("reads concrete trailing stamps and round-trips them", async () => {
    const doc = read(
      await openFile(
        new URL(
          "../../fixtures/eslrc/cjk-trailing-stamp.eslrc",
          import.meta.url
        )
      ).text()
    );

    expect(doc).toMatchObject({
      agents: [],
      meta: {},
      timing: "word",
      version: 1,
    });
    expect(doc.lines).toHaveLength(51);
    expect(doc.lines[0]).toMatchObject({ begin: 28_331, end: 29_969 });
    expect(doc.lines[0]?.p).toEqual([
      { begin: 28_331, end: 28_840, id: "l0w0", text: "吻" },
      { begin: 28_840, end: 29_374, id: "l0w1", text: "下" },
      { begin: 29_374, end: 29_969, id: "l0w2", text: "去" },
    ]);
    expect(doc.lines.at(-1)?.end).toBe(251_551);
    expect(read(write(doc))).toEqual(doc);
  });
});
