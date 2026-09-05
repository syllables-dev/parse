# @syllables-dev/parse

Readers and writers for lyric formats, built around one shared document schema.

Every format reads into a plain `LyricsDocument` object and writes back out from it (hub and spoke).

Supported spokes:
- TTML (Apple Music lyric profile only, not generic W3C TTML)
- LRC (absorbs A2 word tags when present; the A2 dialect is not its own format)
- LYL (Lyricify Lines)
- ESLRC
- QRC
- YRC
- LYS
- LQE

Any-to-any conversion is `write(read(text))`; codecs never import each other, with LQE as the one documented exception (it is a container that delegates its sections to other codecs).

## Timing

A document is `static`, `line`, or `word` timed, and `FormatCapabilities.timing` says which of the three a writer can encode. TTML encodes all three, LRC and LYL only line, every other format only word.

Timing is never upscaled. A writer refuses a document it cannot encode, `lossy` included, because inventing word boundaries or timestamps the source never carried is fabrication, not loss. Downscaling word to line stays an ordinary lossy conversion and is reported by `losses` as `wordTiming`.

Static documents leave every line and syllable `begin` and `end` at `0`. `validate` reports nothing for them, since every problem it can report is a timing problem.

## Rules

- Always use the Bun toolchain: `bun` and `bunx`. Never `node`, `npm`, `pnpm`, or `npx`.
- Run tests with `bun test`.
- Do not use em dashes anywhere: not in code, comments, docs, responses, or any other writing in this repo.
- `tests/fixtures/` is read only. Never modify, reformat, or "fix" a fixture; codecs must adapt to fixtures, never the reverse.
- Documents are plain JSON-serializable data: no classes, Maps, or Dates in the schema.
- Zero runtime dependencies. Do not add any without explicit approval.
- Named exports only. No `utils.ts`; shared code gets a descriptive name and lives in `src/internal/`.
- Import through the `@/` alias, never `./` or `../`. `@/` maps to `src/`, so `@/internal/projections` and `@/types` work from any depth. The build rewrites the alias back to relative paths in the emitted declarations, so published consumers never see it. Test files importing a sibling helper under `tests/` stay relative, since `@/` only reaches `src/`.

## Coding style

- Clear, meaningful names for files, variables, and functions. Short enough to scan, yet concise enough to convey intent. Nothing that reads like boilerplate or AI output.
- Avoid snake_case for everything. Use kebab-case for file names, camelCase for variables and functions, PascalCase for types and classes.
- No redundant intermediate variables or function hops. Write `const c = g(f(a))`, not `const b = f(a); const c = g(b)`, unless `b` is reused.
- Function size:
  - Under 20 lines and used once: inline it. No one-off helpers.
  - Under 20 lines and used more than once: extract a named function.
  - Over 20 lines: split or refactor as needed.
- Strict top-to-bottom order in every file: imports, then enums, then types/interfaces, then logic.
- A comment may only say what the code cannot: a format quirk, an invariant, a why. If it restates what the code does, delete it. Comments should be concise and in all lowercase.

  ```ts
  // bad: narrates the next line
  // parse the timestamp and convert to ms
  const ms = toMs(stamp);

  // good: states a fact the code cannot express
  // <t> marks a word START; the last word of a line inherits the line end
  ```

- Do not handle impossible states; let them throw. Readers are the boundary and get to be paranoid about dirty input. Everything after them trusts the document. No try/catch around code that cannot throw, no null checks the types already rule out, no fallback values that hide bugs.

  ```ts
  // bad: the type says text exists; ?? "" would bury a real bug
  const text = line?.text ?? "";

  // good
  const text = line.text;
  ```

- No `any`, no `as` casts to silence errors, no type annotations inference already covers.
- No premature abstraction: no single-implementer interfaces, no config objects with one field, no wrappers that add a name but no behavior. This is a small package; write like it.
- Generic names are banned: `data`, `result`, `item`, `temp`, `obj`, `helper`, `process`, `handle`. Name the thing for what it is: `stamps`, `rows`, `syllables`.
- Before finishing, make a deletion pass: remove every comment that restates code, every single-use variable that adds nothing, every branch that cannot be reached.

## Tests

- Every test must protect a real behavior: a format quirk, a genuine edge case, or a demonstrated bug. If a test cannot fail for a reason a user would care about, delete it.
- Do not write tests that restate constants, mirror the implementation line by line, or assert that TypeScript types exist. Those pass forever and protect nothing.
- Do not pad coverage. Ten sharp tests beat fifty shallow ones; coverage percentage is not a goal.
- The two test shapes that matters:
  - Fixture tests: real sample file in, expected document out.
  - Round-trip tests: write(read(x)) is stable within the format's capability tier.
- Real edge cases worth testing: BOM, CRLF, repeated timestamps, last-word end inheritance, parens inside word text, per-char CJK syllables, JSON preamble lines, LYS property integers, empty or whitespace-only lines.
- Test through the public API. Do not export internals just to test them.

## Code quality

Do the following steps after finishing any task:

1. Run `bun tsgo` (tsgo). Fix every reported issue.
2. Run `bun fix` (ultracite). Fix every issue it cannot auto-fix.
3. Rerun both until both pass clean in the same round, then stop.
