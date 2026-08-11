# @syllables-dev/parse

Readers and writers for Apple Music TTML, LRC, ESLRC, QRC, YRC, LYS, and LQE. Every codec uses the same plain JSON `LyricsDocument` schema with absolute millisecond timestamps.

```ts
import { capabilities, convert, parse, write } from "@syllables-dev/parse";

const { doc, format } = parse(source);
const lrc = convert(source, "lrc");
const ttml = write(doc, "ttml");
const preservesWords = capabilities(format).wordTiming;
const preservesTitle = capabilities(format).metadata.title;
```

The root exports `detect`, `parse`, `read`, `write`, `convert`, `capabilities`, `validate`, `createDocument`, `ParseError`, and all public schema types. Detection reads content only and returns `null` for unrecognized text. Parsing and conversion throw `ParseError` when detection cannot identify a format.

Each codec also has a focused subpath that exports `read`, `write`, and `capabilities`:

```ts
import { read, write } from "@syllables-dev/parse/ttml";
```

Documents and ids are deterministic for identical input. Readers and writers are pure and preserve features according to `capabilities(format)`.

Agent capabilities are `false`, `alignment`, or `identity`; `alignment` preserves duet-side attribution and may canonicalize ids and types, and `identity` preserves opaque ids and types.

Metadata capabilities cover `album`, `artist`, `author`, `songwriters`, and `title`. Readers apply source offsets to document timestamps.
