import type { LyricsDocument, LyricsPronunciation, Syllable } from "../types";

export function hasAppleFields(doc: LyricsDocument) {
  return (
    doc.apple !== undefined ||
    doc.meta.songwriterIds !== undefined ||
    doc.agents.some(
      (agent) => agent.artistId !== undefined || agent.name !== undefined
    ) ||
    doc.lines.some(
      (line) =>
        line.role !== undefined ||
        line.xmlId !== undefined ||
        line.keepParentheses !== undefined ||
        [...line.p, ...line.b].some((syllable) => hasAppleSyllable(syllable))
    ) ||
    doc.lines.some(
      (line) =>
        Object.values(line.translations ?? {}).some(
          (translation) =>
            translation.agent !== undefined ||
            translation.begin !== undefined ||
            translation.bKeepParentheses !== undefined ||
            translation.bWords !== undefined ||
            translation.end !== undefined ||
            translation.keepParentheses !== undefined ||
            translation.role !== undefined ||
            translation.pWords !== undefined ||
            translation.xmlId !== undefined
        ) ||
        Object.values(line.pronunciations ?? {}).some(hasApplePronunciation)
    )
  );
}

function hasAppleSyllable(syllable: Syllable): boolean {
  return (
    syllable.agent !== undefined ||
    syllable.content !== undefined ||
    syllable.keepParentheses !== undefined ||
    syllable.role !== undefined ||
    syllable.timed !== undefined ||
    syllable.xmlId !== undefined
  );
}

function hasApplePronunciation(pronunciation: LyricsPronunciation): boolean {
  return (
    pronunciation.agent !== undefined ||
    pronunciation.begin !== undefined ||
    pronunciation.end !== undefined ||
    pronunciation.keepParentheses !== undefined ||
    pronunciation.role !== undefined ||
    pronunciation.xmlId !== undefined ||
    (pronunciation.variants?.some(
      (variant) => variant !== undefined && hasApplePronunciation(variant)
    ) ??
      false)
  );
}
