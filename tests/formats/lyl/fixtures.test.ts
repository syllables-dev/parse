import { describe, expect, test } from "bun:test";
import { file as openFile } from "bun";
import { read, write } from "@/formats/lyl";

describe("lyl fixtures", () => {
  test("reads and round-trips gapped-lines.lyl", async () => {
    const doc = read(
      await openFile(
        new URL("../../fixtures/lyl/gapped-lines.lyl", import.meta.url)
      ).text()
    );

    expect(doc).toMatchObject({
      agents: [],
      meta: {},
      timing: "line",
      version: 1,
    });
    expect(doc.lines).toHaveLength(45);
    expect(doc.lines[0]).toEqual({
      agent: null,
      b: [],
      begin: 14_762,
      end: 17_792,
      id: "l0",
      p: [
        {
          begin: 14_762,
          end: 17_792,
          id: "l0w0",
          text: "Another hour just slipped away",
        },
      ],
    });
    expect(doc.lines.at(-1)?.end).toBe(173_668);
    expect(read(write(doc))).toEqual(doc);
  });
});
