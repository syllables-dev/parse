# parse

Readers and writers for Apple Music TTML, LRC, LYL, ESLRC, QRC, YRC, LYS, and LQE, built around one shared document schema.

> [!NOTE]
> Pre-1.0. The schema may still change between minor versions.

## Install

```sh
bun add @syllables-dev/parse
```

## Usage

```ts
import { convert, parse } from "@syllables-dev/parse";

const { doc, format } = parse(source);
const lrc = convert(source, "lrc");
```

Full documentation lives at [docs.syllables.dev/packages/parse](https://docs.syllables.dev/packages/parse).

## Development

```sh
bun install
bun test
bun run check
bun run tsgo
```

## License

MIT
