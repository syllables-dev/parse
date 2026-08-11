import { describe, expect, test } from "bun:test";
import type { LyricsDocument } from "@/index";
import { ParseError, read, write } from "@/index";

function prefixedTtml(lyricMarkup: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<t:tt xmlns:t="http://www.w3.org/ns/ttml" xmlns:a="http://music.apple.com/lyric-ttml-internal" xmlns:m="http://www.w3.org/ns/ttml#metadata" a:timing="Word" xml:lang="en">
  <t:head><t:metadata><m:agent xml:id="voice&amp;one" type="person"/></t:metadata></t:head>
  <t:body dur="0:05.000"><t:div begin="0:00.000" end="0:05.000">${lyricMarkup}</t:div></t:body>
</t:tt>`;
}

describe("TTML XML handling", () => {
  test("resolves namespaces and decodes entities in mixed text", () => {
    const doc = read(
      prefixedTtml(
        '<t:p begin="0:01.000" end="0:03.000" a:key="line&amp;one" m:agent="voice&amp;one"><t:span begin="0:01.000" end="0:02.000">Rock &amp; <![CDATA[roll]]></t:span> tail <t:span begin="0:02.000" end="0:03.000">&#x266B;</t:span></t:p>'
      ),
      "ttml"
    );

    expect(doc.agents).toEqual([{ id: "voice&one", type: "person" }]);
    expect(doc.lines[0]).toMatchObject({
      agent: "voice&one",
      begin: 1000,
      end: 3000,
      id: "line&one",
      p: [
        { begin: 1000, end: 2000, text: "Rock & roll tail " },
        { begin: 2000, end: 3000, text: "♫" },
      ],
    });
  });

  test("uses deterministic fallback line keys", () => {
    const source = prefixedTtml(
      '<t:p begin="0:01.000" end="0:02.000"><t:span begin="0:01.000" end="0:02.000">one</t:span></t:p><t:p begin="0:02.000" end="0:03.000"><t:span begin="0:02.000" end="0:03.000">two</t:span></t:p>'
    );

    expect(read(source, "ttml").lines.map((line) => line.id)).toEqual([
      "L1",
      "L2",
    ]);
    expect(read(source, "ttml")).toEqual(read(source, "ttml"));
  });

  test("escapes text and attribute entities during a public round trip", () => {
    const doc: LyricsDocument = {
      agents: [],
      lines: [
        {
          agent: null,
          b: [],
          begin: 0,
          end: 1000,
          id: 'line"&',
          p: [
            {
              begin: 0,
              end: 1000,
              id: "word",
              text: "A < B & C > D",
            },
          ],
        },
      ],
      meta: {},
      timing: "line",
      version: 1,
    };

    const source = write(doc, "ttml");

    expect(source).toContain('itunes:key="line&quot;&amp;"');
    expect(source).toContain("A &lt; B &amp; C &gt; D");
    expect(read(source, "ttml")).toMatchObject({
      lines: [
        {
          begin: 0,
          end: 1000,
          id: 'line"&',
          p: [{ begin: 0, end: 1000, text: "A < B & C > D" }],
        },
      ],
    });
  });

  test.each([
    "<tt><p></tt>",
    '<tt a="one" a="two"/>',
    "<x:tt/>",
    "<tt>&bogus;</tt>",
    "<tt/><tail/>",
    "<tt><!-- unclosed</tt>",
  ])("throws ParseError for malformed XML", (source) => {
    expect(() => read(source, "ttml")).toThrow(ParseError);
  });
});
