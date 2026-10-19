import { expect, test } from "bun:test";
import { read } from "@/index";

test("accepts explicitly typed pronunciation tracks without losing their words", async () => {
  const source = await Bun.file(
    new URL(
      "../../fixtures/ttml/translation-pronunciation.ttml",
      import.meta.url
    )
  ).text();
  const typed = source.replaceAll(
    "<transliteration ",
    '<transliteration type="pronunciation" '
  );
  expect(typed).not.toBe(source);
  expect(read(typed, "ttml")).toEqual(read(source, "ttml"));
  expect(() =>
    read(typed.replace('type="pronunciation"', 'type="unknown"'), "ttml")
  ).toThrow("unsupported transliteration type");
});
