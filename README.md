# @syllables-dev/parse

Readers and writers for Apple Music TTML, LRC, ESLRC, QRC, YRC, LYS, and LQE, built around one shared document schema.

The package is pre-1.0. Everything documented here is covered by tests, but the schema may still change between minor versions.

## Install

```sh
bun add @syllables-dev/parse
```

## How it works

Every format reads into a plain `LyricsDocument` and writes back out from it. Codecs never import each other, so converting between any two of them is just `write(read(text))`.

```ts
import { convert, parse } from "@syllables-dev/parse";

// detect the format and read it
const { doc, format } = parse(source);

// or go straight across
const lrc = convert(source, "lrc");
```

## Lossy conversion

Formats are not equally expressive, and writing is strict by default. You either get an error or you opt in.

```ts
import { losses, read, write } from "@syllables-dev/parse";

const doc = read("[0,1300]Hel(0,400)lo (400,300)world(700,600)", "qrc");

losses(doc, "lrc");
// ["wordTiming", "lineRange"]

write(doc, "lrc");
// throws: lrc cannot represent word timing

write(doc, "lrc", { lossy: true });
// "[by:]\n[00:00.000]Hello world"
```

Call `losses(doc, format)` to see what a target would drop, then pass `{ lossy: true }` once you accept it.

## Timing

A document is `static`, `line`, or `word` timed. TTML covers all three, LRC is line only, and the rest are word only.

Timing is never upscaled. Writing a line-timed document to QRC would mean inventing word boundaries the source never carried, so it is refused outright rather than fabricated, and `{ lossy: true }` does not change that.

```ts
const doc = read("[00:01.000]Hello", "lrc");

write(doc, "qrc", { lossy: true });
// throws: qrc cannot represent line timing
```

Going the other way is fine. Word to line drops detail that really is there, so it is an ordinary lossy write.

## What each format preserves

| | static | line | word | backing | agents | translation | pronunciation |
|:--|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| TTML | ✓ | ✓ | ✓ | ✓ | identity | ✓ | ✓ |
| LQE | | | ✓ | ✓ | alignment | ✓ | |
| LYS | | | ✓ | ✓ | alignment | | |
| QRC | | | ✓ | ✓ | | | |
| YRC | | | ✓ | | | | |
| ESLRC | | | ✓ | | | | |
| LRC | | ✓ | | | | | |

The first three columns are timing granularities. `agents` is tiered: `identity` keeps opaque IDs and types, `alignment` keeps duet-side attribution but may canonicalize them. All of it is available at runtime through `capabilities(format)`.

## API

- `detect(text)` identifies a format from content alone, or returns `null`.
- `parse(text)` detects and reads in one step, returning `{ doc, format }`.
- `read(text, format)` reads text whose format you already know.
- `write(doc, format)` serializes a document, and throws when the format cannot represent it.
- `convert(text, to)` detects, reads, and writes in one step.
- `losses(doc, format)` lists what a target format would drop.
- `capabilities(format)` reports what a format can preserve.
- `validate(doc)` finds structural problems in a document you built or edited.
- `createDocument()` returns an empty document to build from.

`ParseError` and every public schema type are exported from the root.

To pull in a single codec without the detection machinery:

```ts
import { read, write } from "@syllables-dev/parse/ttml";
```

That works for `ttml`, `lrc`, `eslrc`, `qrc`, `yrc`, `lys`, and `lqe`.

## Guarantees

Identical input always produces identical documents and IDs. Readers and writers never mutate their input. Documents are JSON-serializable, with no classes, Maps, or Dates. Every timestamp is an integer millisecond offset, and any source offset is applied on read.

## License

MIT
