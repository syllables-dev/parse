import { ParseError } from "@/errors";
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
  ttmlUri,
  ttmUri,
} from "@/formats/ttml/profile";
import type { XmlElement, XmlNode } from "@/internal/xml";
import type {
  LyricsDocument,
  LyricsLine,
  LyricsSection,
  Syllable,
} from "@/types";

interface Runs {
  backing: BackingRun | null;
  primary: XmlNode[];
}

interface BackingRun {
  keepParentheses: boolean;
  nodes: XmlNode[];
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

function checkSpan(element: XmlElement) {
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
}

function keepsParentheses(nodes: XmlNode[]): boolean {
  return nodes.some(
    (node) =>
      node.kind === "element" &&
      (attr(node, "parenthesis", itunesUri) === "keep" ||
        keepsParentheses(node.children))
  );
}

export function splitRuns(parent: XmlElement): Runs {
  const primary: XmlNode[] = [];
  let backing: BackingRun | null = null;
  for (const child of parent.children) {
    if (child.kind === "element" && role(child) === "x-bg") {
      if (!isSpan(child) || backing !== null) {
        throw new ParseError("ttml lines support one backing-vocal span");
      }
      checkSpan(child);
      const nodes =
        attr(child, "begin", null) === undefined ? child.children : [child];
      backing = {
        keepParentheses:
          attr(child, "parenthesis", itunesUri) === "keep" ||
          keepsParentheses(nodes),
        nodes,
      };
    } else {
      primary.push(child);
    }
  }
  return { backing, primary };
}

function readWord(
  element: XmlElement,
  offset: number,
  idPrefix: string,
  inheritedAgent: string | null,
  agentIds: Set<string>,
  wordIndex: number,
  leading: string,
  lineTimed: boolean,
  fallbackBegin: number,
  fallbackEnd: number
) {
  checkSpan(element);
  const id = `${idPrefix}${wordIndex}`;
  const begin = attr(element, "begin", null);
  const end = attr(element, "end", null);
  if ((begin === undefined) !== (end === undefined)) {
    throw new ParseError(`syllable ${id} requires begin and end together`);
  }
  const range =
    begin === undefined
      ? { begin: fallbackBegin, end: fallbackEnd }
      : readRange(element, offset, `syllable ${id}`, true);
  const agent = agentRef(element, inheritedAgent, agentIds);
  const xmlId = attr(element, "id", "http://www.w3.org/XML/1998/namespace");
  const word = {
    ...(agent === null || agent === inheritedAgent ? {} : { agent }),
    ...range,
    id,
    ...(attr(element, "parenthesis", itunesUri) === "keep"
      ? { keepParentheses: true }
      : {}),
    ...(role(element) === undefined ? {} : { role: role(element) }),
    ...(lineTimed && begin !== undefined ? { timed: true } : {}),
    ...(xmlId === undefined ? {} : { xmlId }),
  };
  const content: Syllable["content"] = leading.length === 0 ? [] : [leading];
  let lyric = leading;
  let childIndex = 0;
  for (const child of element.children) {
    if (child.kind === "text") {
      const previous = content.at(-1);
      if (typeof previous === "string") {
        content[content.length - 1] = previous + child.text;
      } else {
        content.push(child.text);
      }
      lyric += child.text;
    } else {
      const subword = readWord(
        child,
        offset,
        `${id}s`,
        agent,
        agentIds,
        childIndex,
        "",
        lineTimed,
        fallbackBegin,
        fallbackEnd
      );
      content.push(subword);
      lyric += subword.text;
      childIndex += 1;
    }
  }
  const nested = content.some((part) => typeof part !== "string");
  return {
    ...word,
    ...(nested ? { content } : {}),
    text: lyric,
  };
}

export function readWords(
  nodes: XmlNode[],
  begin: number,
  end: number,
  offset: number,
  idPrefix: string,
  lineAgent: string | null,
  agentIds: Set<string>,
  lineTimed = false
) {
  const syllables: Syllable[] = [];
  let loose = "";
  for (const child of nodes) {
    if (child.kind === "text") {
      const last = syllables.at(-1);
      if (last) {
        last.text += child.text;
        if (last.content) {
          const previous = last.content.at(-1);
          if (typeof previous === "string") {
            last.content[last.content.length - 1] = previous + child.text;
          } else {
            last.content.push(child.text);
          }
        }
      } else {
        loose += child.text;
      }
      continue;
    }
    syllables.push(
      readWord(
        child,
        offset,
        idPrefix,
        lineAgent,
        agentIds,
        syllables.length,
        loose,
        lineTimed,
        begin,
        end
      )
    );
    loose = "";
  }
  return syllables.length === 0 && loose.length > 0
    ? [{ begin, end, id: `${idPrefix}0`, text: loose }]
    : syllables;
}

export function unwrap(syllables: Syllable[], keepParentheses = false) {
  const lyric = syllables.map((syllable) => syllable.text).join("");
  if (!(lyric.startsWith("(") && lyric.endsWith(")"))) {
    throw new ParseError("ttml backing vocals require wrapping parentheses");
  }
  if (keepParentheses) {
    return syllables;
  }
  const first = syllables.findIndex((syllable) => syllable.text.length > 0);
  const last = syllables.findLastIndex((syllable) => syllable.text.length > 0);
  return syllables.map((syllable, index) => {
    const start = index === first;
    const end = index === last;
    return trimWord(syllable, start, end);
  });
}

function trimWord(syllable: Syllable, start: boolean, end: boolean): Syllable {
  const text = syllable.text.slice(start ? 1 : 0, end ? -1 : undefined);
  if (syllable.content === undefined) {
    return { ...syllable, text };
  }
  const content = [...syllable.content];
  for (const atStart of [true, false]) {
    if ((atStart && !start) || !(atStart || end)) {
      continue;
    }
    const index = atStart
      ? content.findIndex((part) => typeof part !== "string" || part.length > 0)
      : content.findLastIndex(
          (part) => typeof part !== "string" || part.length > 0
        );
    const entry = content[index];
    if (entry === undefined) {
      throw new ParseError("ttml backing text has no wrapping parentheses");
    }
    if (typeof entry === "string") {
      content[index] = atStart ? entry.slice(1) : entry.slice(0, -1);
    } else {
      content[index] = trimWord(entry, atStart, !atStart);
    }
  }
  const kept = content.filter(
    (part, index) =>
      typeof part !== "string" ||
      part.length > 0 ||
      (index > 0 && index < content.length - 1)
  );
  return {
    ...syllable,
    content: kept,
    text,
  };
}

export function untimed(nodes: XmlNode[]) {
  let lyric = "";
  for (const child of nodes) {
    if (child.kind === "text") {
      lyric += child.text;
      continue;
    }
    checkSpan(child);
    if (
      attr(child, "begin", null) !== undefined ||
      attr(child, "end", null) !== undefined
    ) {
      throw new ParseError("line-timed text cannot carry syllable timestamps");
    }
    lyric += untimed(child.children);
  }
  return lyric;
}

export function checkTrack(
  syllables: Syllable[],
  line: Pick<LyricsLine, "begin" | "end" | "id">
) {
  const outside = syllables.find(
    (syllable) => syllable.begin < line.begin || syllable.end > line.end
  );
  if (outside) {
    throw new ParseError(
      `ttml syllable ${outside.id} falls outside line ${line.id}`
    );
  }
}

function readTrack(
  nodes: XmlNode[],
  line: Pick<LyricsLine, "begin" | "end" | "agent">,
  timing: "line" | "word",
  offset: number,
  idPrefix: string,
  agentIds: Set<string>
) {
  if (timing === "word") {
    return readWords(
      nodes,
      line.begin,
      line.end,
      offset,
      idPrefix,
      line.agent,
      agentIds
    );
  }
  if (nodes.some((node) => node.kind === "element")) {
    return readWords(
      nodes,
      line.begin,
      line.end,
      offset,
      idPrefix,
      line.agent,
      agentIds,
      true
    );
  }
  const lyric = untimed(nodes);
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
  const roleValue = role(paragraph);
  const runs =
    roleValue === "x-bg"
      ? {
          backing: {
            keepParentheses:
              attr(paragraph, "parenthesis", itunesUri) === "keep" ||
              keepsParentheses(paragraph.children),
            nodes: paragraph.children,
          },
          primary: [],
        }
      : splitRuns(paragraph);
  const line = { agent, ...range };
  const lyricLine = {
    agent,
    b:
      runs.backing === null
        ? []
        : unwrap(
            readTrack(
              runs.backing.nodes,
              line,
              timing,
              offset,
              `${id}b`,
              agentIds
            ),
            runs.backing.keepParentheses
          ),
    ...range,
    id,
    ...(attr(paragraph, "parenthesis", itunesUri) === "keep"
      ? { keepParentheses: true }
      : {}),
    p: readTrack(runs.primary, line, timing, offset, `${id}w`, agentIds),
    ...(roleValue === undefined ? {} : { role: roleValue }),
    ...(attr(paragraph, "id", "http://www.w3.org/XML/1998/namespace") ===
    undefined
      ? {}
      : {
          xmlId: attr(paragraph, "id", "http://www.w3.org/XML/1998/namespace"),
        }),
  };
  if (lyricLine.p.length === 0 && lyricLine.b.length > 0) {
    throw new ParseError(
      `ttml backing track requires primary text on line ${id}`
    );
  }
  checkTrack(lyricLine.p, lyricLine);
  checkTrack(lyricLine.b, lyricLine);
  return lyricLine;
}

function readDiv(
  division: XmlElement,
  firstIndex: number,
  timing: "line" | "word",
  inheritedAgent: string | null,
  agentIds: Set<string>,
  offset: number
): { lines: LyricsLine[]; section: LyricsSection } {
  if (!is(division, "div", ttmlUri)) {
    throw new ParseError(`unsupported body element <${division.name}>`);
  }
  checkAttrs(division, [
    key(null, "begin"),
    key(null, "end"),
    key(ttmUri, "agent"),
    key(null, "role"),
    key(ttmUri, "role"),
    key(itunesUri, "parenthesis"),
    key(itunesUri, "songPart"),
  ]);
  const paragraphs = elements(division);
  const beginText = attr(division, "begin", null);
  const endText = attr(division, "end", null);
  if (
    (beginText === undefined) !== (endText === undefined) ||
    (paragraphs.length > 0 && beginText === undefined)
  ) {
    throw new ParseError(
      "populated ttml divisions require begin and end times"
    );
  }
  const range =
    beginText === undefined
      ? undefined
      : readRange(division, 0, "ttml division");
  const divAgent = agentRef(division, inheritedAgent, agentIds);
  const lines = paragraphs.map((paragraph, index) => {
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
  const roleValue = role(division);
  const xmlId = attr(division, "id", "http://www.w3.org/XML/1998/namespace");
  const part = attr(division, "songPart", itunesUri);
  return {
    lines,
    section: {
      ...(divAgent === inheritedAgent ? {} : { agent: divAgent ?? undefined }),
      ...(range === undefined ? {} : range),
      lines: lines.map((line) => line.id),
      ...(part === undefined ? {} : { part }),
      ...(attr(division, "parenthesis", itunesUri) === "keep"
        ? { keepParentheses: true }
        : {}),
      ...(roleValue === undefined ? {} : { role: roleValue }),
      ...(xmlId === undefined ? {} : { xmlId }),
    },
  };
}

export function readBody(
  body: XmlElement,
  timing: "line" | "word",
  agents: LyricsDocument["agents"],
  offset: number,
  rootAgent: string | undefined
) {
  checkAttrs(body, [
    key(null, "dur"),
    key(ttmUri, "agent"),
    key(null, "role"),
    key(ttmUri, "role"),
  ]);
  const duration = readTime(needAttr(body, "dur", null), "ttml duration");
  const agentIds = new Set(agents.map((agent) => agent.id));
  const bodyAgent = agentRef(body, rootAgent ?? null, agentIds);
  const lines: LyricsLine[] = [];
  const sections: LyricsSection[] = [];
  for (const division of elements(body)) {
    const parsed = readDiv(
      division,
      lines.length,
      timing,
      bodyAgent,
      agentIds,
      offset
    );
    lines.push(...parsed.lines);
    sections.push(parsed.section);
  }
  const ids = lines.map((line) => line.id);
  if (ids.some((id, index) => id.length === 0 || ids.indexOf(id) !== index)) {
    throw new ParseError("ttml line keys must be nonempty and unique");
  }
  if (lines.some((line) => line.end > duration)) {
    throw new ParseError("ttml body duration ends before its lyrics");
  }
  const roleValue = role(body);
  const xmlId = attr(body, "id", "http://www.w3.org/XML/1998/namespace");
  const defaultBegin =
    lines.length === 0
      ? undefined
      : Math.min(...lines.map((line) => line.begin));
  const defaultDuration =
    lines.length === 0 ? 0 : Math.max(...lines.map((line) => line.end));
  const [section] = sections;
  const standardSection =
    section !== undefined &&
    sections.length === 1 &&
    (lines.length === 0 ||
      (section.begin === defaultBegin && section.end === duration)) &&
    section.lines.every((id, index) => id === lines[index]?.id) &&
    section.lines.length === lines.length &&
    section.agent === undefined &&
    section.keepParentheses === undefined &&
    section.part === undefined &&
    section.role === undefined &&
    section.xmlId === undefined;
  const bodyFields = {
    ...(bodyAgent === (rootAgent ?? null)
      ? {}
      : { agent: bodyAgent ?? undefined }),
    ...(duration === defaultDuration ? {} : { duration }),
    ...(roleValue === undefined ? {} : { role: roleValue }),
    ...(xmlId === undefined ? {} : { xmlId }),
  };
  const apple = {
    ...(Object.keys(bodyFields).length === 0 ? {} : { body: bodyFields }),
    ...(standardSection ? {} : { sections }),
  };
  return {
    ...(Object.keys(apple).length === 0 ? {} : { apple }),
    lines,
  };
}
