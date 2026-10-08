import { ParseError } from "@/errors";
import { toInt } from "@/internal/timestamps";
import type { XmlElement } from "@/internal/xml";

const clockPattern = /^(?:\d+:){0,2}\d+(?:\.\d+)?$/u;
const languagePattern = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u;
const nonSpace = /\S/u;

export const ttmlUri = "http://www.w3.org/ns/ttml";
export const ttmUri = "http://www.w3.org/ns/ttml#metadata";
export const itunesUri = "http://music.apple.com/lyric-ttml-internal";
export const xmlUri = "http://www.w3.org/XML/1998/namespace";

export function key(uri: string | null, local: string) {
  return `${uri === null ? "" : uri}|${local}`;
}

export function attr(element: XmlElement, local: string, uri: string | null) {
  return element.attrs.find(
    (candidate) => candidate.local === local && candidate.uri === uri
  )?.value;
}

export function needAttr(
  element: XmlElement,
  local: string,
  uri: string | null
) {
  const value = attr(element, local, uri);
  if (value === undefined) {
    throw new ParseError(`<${element.name}> requires ${local}`);
  }
  return value;
}

// foreign vocabularies such as ttp, tts, or a player's own are read past, not rejected
export function owned(uri: string | null) {
  return uri === null || uri === ttmlUri || uri === ttmUri || uri === itunesUri;
}

export function checkAttrs(element: XmlElement, allowed: string[]) {
  for (const candidate of element.attrs) {
    if (
      owned(candidate.uri) &&
      !allowed.includes(key(candidate.uri, candidate.local))
    ) {
      throw new ParseError(
        `unsupported ${candidate.name} on <${element.name}>`
      );
    }
  }
}

export function elements(parent: XmlElement) {
  const found: XmlElement[] = [];
  for (const child of parent.children) {
    if (child.kind === "text") {
      if (nonSpace.test(child.text)) {
        throw new ParseError(`unexpected text in <${parent.name}>`);
      }
    } else {
      found.push(child);
    }
  }
  return found;
}

export function is(element: XmlElement, local: string, uri: string) {
  return element.local === local && element.uri === uri;
}

export function only(parent: XmlElement, local: string, uri: string) {
  const matches = elements(parent).filter((child) => is(child, local, uri));
  const [match] = matches;
  if (matches.length !== 1 || !match) {
    throw new ParseError(`<${parent.name}> requires one <${local}>`);
  }
  return match;
}

export function text(element: XmlElement) {
  let content = "";
  for (const child of element.children) {
    if (child.kind === "element") {
      throw new ParseError(
        `unsupported child <${child.name}> in <${element.name}>`
      );
    }
    content += child.text;
  }
  return content;
}

export function readTime(value: string, label: string) {
  const clock = value.trim();
  if (!clockPattern.test(clock)) {
    throw new ParseError(`${label} has an invalid timestamp`);
  }
  const [whole = "", fraction = ""] = clock.split(".");
  const fields = whole.split(":").map((field) => toInt(field, label));
  if (fields.slice(1).some((field) => field > 59)) {
    throw new ParseError(`${label} clock components must be less than 60`);
  }
  const seconds = fields.reduce((total, field) => total * 60 + field, 0);
  // the document stores milliseconds; round finer source precision once
  const millis =
    Number(fraction.slice(0, 3).padEnd(3, "0")) +
    (Number(fraction[3] ?? "0") >= 5 ? 1 : 0);
  const stamp = seconds * 1000 + millis;
  if (!Number.isSafeInteger(stamp)) {
    throw new ParseError(`${label} exceeds the safe integer range`);
  }
  return stamp;
}

export function readRange(
  element: XmlElement,
  offset: number,
  label: string,
  allowEqual = false
) {
  const begin = shiftTime(
    readTime(needAttr(element, "begin", null), `${label} start`),
    offset,
    `${label} start`
  );
  const end = shiftTime(
    readTime(needAttr(element, "end", null), `${label} end`),
    offset,
    `${label} end`
  );
  if (end < begin || (!allowEqual && end === begin)) {
    throw new ParseError(`${label} end must follow its start`);
  }
  return { begin, end };
}

export function shiftTime(value: number, offset: number, label: string) {
  const shifted = value + offset;
  if (!(Number.isSafeInteger(shifted) && shifted >= 0)) {
    throw new ParseError(`${label} exceeds the timestamp range`);
  }
  return shifted;
}

export function locale(element: XmlElement) {
  const language = needAttr(element, "lang", xmlUri);
  if (!languagePattern.test(language)) {
    throw new ParseError(`invalid ttml language ${language}`);
  }
  return language;
}

export function validLanguage(language: string) {
  return languagePattern.test(language);
}

export function escapeText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeAttr(value: string) {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function writeTime(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000);
  const remainder = milliseconds % 60_000;
  return `${minutes}:${Math.floor(remainder / 1000)
    .toString()
    .padStart(2, "0")}.${(remainder % 1000).toString().padStart(3, "0")}`;
}
