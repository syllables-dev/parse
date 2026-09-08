import type { FormatCapabilities, LyricsLine, Syllable } from "@/types";

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
export function primaryCoversLine(line: LyricsLine) {
  const [first] = line.p;
  return (
    line.p.length <= 1 &&
    (first === undefined ||
      (first.begin === line.begin && first.end === line.end))
  );
}

function projectedTrack(
  syllables: Syllable[],
  line: LyricsLine,
  wordTimed: boolean
) {
  return wordTimed ? syllables : track(syllables, line);
}

export function alreadyWrapped(text: string) {
  return text.startsWith("(") && text.endsWith(")");
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
  const begin = Math.min(...line.b.map((syllable) => syllable.begin));
  const end = Math.max(...line.b.map((syllable) => syllable.end));
  const carriesParens = alreadyWrapped(
    line.b
      .map((syllable) => syllable.text)
      .join("")
      .trim()
  );
  const wrapped = line.b.map((syllable, index) => ({
    ...syllable,
    text: carriesParens
      ? syllable.text
      : `${index === 0 ? "(" : ""}${syllable.text}${index === line.b.length - 1 ? ")" : ""}`,
  }));
  const bare = { ...line, b: [], begin, end, id: `${line.id}b`, p: wrapped };
  return { ...bare, p: projectedTrack(wrapped, bare, wordTimed) };
}

export function projectedLine(
  line: LyricsLine,
  capabilities: FormatCapabilities,
  wordTimed: boolean,
  translations: LyricsLine["translations"],
  isAppleTarget: boolean
) {
  const projectedTranslations =
    isAppleTarget || translations === undefined
      ? translations
      : Object.fromEntries(
          Object.entries(translations).map(([language, translation]) => [
            language,
            {
              ...(translation.b === undefined ? {} : { b: translation.b }),
              p: translation.p,
            },
          ])
        );
  return {
    agent: capabilities.agents === false ? null : line.agent,
    b: capabilities.backing ? projectedTrack(line.b, line, wordTimed) : [],
    begin: line.begin,
    end: line.end,
    id: line.id,
    p: projectedTrack(line.p, line, wordTimed),
    ...(capabilities.pronunciation &&
      line.pronunciations !== undefined && {
        pronunciations: line.pronunciations,
      }),
    ...(capabilities.translation &&
      projectedTranslations !== undefined && {
        translations: projectedTranslations,
      }),
  };
}
