import { describe, expect, test } from "bun:test";
import { createDocument } from "../src";

describe("createDocument", () => {
  test("returns a plain JSON value", () => {
    const doc = createDocument();

    expect(structuredClone(doc)).toEqual(doc);
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
    expect(Object.getPrototypeOf(doc)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(doc.meta)).toBe(Object.prototype);
  });

  test("creates independent collections", () => {
    const first = createDocument();
    const second = createDocument();

    first.agents.push({ id: "voice", type: "person" });
    first.meta.title = "Changed";
    first.lines.push({
      agent: "voice",
      b: [],
      begin: 0,
      end: 1000,
      id: "line",
      p: [{ begin: 0, end: 1000, id: "word", text: "lyric" }],
    });

    expect(second).toEqual({
      agents: [],
      lines: [],
      meta: {},
      timing: "line",
      version: 1,
    });
    expect(first.agents).not.toBe(second.agents);
    expect(first.lines).not.toBe(second.lines);
    expect(first.meta).not.toBe(second.meta);
  });
});
