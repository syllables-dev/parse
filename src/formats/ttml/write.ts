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
  sourceTime,
  ttmlUri,
  ttmUri,
  validLanguage,
  writeTime,
} from "./profile";

function checkTrack(
  syllables: Syllable[],
  line: LyricsLine,
  offset: number,
  lineTimed: boolean,
  label: string
) {
  if (lineTimed && syllables.length > 1) {
    throw new Error(`ttml line timing cannot preserve ${label}`);
  }
  for (const syllable of syllables) {
    const begin = sourceTime(
      syllable.begin,
      offset,
      `syllable ${syllable.id} start`
    );
    const end = sourceTime(syllable.end, offset, `syllable ${syllable.id} end`);
    if (end <= begin) {
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

function checkMaps(line: LyricsLine, lineTimed: boolean, offset: number) {
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
    checkTrack(pronunciation.p, line, offset, lineTimed, language);
    checkTrack(
      pronunciation.b,
      line,
      offset,
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

function checkIds(ids: string[], label: string) {
  if (ids.some((id, index) => id.length === 0 || ids.indexOf(id) !== index)) {
    throw new Error(`ttml ${label} must be nonempty and unique`);
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
  const offset = doc.meta.offset ?? 0;
  if (!Number.isSafeInteger(offset)) {
    throw new RangeError("ttml offset must be a safe integer");
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
  const knownAgents = new Set(agentIds);
  for (const line of doc.lines) {
    const begin = sourceTime(line.begin, offset, `line ${line.id} start`);
    const end = sourceTime(line.end, offset, `line ${line.id} end`);
    if (end <= begin) {
      throw new RangeError(`line ${line.id} end must follow its start`);
    }
    if (line.agent !== null && !knownAgents.has(line.agent)) {
      throw new Error(`line ${line.id} references an undeclared ttml agent`);
    }
    checkTrack(
      line.p,
      line,
      offset,
      doc.timing === "line",
      `line ${line.id} primary track`
    );
    checkTrack(
      line.b,
      line,
      offset,
      doc.timing === "line",
      `line ${line.id} backing track`
    );
    checkMaps(line, doc.timing === "line", offset);
  }
}

function writeTrack(
  syllables: Syllable[],
  offset: number,
  lineTimed: boolean,
  wrap: boolean
) {
  if (lineTimed) {
    const lyric = syllables.map((syllable) => syllable.text).join("");
    return escapeText(wrap && syllables.length > 0 ? `(${lyric})` : lyric);
  }
  return syllables
    .map((syllable, index) => {
      const opening = wrap && index === 0 ? "(" : "";
      const closing = wrap && index === syllables.length - 1 ? ")" : "";
      const begin = sourceTime(
        syllable.begin,
        offset,
        `syllable ${syllable.id} start`
      );
      const end = sourceTime(
        syllable.end,
        offset,
        `syllable ${syllable.id} end`
      );
      return `<span begin="${writeTime(begin)}" end="${writeTime(end)}">${escapeText(opening + syllable.text + closing)}</span>`;
    })
    .join("");
}

function writeTranslations(doc: LyricsDocument) {
  const languages = new Set(
    doc.lines.flatMap((line) => Object.keys(line.translations ?? {}))
  );
  return [...languages]
    .map((language) => {
      const texts = doc.lines.flatMap((line) => {
        const translation = line.translations?.[language];
        if (!translation) {
          return [];
        }
        const backing =
          translation.b === undefined
            ? ""
            : `<span ttm:role="x-bg">(${escapeText(translation.b)})</span>`;
        return [
          `<text for="${escapeAttr(line.id)}">${escapeText(translation.p)}${backing}</text>`,
        ];
      });
      return `<translation type="subtitle" xml:lang="${escapeAttr(language)}">${texts.join("")}</translation>`;
    })
    .join("");
}

function writeProns(doc: LyricsDocument, offset: number) {
  const languages = new Set(
    doc.lines.flatMap((line) => Object.keys(line.pronunciations ?? {}))
  );
  return [...languages]
    .map((language) => {
      const texts = doc.lines.flatMap((line) => {
        const pronunciation = line.pronunciations?.[language];
        if (!pronunciation) {
          return [];
        }
        const primary = writeTrack(
          pronunciation.p,
          offset,
          doc.timing === "line",
          false
        );
        const backing =
          pronunciation.b.length === 0
            ? ""
            : `<span ttm:role="x-bg">${writeTrack(pronunciation.b, offset, doc.timing === "line", true)}</span>`;
        return [
          `<text for="${escapeAttr(line.id)}">${primary}${backing}</text>`,
        ];
      });
      return `<transliteration xml:lang="${escapeAttr(language)}">${texts.join("")}</transliteration>`;
    })
    .join("");
}

function writeHead(doc: LyricsDocument, offset: number) {
  const agents = doc.agents
    .map(
      (agent) =>
        `<ttm:agent type="${escapeAttr(agent.type)}" xml:id="${escapeAttr(agent.id)}"/>`
    )
    .join("");
  const translations = writeTranslations(doc);
  const prons = writeProns(doc, offset);
  const songwriters = (doc.meta.songwriters ?? [])
    .map((writer) => `<songwriter>${escapeText(writer)}</songwriter>`)
    .join("");
  let audio = "";
  if (doc.meta.offset !== undefined) {
    const sign = offset < 0 ? "-" : "";
    const magnitude = Math.abs(offset);
    audio = `<audio lyricOffset="${sign}${Math.floor(magnitude / 1000)}.${(magnitude % 1000).toString().padStart(3, "0")}"/>`;
  }
  const transliterations =
    prons.length === 0 ? "" : `<transliterations>${prons}</transliterations>`;
  return `<head><metadata>${agents}<iTunesMetadata xmlns="${itunesUri}"><translations>${translations}</translations>${transliterations}<songwriters>${songwriters}</songwriters>${audio}</iTunesMetadata></metadata></head>`;
}

function writeBody(doc: LyricsDocument, offset: number) {
  const sourceEnds = doc.lines.map((line) =>
    sourceTime(line.end, offset, `line ${line.id} end`)
  );
  const duration = sourceEnds.length === 0 ? 0 : Math.max(...sourceEnds);
  if (doc.lines.length === 0) {
    return `<body dur="${writeTime(duration)}"><div/></body>`;
  }
  const begin = Math.min(
    ...doc.lines.map((line) =>
      sourceTime(line.begin, offset, `line ${line.id} start`)
    )
  );
  const paragraphs = doc.lines
    .map((line) => {
      const agent =
        line.agent === null ? "" : ` ttm:agent="${escapeAttr(line.agent)}"`;
      const primary = writeTrack(line.p, offset, doc.timing === "line", false);
      const backing =
        line.b.length === 0
          ? ""
          : `<span ttm:role="x-bg">${writeTrack(line.b, offset, doc.timing === "line", true)}</span>`;
      const lineBegin = sourceTime(line.begin, offset, `line ${line.id} start`);
      const lineEnd = sourceTime(line.end, offset, `line ${line.id} end`);
      return `<p begin="${writeTime(lineBegin)}" end="${writeTime(lineEnd)}" itunes:key="${escapeAttr(line.id)}"${agent}>${primary}${backing}</p>`;
    })
    .join("");
  return `<body dur="${writeTime(duration)}"><div begin="${writeTime(begin)}" end="${writeTime(duration)}">${paragraphs}</div></body>`;
}

export function write(doc: LyricsDocument, options: WriteOptions = {}): string {
  if (Object.keys(options).length > 0) {
    throw new Error("ttml write options are unsupported");
  }
  checkDoc(doc);
  const offset = doc.meta.offset ?? 0;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<tt xmlns="${ttmlUri}" xmlns:itunes="${itunesUri}" xmlns:ttm="${ttmUri}" itunes:timing="${doc.timing === "word" ? "Word" : "Line"}" xml:lang="und">`,
    writeHead(doc, offset),
    writeBody(doc, offset),
    "</tt>",
  ].join("\n");
}
