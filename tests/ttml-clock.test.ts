import { expect, test } from "bun:test";
import { read } from "@/formats/ttml";

function lyrics(begin: string, end: string, duration = end) {
  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Line" xml:lang="en"><head><metadata/></head><body dur="${duration}"><div begin="${begin}" end="${end}"><p begin="${begin}" end="${end}" itunes:key="L1">Test</p></div></body></tt>`;
}

test("Apple hour clocks and fractional precision share the duration and line reader", () => {
  const song = read(lyrics("00:00:13.610", "00:00:21.070", "00:03:40.930"));
  expect(song.lines[0]?.begin).toBe(13_610);
  expect(song.lines[0]?.end).toBe(21_070);
  for (const start of [
    "1:02:03.1235",
    "62:03.1235",
    "3723.1235",
    " 01:02:03.1235 ",
  ]) {
    expect(read(lyrics(start, "01:02:04")).lines[0]?.begin).toBe(3_723_124);
  }
  for (const start of [
    "00:60:00",
    "1:60",
    "1:2:3:4",
    "NaN",
    "-1",
    "9007199254740992",
  ]) {
    expect(() => read(lyrics(start, "02:00:00"))).toThrow();
  }
});
