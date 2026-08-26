<div align="center">

# @syllables-dev/parse

**Readers and writers for lyric formats, built around one shared document schema.**

Apple Music TTML &middot; LRC &middot; ESLRC &middot; QRC &middot; YRC &middot; LYS &middot; LQE

</div>

<br>

> [!NOTE]
> Documentation is a work in progress. Everything below is accurate and covered by tests, but the package is pre-1.0 and the schema may still change between minor versions.

<br>

## Install

```sh
bun add @syllables-dev/parse
```

<br>

## How it works

Every format reads into a plain `LyricsDocument` and writes back out from it. Codecs never import each other, so any-to-any conversion is simply `write(read(text))`.

<br>

## Quick start

```ts
import { convert, parse } from "@syllables-dev/parse";

// detect the format and read it
const { doc, format } = parse(source);

// or go straight across
const lrc = convert(source, "lrc");
```

<br>

## Lossy conversion

Formats are not equally expressive. Writing is **strict by default**, so nothing is lost silently: you either get an error or you opt in.

```ts
import { losses, read, write } from "@syllables-dev/parse";

const doc = read("[0,1300]Hel(0,400)lo (400,300)world(700,600)", "qrc");

losses(doc, "lrc");
// ["wordTiming", "lineTiming"]

write(doc, "lrc");
// throws: lrc cannot represent word timing

write(doc, "lrc", { lossy: true });
// "[by:]\n[00:00.000]Hello world"
```

Call `losses(doc, format)` first to see what a target cannot hold, then pass `{ lossy: true }` when you accept it.

<br>

## What each format preserves

<div align="center">

| | word timing | backing | agents | translation | pronunciation |
|:--|:--:|:--:|:--:|:--:|:--:|
| **TTML** | ✓ | ✓ | identity | ✓ | ✓ |
| **LQE** | ✓ | ✓ | alignment | ✓ | |
| **LYS** | ✓ | ✓ | alignment | | |
| **QRC** | ✓ | ✓ | | | |
| **YRC** | ✓ | | | | |
| **ESLRC** | ✓ | | | | |
| **LRC** | | | | | |

</div>

`agents` is tiered: `identity` keeps opaque IDs and types, `alignment` keeps duet-side attribution but may canonicalize them. Query all of this at runtime with `capabilities(format)`.

<br>

## API

<table>
<tr><th align="left">Function</th><th align="left">Purpose</th></tr>
<tr><td><code>detect(text)</code></td><td>Identify a format from content alone. Returns <code>null</code> when unrecognized.</td></tr>
<tr><td><code>parse(text)</code></td><td>Detect and read in one step. Returns <code>{ doc, format }</code>.</td></tr>
<tr><td><code>read(text, format)</code></td><td>Read text you already know the format of.</td></tr>
<tr><td><code>write(doc, format)</code></td><td>Serialize a document. Throws when the format cannot represent it.</td></tr>
<tr><td><code>convert(text, to)</code></td><td>Detect, read, and write in one step.</td></tr>
<tr><td><code>losses(doc, format)</code></td><td>List what a target format would drop.</td></tr>
<tr><td><code>capabilities(format)</code></td><td>What a format can preserve.</td></tr>
<tr><td><code>validate(doc)</code></td><td>Structural problems in a document you built or edited.</td></tr>
<tr><td><code>createDocument()</code></td><td>An empty document to build from.</td></tr>
</table>

`ParseError` and every public schema type are exported from the root.

<br>

### Subpath imports

Pull in a single codec when you do not need detection:

```ts
import { read, write } from "@syllables-dev/parse/ttml";
```

Available for `ttml`, `lrc`, `eslrc`, `qrc`, `yrc`, `lys`, and `lqe`.

<br>

## Guarantees

<table>
<tr><td><b>Deterministic</b></td><td>Identical input always produces identical documents and IDs.</td></tr>
<tr><td><b>Pure</b></td><td>Readers and writers never mutate their input.</td></tr>
<tr><td><b>Plain data</b></td><td>Documents are JSON-serializable. No classes, Maps, or Dates.</td></tr>
<tr><td><b>Absolute time</b></td><td>Every timestamp is an integer millisecond offset. Source offsets are applied on read.</td></tr>
</table>

<br>

## License

MIT
