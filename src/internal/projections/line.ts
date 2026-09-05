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
