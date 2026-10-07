import { describe, expect, test } from "bun:test";
import { ParseError, read } from "@/index";

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

  test.each([
    { message: "expected </p>", source: "<tt><p></tt>" },
    { message: "duplicate attribute a", source: '<tt a="one" a="two"/>' },
    { message: "unbound namespace prefix x", source: "<x:tt/>" },
    { message: "invalid entity &bogus;", source: "<tt>&bogus;</tt>" },
    { message: "content after root element", source: "<tt/><tail/>" },
    { message: "unclosed comment", source: "<tt><!-- unclosed</tt>" },
  ])("throws $message for malformed XML", ({ message, source }) => {
    expect(() => read(source, "ttml")).toThrow(ParseError);
    expect(() => read(source, "ttml")).toThrow(message);
  });
});
