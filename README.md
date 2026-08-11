# @syllables-dev/parse

Readers and writers for Apple Music TTML, LRC, ESLRC, QRC, YRC, LYS, and LQE. Every codec uses the same plain JSON `LyricsDocument` schema with absolute millisecond timestamps.

```ts
import { capabilities, convert, losses, parse, write } from "@syllables-dev/parse";

const { doc, format } = parse(source);
const lrc = convert(source, "lrc");
const ttml = write(doc, "ttml");
const preservesWords = capabilities(format).wordTiming;
const preservesTitle = capabilities(format).metadata.title;
const dropped = losses(doc, "ttml");
const lossyTtml = write(doc, "ttml", { lossy: true });
```

The root exports `detect`, `parse`, `read`, `write`, `convert`, `losses`, `capabilities`, `validate`, `createDocument`, `ParseError`, and all public schema types. Detection reads content only and returns `null` for unrecognized text. Parsing and conversion throw `ParseError` when detection cannot identify a format.

Each codec also has a focused subpath that exports `read`, `write`, and `capabilities`:

```ts
import { read, write } from "@syllables-dev/parse/ttml";
```

Documents and IDs are deterministic for identical input. Readers and writers are pure and preserve features according to `capabilities(format)`.

Writes and conversions are strict by default. `losses(doc, format)` lists unsupported document features. `{ lossy: true }` projects them away before writing while parsing always preserves source data.

Agent capabilities are `false`, `alignment`, or `identity`; `alignment` preserves duet-side attribution and may canonicalize IDs and types, and `identity` preserves opaque IDs and types.

Metadata capabilities cover `album`, `artist`, `author`, `songwriters`, and `title`. Apple TTML-only fields such as agents, song parts, timing metadata, and element attributes exist only in TTML; no other format can represent them, so their absence elsewhere is not a tracked capability. `trackGenerated` covers the generated-text flag on translation and pronunciation tracks; `trackKind` covers translation subtitle and replacement behavior.

Line `translations` and `pronunciations` hold each language's lyric rows. Document-level `translationTracks` maps languages to `{ automaticallyCreated?, kind? }`; `pronunciationTracks` maps languages to `{ automaticallyCreated?, variants? }`. Repeated Apple transliterations use `variants` and `apple.pronunciationOrder` to retain source order. Nested Apple spans use `Syllable.content`. Readers apply source offsets to document timestamps and writers emit adjusted timestamps without offset tags.
