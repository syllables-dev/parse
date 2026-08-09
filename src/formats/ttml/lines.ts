import { ParseError } from "../../errors";
import type { XmlElement, XmlNode } from "../../internal/xml";
import type { LyricsDocument, LyricsLine, Syllable } from "../../types";
import {
  attr,
  checkAttrs,
  elements,
  is,
  itunesUri,
  key,
  needAttr,
  readRange,
  readTime,
  text,
  ttmlUri,
  ttmUri,
} from "./profile";

interface Runs {
  backing: XmlNode[] | null;
  primary: XmlNode[];
}

function isSpan(element: XmlElement) {
  return (
    element.local === "span" &&
    (element.uri === ttmlUri || element.uri === itunesUri)
  );
}

function role(element: XmlElement) {
  const namespaced = attr(element, "role", ttmUri);
  const plain = attr(element, "role", null);
  if (namespaced !== undefined && plain !== undefined && namespaced !== plain) {
    throw new ParseError(`conflicting roles on <${element.name}>`);
  }
  const value = namespaced ?? plain;
  if (value !== undefined && value !== "x-bg") {
    throw new ParseError(`unsupported ttml role ${value}`);
  }
  return value;
}

function agentRef(
  element: XmlElement,
  inherited: string | null,
  agentIds: Set<string>
) {
  const value = attr(element, "agent", ttmUri) ?? inherited;
  if (value !== null && !agentIds.has(value)) {
    throw new ParseError(`unknown ttml agent ${value}`);
  }
  return value;
}

function checkSpan(element: XmlElement, lineAgent: string | null) {
  if (!isSpan(element)) {
    throw new ParseError(`unsupported lyric element <${element.name}>`);
  }
  checkAttrs(element, [
    key(null, "begin"),
    key(null, "end"),
    key(null, "role"),
    key(ttmUri, "agent"),
    key(ttmUri, "role"),
    key(itunesUri, "parenthesis"),
  ]);
  role(element);
  const explicit = attr(element, "agent", ttmUri);
  if (explicit !== undefined && explicit !== lineAgent) {
    throw new ParseError("ttml cannot preserve a syllable-level agent change");
  }
}

export function splitRuns(parent: XmlElement, lineAgent: string | null): Runs {
  const primary: XmlNode[] = [];
  let backing: XmlNode[] | null = null;
  for (const child of parent.children) {
    if (child.kind === "element" && role(child) === "x-bg") {
      if (!isSpan(child) || backing !== null) {
        throw new ParseError("ttml lines support one backing-vocal span");
      }
      checkSpan(child, lineAgent);
      backing =
        attr(child, "begin", null) === undefined ? child.children : [child];
    } else {
      primary.push(child);
    }
  }
  return { backing, primary };
}

function addText(
  value: string,
  syllables: Syllable[],
  first: number,
  loose: string
) {
  const last = syllables.length > first ? syllables.at(-1) : undefined;
  if (last) {
    last.text += value;
  }
  return last ? loose : loose + value;
}

function readNested(
  element: XmlElement,
  offset: number,
  idPrefix: string,
  lineAgent: string | null,
  syllables: Syllable[],
  leading: string
) {
  const first = syllables.length;
  let loose = leading;
  for (const child of element.children) {
    if (child.kind === "text") {
      loose = addText(child.text, syllables, first, loose);
    } else {
      readWord(child, offset, idPrefix, lineAgent, syllables, loose);
      loose = "";
    }
  }
}

function readWord(
  element: XmlElement,
  offset: number,
  idPrefix: string,
  lineAgent: string | null,
  syllables: Syllable[],
  leading: string
) {
  checkSpan(element, lineAgent);
  const id = `${idPrefix}${syllables.length}`;
  const range = readRange(element, offset, `syllable ${id}`);
  if (element.children.every((child) => child.kind === "text")) {
    syllables.push({ ...range, id, text: leading + text(element) });
    return;
  }
  readNested(element, offset, idPrefix, lineAgent, syllables, leading);
}

export function readWords(
  nodes: XmlNode[],
  begin: number,
  end: number,
  offset: number,
  idPrefix: string,
  lineAgent: string | null
) {
  const syllables: Syllable[] = [];
  let loose = "";
  for (const child of nodes) {
    if (child.kind === "text") {
      loose = addText(child.text, syllables, 0, loose);
      continue;
    }
    readWord(child, offset, idPrefix, lineAgent, syllables, loose);
    loose = "";
  }
  return syllables.length === 0 && loose.length > 0
    ? [{ begin, end, id: `${idPrefix}0`, text: loose }]
    : syllables;
}

export function unwrap(syllables: Syllable[]) {
  const lyric = syllables.map((syllable) => syllable.text).join("");
  if (!(lyric.startsWith("(") && lyric.endsWith(")"))) {
    throw new ParseError("ttml backing vocals require wrapping parentheses");
  }
  const first = syllables.findIndex((syllable) => syllable.text.length > 0);
  const last = syllables.findLastIndex((syllable) => syllable.text.length > 0);
  return syllables.map((syllable, index) => {
    const from = index === first ? 1 : 0;
    const to = index === last ? -1 : undefined;
    return { ...syllable, text: syllable.text.slice(from, to) };
  });
}

export function untimed(nodes: XmlNode[], lineAgent: string | null) {
  let lyric = "";
  for (const child of nodes) {
    if (child.kind === "text") {
      lyric += child.text;
      continue;
    }
    checkSpan(child, lineAgent);
    if (
      attr(child, "begin", null) !== undefined ||
      attr(child, "end", null) !== undefined
    ) {
      throw new ParseError("line-timed text cannot carry syllable timestamps");
    }
    lyric += untimed(child.children, lineAgent);
  }
  return lyric;
}

export function unwrapText(lyric: string) {
  if (!(lyric.startsWith("(") && lyric.endsWith(")"))) {
    throw new ParseError("ttml backing text requires wrapping parentheses");
  }
  return lyric.slice(1, -1);
}

function readTrack(
  nodes: XmlNode[],
  line: Pick<LyricsLine, "begin" | "end" | "agent">,
  timing: "line" | "word",
  offset: number,
  idPrefix: string
) {
  if (timing === "word") {
    return readWords(nodes, line.begin, line.end, offset, idPrefix, line.agent);
  }
  const lyric = untimed(nodes, line.agent);
  return lyric.length === 0
    ? []
    : [{ begin: line.begin, end: line.end, id: `${idPrefix}0`, text: lyric }];
}

function readLine(
  paragraph: XmlElement,
  lineIndex: number,
  timing: "line" | "word",
  inheritedAgent: string | null,
  agentIds: Set<string>,
  offset: number
): LyricsLine {
  checkAttrs(paragraph, [
    key(null, "begin"),
    key(null, "end"),
    key(null, "role"),
    key(ttmUri, "agent"),
    key(ttmUri, "role"),
    key(itunesUri, "key"),
    key(itunesUri, "parenthesis"),
  ]);
  const id = attr(paragraph, "key", itunesUri) ?? `L${lineIndex + 1}`;
  const agent = agentRef(paragraph, inheritedAgent, agentIds);
  const range = readRange(paragraph, offset, `line ${id}`);
  const runs =
    role(paragraph) === "x-bg"
      ? { backing: paragraph.children, primary: [] }
      : splitRuns(paragraph, agent);
  const line = { agent, ...range };
  return {
    agent,
    b:
      runs.backing === null
        ? []
        : unwrap(readTrack(runs.backing, line, timing, offset, `${id}b`)),
    ...range,
    id,
    p: readTrack(runs.primary, line, timing, offset, `${id}w`),
  };
}

function readDivRange(division: XmlElement, populated: boolean) {
  const beginText = attr(division, "begin", null);
  const endText = attr(division, "end", null);
  if (
    (beginText === undefined) !== (endText === undefined) ||
    (populated && beginText === undefined)
  ) {
    throw new ParseError(
      "populated ttml divisions require begin and end times"
    );
  }
  if (beginText !== undefined && endText !== undefined) {
    const begin = readTime(beginText, "ttml division start");
    const end = readTime(endText, "ttml division end");
    if (end <= begin) {
      throw new ParseError("ttml division end must follow its start");
    }
  }
}

function readDiv(
  division: XmlElement,
  firstIndex: number,
  timing: "line" | "word",
  inheritedAgent: string | null,
  agentIds: Set<string>,
  offset: number
) {
  if (!is(division, "div", ttmlUri)) {
    throw new ParseError(`unsupported body element <${division.name}>`);
  }
  checkAttrs(division, [
    key(null, "begin"),
    key(null, "end"),
    key(ttmUri, "agent"),
    key(itunesUri, "songPart"),
  ]);
  const paragraphs = elements(division);
  readDivRange(division, paragraphs.length > 0);
  const divAgent = agentRef(division, inheritedAgent, agentIds);
  return paragraphs.map((paragraph, index) => {
    if (!is(paragraph, "p", ttmlUri)) {
      throw new ParseError(`unsupported division element <${paragraph.name}>`);
    }
    return readLine(
      paragraph,
      firstIndex + index,
      timing,
      divAgent,
      agentIds,
      offset
    );
  });
}

function checkLines(lines: LyricsLine[], duration: number, offset: number) {
  const ids = lines.map((line) => line.id);
  if (ids.some((id, index) => id.length === 0 || ids.indexOf(id) !== index)) {
    throw new ParseError("ttml line keys must be nonempty and unique");
  }
  if (lines.some((line) => line.end + offset > duration)) {
    throw new ParseError("ttml body duration ends before its lyrics");
  }
}

export function readBody(
  body: XmlElement,
  timing: "line" | "word",
  agents: LyricsDocument["agents"],
  offset: number
) {
  checkAttrs(body, [key(null, "dur"), key(ttmUri, "agent")]);
  const duration = readTime(needAttr(body, "dur", null), "ttml duration");
  const agentIds = new Set(agents.map((agent) => agent.id));
  const bodyAgent = agentRef(body, null, agentIds);
  const lines: LyricsLine[] = [];
  for (const division of elements(body)) {
    lines.push(
      ...readDiv(division, lines.length, timing, bodyAgent, agentIds, offset)
    );
  }
  checkLines(lines, duration, offset);
  return lines;
}
