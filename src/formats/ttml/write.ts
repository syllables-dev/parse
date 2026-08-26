import { capabilities } from "@/formats/ttml/capabilities";
import {
  escapeAttr,
  escapeText,
  itunesUri,
  ttmlUri,
  ttmUri,
  validLanguage,
  writeTime,
} from "@/formats/ttml/profile";
import { prepare } from "@/internal/projections";
import { checkTime } from "@/internal/timestamps";
import { hasLyricText } from "@/internal/write-check";
import type {
  LyricsDocument,
  LyricsElementAttributes,
  LyricsLine,
  LyricsPronunciation,
  LyricsTranslation,
  Syllable,
  WriteOptions,
} from "@/types";

function checkTrack(
  syllables: Syllable[],
  line: LyricsLine,
  lineTimed: boolean,
  label: string
) {
  for (const syllable of syllables) {
    checkTime(syllable.begin, `syllable ${syllable.id} start`);
    checkTime(syllable.end, `syllable ${syllable.id} end`);
    if (syllable.end < syllable.begin) {
      throw new RangeError(
        `syllable ${syllable.id} end must not precede its start`
      );
    }
    if (syllable.begin < line.begin || syllable.end > line.end) {
      throw new RangeError(
        `syllable ${syllable.id} must stay within line ${line.id}`
      );
    }
    if (
      lineTimed &&
      syllable.timed !== true &&
      (syllable.begin !== line.begin || syllable.end !== line.end)
    ) {
      throw new Error(`ttml line timing cannot preserve ${label} range`);
    }
    if (syllable.content !== undefined) {
      checkTrack(
        syllable.content.filter(
          (part): part is Syllable => typeof part !== "string"
        ),
        line,
        lineTimed,
        label
      );
    }
  }
}

function writeAttrs(
  attributes: LyricsElementAttributes & { keepParentheses?: boolean }
) {
  return [
    attributes.agent === undefined
      ? ""
      : ` ttm:agent="${escapeAttr(attributes.agent)}"`,
    attributes.role === undefined
      ? ""
      : ` ttm:role="${escapeAttr(attributes.role)}"`,
    attributes.keepParentheses ? ' itunes:parenthesis="keep"' : "",
    attributes.xmlId === undefined
      ? ""
      : ` xml:id="${escapeAttr(attributes.xmlId)}"`,
  ].join("");
}

function checkParallel(
  entry: LyricsPronunciation | LyricsTranslation,
  label: string,
  knownAgents: Set<string>
) {
  if (entry.agent !== undefined && !knownAgents.has(entry.agent)) {
    throw new Error(`${label} references an undeclared ttml agent`);
  }
  if ((entry.begin === undefined) !== (entry.end === undefined)) {
    throw new Error(`${label} requires begin and end together`);
  }
  if (entry.begin !== undefined && entry.end !== undefined) {
    checkTime(entry.begin, `${label} start`);
    checkTime(entry.end, `${label} end`);
    if (entry.end < entry.begin) {
      throw new RangeError(`${label} end must not precede its start`);
    }
  }
}

function checkPronunciation(
  language: string,
  pronunciation: LyricsPronunciation,
  line: LyricsLine,
  lineTimed: boolean,
  knownAgents: Set<string>
) {
  if (!validLanguage(language)) {
    throw new Error(`invalid ttml pronunciation language ${language}`);
  }
  for (const [variant, entry] of [
    pronunciation,
    ...(pronunciation.variants ?? []),
  ].entries()) {
    if (!entry) {
      continue;
    }
    const label = variant === 0 ? language : `${language} variant ${variant}`;
    checkParallel(entry, `${label} pronunciation`, knownAgents);
    checkAgents(entry.p, knownAgents);
    checkAgents(entry.b, knownAgents);
    checkTrack(entry.p, line, lineTimed, label);
    checkTrack(entry.b, line, lineTimed, `${label} backing pronunciation`);
  }
}

function checkTranslation(
  language: string,
  translation: LyricsTranslation,
  line: LyricsLine,
  lineTimed: boolean,
  knownAgents: Set<string>
) {
  if (!validLanguage(language)) {
    throw new Error(`invalid ttml translation language ${language}`);
  }
  checkParallel(translation, `${language} translation`, knownAgents);
  if (translation.pWords !== undefined) {
    checkAgents(translation.pWords, knownAgents);
    checkTrack(translation.pWords, line, lineTimed, `${language} translation`);
    if (
      translation.pWords.map((word) => word.text).join("") !== translation.p
    ) {
      throw new Error(`${language} translation text must match its words`);
    }
  }
  if (translation.bWords !== undefined) {
    checkAgents(translation.bWords, knownAgents);
    checkTrack(
      translation.bWords,
      line,
      lineTimed,
      `${language} backing translation`
    );
    if (
      translation.b === undefined ||
      translation.bWords.map((word) => word.text).join("") !== translation.b
    ) {
      throw new Error(
        `${language} backing translation text must match its words`
      );
    }
  }
}

function checkMaps(
  line: LyricsLine,
  lineTimed: boolean,
  knownAgents: Set<string>
) {
  if (line.translations && Object.keys(line.translations).length === 0) {
    throw new Error(
      `ttml cannot preserve an empty translation map on line ${line.id}`
    );
  }
  if (line.pronunciations && Object.keys(line.pronunciations).length === 0) {
    throw new Error(
      `ttml cannot preserve an empty pronunciation map on line ${line.id}`
    );
  }
  for (const [language, pronunciation] of Object.entries(
    line.pronunciations ?? {}
  )) {
    checkPronunciation(language, pronunciation, line, lineTimed, knownAgents);
  }
  for (const [language, translation] of Object.entries(
    line.translations ?? {}
  )) {
    checkTranslation(language, translation, line, lineTimed, knownAgents);
  }
}

function createdAttr(created: boolean | undefined) {
  return created === undefined ? "" : ` automaticallyCreated="${created}"`;
}

function translationTracks(doc: LyricsDocument) {
  const tracks = new Map(Object.entries(doc.translationTracks ?? {}));
  for (const line of doc.lines) {
    for (const language of Object.keys(line.translations ?? {})) {
      if (!tracks.has(language)) {
        tracks.set(language, {});
      }
    }
  }
  return tracks;
}

function pronunciationTracks(doc: LyricsDocument) {
  const tracks = new Map(Object.entries(doc.pronunciationTracks ?? {}));
  for (const line of doc.lines) {
    for (const language of Object.keys(line.pronunciations ?? {})) {
      if (!tracks.has(language)) {
        tracks.set(language, {});
      }
    }
  }
  return tracks;
}

function pronunciationEntries(
  doc: LyricsDocument,
  language: string,
  variant: number
) {
  const entries = doc.lines.flatMap((line) => {
    const pronunciation = line.pronunciations?.[language];
    const entry =
      variant === 0 ? pronunciation : pronunciation?.variants?.[variant - 1];
    return entry === undefined || entry.absent
      ? []
      : [{ line, pronunciation: entry }];
  });
  return entries;
}

function checkIds(ids: string[], label: string) {
  if (ids.some((id, index) => id.length === 0 || ids.indexOf(id) !== index)) {
    throw new Error(`ttml ${label} must be nonempty and unique`);
  }
}

function checkAgents(syllables: Syllable[], knownAgents: Set<string>) {
  for (const syllable of syllables) {
    if (syllable.agent !== undefined && !knownAgents.has(syllable.agent)) {
      throw new Error(
        `syllable ${syllable.id} references an undeclared ttml agent`
      );
    }
    if (syllable.content !== undefined) {
      if (
        syllable.content
          .map((part) => (typeof part === "string" ? part : part.text))
          .join("") !== syllable.text
      ) {
        throw new Error(`syllable ${syllable.id} text must match its content`);
      }
      checkAgents(
        syllable.content.filter(
          (part): part is Syllable => typeof part !== "string"
        ),
        knownAgents
      );
    }
  }
}

function checkLines(doc: LyricsDocument, agentIds: string[]) {
  const knownAgents = new Set(agentIds);
  for (const line of doc.lines) {
    checkTime(line.begin, `line ${line.id} start`);
    checkTime(line.end, `line ${line.id} end`);
    if (line.end <= line.begin) {
      throw new RangeError(`line ${line.id} end must follow its start`);
    }
    if (line.agent !== null && !knownAgents.has(line.agent)) {
      throw new Error(`line ${line.id} references an undeclared ttml agent`);
    }
    if (line.p.length === 0 && line.b.length > 0) {
      throw new Error(
        `ttml backing track requires primary text on line ${line.id}`
      );
    }
    checkTrack(
      line.p,
      line,
      doc.timing === "line",
      `line ${line.id} primary track`
    );
    checkTrack(
      line.b,
      line,
      doc.timing === "line",
      `line ${line.id} backing track`
    );
    checkAgents(line.p, knownAgents);
    checkAgents(line.b, knownAgents);
    checkMaps(line, doc.timing === "line", knownAgents);
  }
}

function checkAppleAttrs(doc: LyricsDocument, knownAgents: Set<string>) {
  const { apple } = doc;
  if (apple === undefined) {
    return;
  }
  for (const attributes of [
    apple.root,
    apple.body,
    ...(apple.sections ?? []),
  ]) {
    if (attributes?.agent !== undefined && !knownAgents.has(attributes.agent)) {
      throw new Error(
        `Apple TTML references an undeclared agent ${attributes.agent}`
      );
    }
  }
}

function checkAppleSections(doc: LyricsDocument) {
  const sections = doc.apple?.sections;
  if (sections === undefined) {
    return;
  }
  for (const section of sections) {
    if ((section.begin === undefined) !== (section.end === undefined)) {
      throw new Error("Apple sections require begin and end together");
    }
    if (section.begin !== undefined && section.end !== undefined) {
      checkTime(section.begin, "Apple section start");
      checkTime(section.end, "Apple section end");
      if (section.end < section.begin) {
        throw new RangeError("Apple section end must not precede its start");
      }
    }
  }
}

function checkPronunciationOrder(doc: LyricsDocument) {
  const order = doc.apple?.pronunciationOrder;
  if (order === undefined) {
    return;
  }
  const tracks = pronunciationTracks(doc);
  const known = new Set(
    [...tracks].flatMap(([language, track]) =>
      [track, ...(track.variants ?? [])].map(
        (_, variant) => `${language}:${variant}`
      )
    )
  );
  const ordered = order.map(
    ({ language, variant }) => `${language}:${variant}`
  );
  if (
    ordered.some(
      (reference, index) =>
        !known.has(reference) || ordered.indexOf(reference) !== index
    ) ||
    ordered.length !== known.size
  ) {
    throw new Error("Apple pronunciation order must list each track once");
  }
}

function checkApple(doc: LyricsDocument, knownAgents: Set<string>) {
  const { apple } = doc;
  if (apple === undefined) {
    return;
  }
  if (apple.language !== undefined && !validLanguage(apple.language)) {
    throw new Error(`invalid Apple TTML language ${apple.language}`);
  }
  if (apple.leadingSilence !== undefined) {
    checkTime(apple.leadingSilence, "Apple leading silence");
  }
  const duration = apple.body?.duration;
  if (duration !== undefined) {
    checkTime(duration, "Apple body duration");
    if (doc.lines.some((line) => line.end > duration)) {
      throw new RangeError("Apple body duration ends before its lyrics");
    }
  }
  checkAppleAttrs(doc, knownAgents);
  checkAppleSections(doc);
  checkPronunciationOrder(doc);
}

function checkDoc(doc: LyricsDocument) {
  if (doc.version !== 1 || (doc.timing !== "line" && doc.timing !== "word")) {
    throw new Error(
      "ttml requires a version 1 line-timed or word-timed document"
    );
  }
  if (doc.meta.author !== undefined) {
    throw new Error("ttml cannot represent a lyric file author");
  }
  // title has a home in ttml's own vocabulary, artist and album do not
  if (doc.meta.artist !== undefined || doc.meta.album !== undefined) {
    throw new Error("ttml cannot represent artist or album metadata");
  }
  if (doc.meta.songwriters?.length === 0) {
    throw new Error("ttml cannot preserve an empty songwriter list");
  }
  const { songwriterIds, songwriters } = doc.meta;
  if (
    songwriterIds !== undefined &&
    (songwriters === undefined || songwriterIds.length !== songwriters.length)
  ) {
    throw new Error("Apple songwriter IDs must align with songwriter names");
  }
  const agentIds = doc.agents.map((agent) => agent.id);
  checkIds(agentIds, "agent ids");
  checkIds(
    doc.lines.map((line) => line.id),
    "line ids"
  );
  for (const [language, track] of translationTracks(doc)) {
    if (!validLanguage(language)) {
      throw new Error(`invalid ttml translation language ${language}`);
    }
    if (
      track.kind !== undefined &&
      track.kind !== "subtitle" &&
      track.kind !== "replacement"
    ) {
      throw new Error(`invalid ttml translation kind ${track.kind}`);
    }
  }
  for (const language of pronunciationTracks(doc).keys()) {
    if (!validLanguage(language)) {
      throw new Error(`invalid ttml pronunciation language ${language}`);
    }
  }
  const knownAgents = new Set(agentIds);
  checkApple(doc, knownAgents);
  checkLines(doc, agentIds);
}

function writeSyllable(
  syllable: Syllable,
  lineTimed: boolean,
  opening: string,
  closing: string
): string {
  const content: string[] | undefined = syllable.content?.map((part) =>
    typeof part === "string"
      ? escapeText(part)
      : writeSyllable(part, lineTimed, "", "")
  );
  const lyric = `${escapeText(opening)}${content?.join("") ?? escapeText(syllable.text)}${escapeText(closing)}`;
  const attrs = writeAttrs(syllable);
  const nested = syllable.content !== undefined;
  if (lineTimed && syllable.timed !== true) {
    return attrs.length === 0 && !nested
      ? lyric
      : `<span${attrs}>${lyric}</span>`;
  }
  return `<span begin="${writeTime(syllable.begin)}" end="${writeTime(syllable.end)}"${attrs}>${lyric}</span>`;
}

function writeTrack(syllables: Syllable[], lineTimed: boolean, wrap: boolean) {
  return syllables
    .map((syllable, index) =>
      writeSyllable(
        syllable,
        lineTimed,
        wrap && index === 0 ? "(" : "",
        wrap && index === syllables.length - 1 ? ")" : ""
      )
    )
    .join("");
}

function writeTracks(
  primary: Syllable[],
  backing: Syllable[],
  lineTimed: boolean
) {
  const primaryMarkup = writeTrack(primary, lineTimed, false);
  if (backing.length === 0) {
    return primaryMarkup;
  }
  const backingMarkup = `<span ttm:role="x-bg">${writeTrack(backing, lineTimed, true)}</span>`;
  const backingStartsFirst =
    Math.min(...backing.map((syllable) => syllable.begin)) <
    Math.min(...primary.map((syllable) => syllable.begin));
  return backingStartsFirst
    ? backingMarkup + primaryMarkup
    : primaryMarkup + backingMarkup;
}

function writeTranslationBacking(
  translation: LyricsTranslation,
  lineTimed: boolean
) {
  const parenthesis = translation.bKeepParentheses
    ? ' itunes:parenthesis="keep"'
    : "";
  if (translation.bWords !== undefined) {
    return `<span ttm:role="x-bg"${parenthesis}>${writeTrack(translation.bWords, lineTimed, !translation.bKeepParentheses)}</span>`;
  }
  if (translation.b === undefined) {
    return "";
  }
  const lyric = translation.bKeepParentheses
    ? escapeText(translation.b)
    : `(${escapeText(translation.b)})`;
  return `<span ttm:role="x-bg"${parenthesis}>${lyric}</span>`;
}

function writeTranslationLine(
  line: LyricsLine,
  translation: LyricsTranslation,
  lineTimed: boolean
) {
  const primary =
    translation.pWords === undefined
      ? escapeText(translation.p)
      : writeTrack(translation.pWords, lineTimed, false);
  const begin =
    translation.begin === undefined
      ? ""
      : ` begin="${writeTime(translation.begin)}"`;
  const end =
    translation.end === undefined ? "" : ` end="${writeTime(translation.end)}"`;
  return `<text for="${escapeAttr(line.id)}"${begin}${end}${writeAttrs(translation)}>${primary}${writeTranslationBacking(translation, lineTimed)}</text>`;
}

function writeTranslations(doc: LyricsDocument) {
  return [...translationTracks(doc)]
    .map(([language, track]) => {
      const translated = doc.lines.flatMap((line) => {
        const translation = line.translations?.[language];
        if (!translation) {
          return [];
        }
        return [{ line, translation }];
      });
      const automatic = createdAttr(track.automaticallyCreated);
      const texts = translated.map(({ line, translation }) =>
        writeTranslationLine(line, translation, doc.timing === "line")
      );
      return `<translation type="${track.kind ?? "subtitle"}" xml:lang="${escapeAttr(language)}"${automatic}>${texts.join("")}</translation>`;
    })
    .join("");
}

function writeProns(doc: LyricsDocument) {
  const tracks = pronunciationTracks(doc);
  const order =
    doc.apple?.pronunciationOrder ??
    [...tracks].flatMap(([language, track]) =>
      [track, ...(track.variants ?? [])].map((_, variant) => ({
        language,
        variant,
      }))
    );
  return order
    .map(({ language, variant }) => {
      const track = tracks.get(language);
      const created = variant === 0 ? track : track?.variants?.[variant - 1];
      if (!created) {
        throw new Error(`unknown ${language} pronunciation track`);
      }
      const pronounced = pronunciationEntries(doc, language, variant);
      const automatic = createdAttr(created.automaticallyCreated);
      const texts = pronounced.map(({ line, pronunciation }) => {
        const lyric = writeTracks(
          pronunciation.p,
          pronunciation.b,
          doc.timing === "line"
        );
        return `<text for="${escapeAttr(line.id)}"${pronunciation.begin === undefined ? "" : ` begin="${writeTime(pronunciation.begin)}"`}${pronunciation.end === undefined ? "" : ` end="${writeTime(pronunciation.end)}"`}${writeAttrs(pronunciation)}>${lyric}</text>`;
      });
      return `<transliteration xml:lang="${escapeAttr(language)}"${automatic}>${texts.join("")}</transliteration>`;
    })
    .join("");
}

function writeLine(line: LyricsLine, lineTimed: boolean) {
  const agent =
    line.agent === null ? "" : ` ttm:agent="${escapeAttr(line.agent)}"`;
  return `<p begin="${writeTime(line.begin)}" end="${writeTime(line.end)}" itunes:key="${escapeAttr(line.id)}"${agent}${writeAttrs({ keepParentheses: line.keepParentheses, role: line.role, xmlId: line.xmlId })}>${writeTracks(line.p, line.b, lineTimed)}</p>`;
}

function writeSections(doc: LyricsDocument, duration: number) {
  const sections = doc.apple?.sections;
  if (sections === undefined) {
    if (doc.lines.length === 0) {
      return "<div/>";
    }
    const begin = Math.min(...doc.lines.map((line) => line.begin));
    return `<div begin="${writeTime(begin)}" end="${writeTime(duration)}">${doc.lines.map((line) => writeLine(line, doc.timing === "line")).join("")}</div>`;
  }
  const lines = new Map(doc.lines.map((line) => [line.id, line]));
  const used = new Set<string>();
  const markup = sections
    .map((section) => {
      const members = section.lines.map((id) => {
        const line = lines.get(id);
        if (!line || used.has(id)) {
          throw new Error(
            "Apple sections require each lyric line exactly once"
          );
        }
        used.add(id);
        return line;
      });
      const range =
        section.begin === undefined || section.end === undefined
          ? ""
          : ` begin="${writeTime(section.begin)}" end="${writeTime(section.end)}"`;
      if (members.length > 0 && range.length === 0) {
        throw new Error("populated Apple sections require begin and end times");
      }
      const part =
        section.part === undefined
          ? ""
          : ` itunes:songPart="${escapeAttr(section.part)}"`;
      return `<div${range}${part}${writeAttrs(section)}>${members.map((line) => writeLine(line, doc.timing === "line")).join("")}</div>`;
    })
    .join("");
  if (used.size !== doc.lines.length) {
    throw new Error("Apple sections require each lyric line exactly once");
  }
  return markup;
}

function writeBody(doc: LyricsDocument) {
  const duration =
    doc.apple?.body?.duration ??
    (doc.lines.length === 0
      ? 0
      : Math.max(...doc.lines.map((line) => line.end)));
  return `<body dur="${writeTime(duration)}"${writeAttrs(doc.apple?.body ?? {})}>${writeSections(doc, duration)}</body>`;
}

function droppingEmptyLines(doc: LyricsDocument): LyricsDocument {
  const kept = doc.lines.filter(hasLyricText);
  if (kept.length === doc.lines.length) {
    return doc;
  }
  const keptIds = new Set(kept.map((line) => line.id));
  const apple =
    doc.apple?.sections === undefined
      ? doc.apple
      : {
          ...doc.apple,
          sections: doc.apple.sections.map((section) => ({
            ...section,
            lines: section.lines.filter((id) => keptIds.has(id)),
          })),
        };
  return { ...doc, apple, lines: kept };
}

export function write(
  source: LyricsDocument,
  options: WriteOptions = {}
): string {
  const doc = droppingEmptyLines(
    prepare(source, capabilities, "ttml", options)
  );
  checkDoc(doc);
  // ttml's own title element, emitted before the agents it precedes in the profile
  const title =
    doc.meta.title === undefined
      ? ""
      : `<ttm:title>${escapeText(doc.meta.title)}</ttm:title>`;
  const agents = doc.agents
    .map((agent) => {
      const attrs = ` type="${escapeAttr(agent.type)}" xml:id="${escapeAttr(agent.id)}"${agent.artistId === undefined ? "" : ` itunes:artistId="${escapeAttr(agent.artistId)}"`}`;
      return agent.name === undefined
        ? `<ttm:agent${attrs}/>`
        : `<ttm:agent${attrs}><ttm:name>${escapeText(agent.name)}</ttm:name></ttm:agent>`;
    })
    .join("");
  const translations = writeTranslations(doc);
  const prons = writeProns(doc);
  const songwriters = (doc.meta.songwriters ?? [])
    .map((writer, index) => {
      const artistId = doc.meta.songwriterIds?.[index];
      return `<songwriter${artistId === undefined ? "" : ` artistId="${escapeAttr(artistId)}"`}>${escapeText(writer)}</songwriter>`;
    })
    .join("");
  const transliterations =
    prons.length === 0 ? "" : `<transliterations>${prons}</transliterations>`;
  const { apple } = doc;
  const leadingSilence =
    apple?.leadingSilence === undefined
      ? ""
      : ` leadingSilence="${writeTime(apple.leadingSilence)}"`;
  const audio =
    apple?.audio?.role === undefined && apple?.audio?.spatial === undefined
      ? ""
      : `<audio${apple.audio?.role === undefined ? "" : ` role="${escapeAttr(apple.audio.role)}"`}${apple.audio?.spatial === undefined ? "" : ` spatial="${apple.audio.spatial}"`}/>`;
  const lyricGenerationId =
    apple?.lyricGenerationId === undefined
      ? ""
      : ` itunes:lyricGenId="${escapeAttr(apple.lyricGenerationId)}"`;
  const language =
    apple?.language === undefined
      ? ""
      : ` xml:lang="${escapeAttr(apple.language)}"`;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<tt xmlns="${ttmlUri}" xmlns:itunes="${itunesUri}" xmlns:ttm="${ttmUri}" itunes:timing="${doc.timing === "word" ? "Word" : "Line"}"${lyricGenerationId}${language}${writeAttrs(apple?.root ?? {})}>`,
    `<head><metadata>${title}${agents}<iTunesMetadata xmlns="${itunesUri}"${leadingSilence}><translations>${translations}</translations>${transliterations}<songwriters>${songwriters}</songwriters>${audio}</iTunesMetadata></metadata></head>`,
    writeBody(doc),
    "</tt>",
  ].join("\n");
}
