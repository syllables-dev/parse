import { checkTime } from "../../internal/timestamps";
import type {
  LyricsDocument,
  LyricsLine,
  Syllable,
  WriteOptions,
} from "../../types";
import {
  escapeAttr,
  escapeText,
  itunesUri,
  ttmlUri,
  ttmUri,
  validLanguage,
  writeTime,
} from "./profile";

function checkTrack(
  syllables: Syllable[],
  line: LyricsLine,
  lineTimed: boolean,
  label: string
) {
  if (lineTimed && syllables.length > 1) {
    throw new Error(`ttml line timing cannot preserve ${label}`);
  }
  for (const syllable of syllables) {
    checkTime(syllable.begin, `syllable ${syllable.id} start`);
    checkTime(syllable.end, `syllable ${syllable.id} end`);
    if (syllable.end <= syllable.begin) {
      throw new RangeError(`syllable ${syllable.id} end must follow its start`);
    }
    if (syllable.begin < line.begin || syllable.end > line.end) {
      throw new RangeError(
        `syllable ${syllable.id} must stay within line ${line.id}`
      );
    }
    if (
      lineTimed &&
      (syllable.begin !== line.begin || syllable.end !== line.end)
    ) {
      throw new Error(`ttml line timing cannot preserve ${label} range`);
    }
  }
}

function checkMaps(line: LyricsLine, lineTimed: boolean) {
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
    if (!validLanguage(language)) {
      throw new Error(`invalid ttml pronunciation language ${language}`);
    }
    checkTrack(pronunciation.p, line, lineTimed, language);
    checkTrack(
      pronunciation.b,
      line,
      lineTimed,
      `${language} backing pronunciation`
    );
  }
  for (const language of Object.keys(line.translations ?? {})) {
    if (!validLanguage(language)) {
      throw new Error(`invalid ttml translation language ${language}`);
    }
  }
}

function createdByLanguage(
  tracks: Array<Record<string, { automaticallyCreated?: boolean }> | undefined>,
  label: string
) {
  const byLanguage = new Map<string, boolean | undefined>();
  for (const track of tracks) {
    for (const [language, textTrack] of Object.entries(track ?? {})) {
      const created = textTrack.automaticallyCreated;
      if (byLanguage.has(language) && byLanguage.get(language) !== created) {
        throw new Error(
          `ttml ${language} ${label} has inconsistent automaticallyCreated values`
        );
      }
      byLanguage.set(language, created);
    }
  }
  return byLanguage;
}

function createdAttr(created: boolean | undefined) {
  return created === undefined ? "" : ` automaticallyCreated="${created}"`;
}

function kindsByLanguage(doc: LyricsDocument) {
  const kinds = new Map<string, "subtitle" | "replacement">();
  for (const line of doc.lines) {
    for (const [language, translation] of Object.entries(
      line.translations ?? {}
    )) {
      const kind = translation.kind ?? "subtitle";
      if (kinds.has(language) && kinds.get(language) !== kind) {
        throw new Error(
          `ttml ${language} translation kind must be consistent across lines`
        );
      }
      kinds.set(language, kind);
    }
  }
  return kinds;
}

function checkIds(ids: string[], label: string) {
  if (ids.some((id, index) => id.length === 0 || ids.indexOf(id) !== index)) {
    throw new Error(`ttml ${label} must be nonempty and unique`);
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
    checkMaps(line, doc.timing === "line");
  }
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
  if (
    doc.meta.title !== undefined ||
    doc.meta.artist !== undefined ||
    doc.meta.album !== undefined
  ) {
    throw new Error("ttml cannot represent title, artist, or album metadata");
  }
  if (doc.meta.songwriters?.length === 0) {
    throw new Error("ttml cannot preserve an empty songwriter list");
  }
  const agentIds = doc.agents.map((agent) => agent.id);
  checkIds(agentIds, "agent ids");
  checkIds(
    doc.lines.map((line) => line.id),
    "line ids"
  );
  createdByLanguage(
    doc.lines.map((line) => line.translations),
    "translation track"
  );
  kindsByLanguage(doc);
  createdByLanguage(
    doc.lines.map((line) => line.pronunciations),
    "pronunciation track"
  );
  checkLines(doc, agentIds);
}

function writeTrack(syllables: Syllable[], lineTimed: boolean, wrap: boolean) {
  if (lineTimed) {
    const lyric = syllables.map((syllable) => syllable.text).join("");
    return escapeText(wrap && syllables.length > 0 ? `(${lyric})` : lyric);
  }
  return syllables
    .map((syllable, index) => {
      const opening = wrap && index === 0 ? "(" : "";
      const closing = wrap && index === syllables.length - 1 ? ")" : "";
      return `<span begin="${writeTime(syllable.begin)}" end="${writeTime(syllable.end)}">${escapeText(opening + syllable.text + closing)}</span>`;
    })
    .join("");
}

function writeTranslations(doc: LyricsDocument) {
  const languages = createdByLanguage(
    doc.lines.map((line) => line.translations),
    "translation track"
  );
  const kinds = kindsByLanguage(doc);
  return [...kinds]
    .map(([language, kind]) => {
      const translated = doc.lines.flatMap((line) => {
        const translation = line.translations?.[language];
        if (!translation) {
          return [];
        }
        return [{ line, translation }];
      });
      const automatic = createdAttr(languages.get(language));
      const texts = translated.map(({ line, translation }) => {
        const backing =
          translation.b === undefined
            ? ""
            : `<span ttm:role="x-bg">(${escapeText(translation.b)})</span>`;
        return `<text for="${escapeAttr(line.id)}">${escapeText(translation.p)}${backing}</text>`;
      });
      return `<translation type="${kind}" xml:lang="${escapeAttr(language)}"${automatic}>${texts.join("")}</translation>`;
    })
    .join("");
}

function writeProns(doc: LyricsDocument) {
  const languages = createdByLanguage(
    doc.lines.map((line) => line.pronunciations),
    "pronunciation track"
  );
  return [...languages]
    .map(([language, created]) => {
      const pronounced = doc.lines.flatMap((line) => {
        const pronunciation = line.pronunciations?.[language];
        if (!pronunciation) {
          return [];
        }
        return [{ line, pronunciation }];
      });
      const automatic = createdAttr(created);
      const texts = pronounced.map(({ line, pronunciation }) => {
        const primary = writeTrack(
          pronunciation.p,
          doc.timing === "line",
          false
        );
        const backing =
          pronunciation.b.length === 0
            ? ""
            : `<span ttm:role="x-bg">${writeTrack(pronunciation.b, doc.timing === "line", true)}</span>`;
        return `<text for="${escapeAttr(line.id)}">${primary}${backing}</text>`;
      });
      return `<transliteration xml:lang="${escapeAttr(language)}"${automatic}>${texts.join("")}</transliteration>`;
    })
    .join("");
}

function writeBody(doc: LyricsDocument) {
  const duration =
    doc.lines.length === 0 ? 0 : Math.max(...doc.lines.map((line) => line.end));
  if (doc.lines.length === 0) {
    return `<body dur="${writeTime(duration)}"><div/></body>`;
  }
  const begin = Math.min(...doc.lines.map((line) => line.begin));
  const paragraphs = doc.lines
    .map((line) => {
      const agent =
        line.agent === null ? "" : ` ttm:agent="${escapeAttr(line.agent)}"`;
      const primary = writeTrack(line.p, doc.timing === "line", false);
      const backing =
        line.b.length === 0
          ? ""
          : `<span ttm:role="x-bg">${writeTrack(line.b, doc.timing === "line", true)}</span>`;
      return `<p begin="${writeTime(line.begin)}" end="${writeTime(line.end)}" itunes:key="${escapeAttr(line.id)}"${agent}>${primary}${backing}</p>`;
    })
    .join("");
  return `<body dur="${writeTime(duration)}"><div begin="${writeTime(begin)}" end="${writeTime(duration)}">${paragraphs}</div></body>`;
}

export function write(doc: LyricsDocument, options: WriteOptions = {}): string {
  if (Object.keys(options).length > 0) {
    throw new Error("ttml write options are unsupported");
  }
  checkDoc(doc);
  const agents = doc.agents
    .map(
      (agent) =>
        `<ttm:agent type="${escapeAttr(agent.type)}" xml:id="${escapeAttr(agent.id)}"/>`
    )
    .join("");
  const translations = writeTranslations(doc);
  const prons = writeProns(doc);
  const songwriters = (doc.meta.songwriters ?? [])
    .map((writer) => `<songwriter>${escapeText(writer)}</songwriter>`)
    .join("");
  const transliterations =
    prons.length === 0 ? "" : `<transliterations>${prons}</transliterations>`;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<tt xmlns="${ttmlUri}" xmlns:itunes="${itunesUri}" xmlns:ttm="${ttmUri}" itunes:timing="${doc.timing === "word" ? "Word" : "Line"}" xml:lang="und">`,
    `<head><metadata>${agents}<iTunesMetadata xmlns="${itunesUri}"><translations>${translations}</translations>${transliterations}<songwriters>${songwriters}</songwriters></iTunesMetadata></metadata></head>`,
    writeBody(doc),
    "</tt>",
  ].join("\n");
}
