import type {
  FormatCapabilities,
  LyricsDocument,
  LyricsLine,
  Syllable,
} from "@/types";

export function track(syllables: Syllable[], line: LyricsLine) {
  const [first] = syllables;
  if (first === undefined) {
    return [];
  }
  return [
    {
      begin: line.begin,
      end: line.end,
      id: first.id,
      text: syllables.map((syllable) => syllable.text).join(""),
    },
  ];
}

// a line-timed writer emits one syllable spanning the line, so anything else is collapsed away
export function primaryProblem(line: LyricsLine) {
  if (line.p.length > 1) {
    return `the primary syllable count of line ${line.id}`;
  }
  if (
    line.p.some(
      (syllable) => syllable.begin !== line.begin || syllable.end !== line.end
    )
  ) {
    return `the primary syllable range of line ${line.id}`;
  }
}

export function alreadyWrapped(text: string) {
  return text.startsWith("(") && text.endsWith(")");
}

export function projectedLine(
  line: LyricsLine,
  capabilities: FormatCapabilities,
  wordTimed: boolean
): LyricsLine {
  const { pronunciations, translations, ...shared } = line;
  return {
    ...shared,
    agent: capabilities.agents === false ? null : line.agent,
    b: capabilities.backing ? projectedTrack(line.b, line, wordTimed) : [],
    p: projectedTrack(line.p, line, wordTimed),
    ...(capabilities.pronunciation &&
      pronunciations !== undefined && { pronunciations }),
    ...(capabilities.translation &&
      translations !== undefined && { translations }),
  };
}

function projectedTrack(
  syllables: Syllable[],
  line: LyricsLine,
  wordTimed: boolean
) {
  return wordTimed ? syllables : track(syllables, line);
}

// a format without a backing track keeps the words as their own parenthesized line,
// so lossy output loses the track but not the lyric
export function backingLine(
  line: LyricsLine,
  capabilities: FormatCapabilities,
  wordTimed: boolean
): LyricsLine | undefined {
  if (capabilities.backing || line.b.length === 0) {
    return;
  }
  const carriesParens = alreadyWrapped(
    line.b
      .map((syllable) => syllable.text)
      .join("")
      .trim()
  );
  const wrapped = line.b.map((syllable, index) => {
    const first = index === 0;
    const last = index === line.b.length - 1;
    const text = syllable.text.slice(
      first ? syllable.text.length - syllable.text.trimStart().length : 0,
      last ? syllable.text.trimEnd().length : undefined
    );
    return {
      ...syllable,
      text: carriesParens
        ? text
        : `${first ? "(" : ""}${text}${last ? ")" : ""}`,
    };
  });
  const bare = {
    agent: capabilities.agents === false ? null : line.agent,
    b: [],
    begin: Math.min(...line.b.map((syllable) => syllable.begin)),
    end: Math.max(...line.b.map((syllable) => syllable.end)),
    id: `${line.id}b`,
    p: wrapped,
  };
  return { ...bare, p: projectedTrack(wrapped, bare, wordTimed) };
}

export function projectedLines(
  doc: LyricsDocument,
  capabilities: FormatCapabilities,
  wordTimed: boolean
) {
  return doc.lines.flatMap((line) => {
    if (capabilities.backing && line.p.length === 0) {
      return [];
    }
    const primary = projectedLine(line, capabilities, wordTimed);
    const backing = backingLine(line, capabilities, wordTimed);
    if (backing === undefined) {
      return [primary];
    }
    return backing.begin < primary.begin
      ? [backing, primary]
      : [primary, backing];
  });
}
