import { ParseError } from "../../errors";
import { toInt } from "../../internal/timestamps";
import type { XmlElement } from "../../internal/xml";

const xmlnsUri = "http://www.w3.org/2000/xmlns/";
const clockPattern = /^(?:(\d+):)?(\d+)(?:\.(\d{1,3}))?$/u;
const languagePattern = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u;
const nonSpace = /\S/u;

export const ttmlUri = "http://www.w3.org/ns/ttml";
export const ttmUri = "http://www.w3.org/ns/ttml#metadata";
export const itunesUri = "http://music.apple.com/lyric-ttml-internal";
export const xmlUri = "http://www.w3.org/XML/1998/namespace";

export function key(uri: string | null, local: string) {
  return `${uri ?? ""}|${local}`;
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

export function checkAttrs(element: XmlElement, allowed: string[]) {
  for (const candidate of element.attrs) {
    if (
      candidate.uri !== xmlnsUri &&
      !(candidate.uri === xmlUri && candidate.local === "id") &&
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
  if (!clockPattern.test(value)) {
    throw new ParseError(`${label} has an invalid timestamp`);
  }
  const colon = value.indexOf(":");
  const dot = value.indexOf(".");
  const minutes = colon < 0 ? 0 : toInt(value.slice(0, colon), label);
  const seconds = toInt(
    value.slice(colon + 1, dot < 0 ? value.length : dot),
    label
  );
  if (colon >= 0 && seconds > 59) {
    throw new ParseError(`${label} seconds must be less than 60`);
  }
  const millis =
    dot < 0 ? 0 : toInt(value.slice(dot + 1).padEnd(3, "0"), label);
  const stamp = minutes * 60_000 + seconds * 1000 + millis;
  if (!Number.isSafeInteger(stamp)) {
    throw new ParseError(`${label} exceeds the safe integer range`);
  }
  return stamp;
}

export function readOffset(value: string) {
  const sign = value.charAt(0);
  return (
    (sign === "-" ? -1 : 1) *
    readTime(
      sign === "-" || sign === "+" ? value.slice(1) : value,
      "ttml lyric offset"
    )
  );
}

export function readRange(element: XmlElement, offset: number, label: string) {
  const begin = readTime(needAttr(element, "begin", null), `${label} start`);
  const end = readTime(needAttr(element, "end", null), `${label} end`);
  if (end <= begin) {
    throw new ParseError(`${label} end must follow its start`);
  }
  return { begin: begin - offset, end: end - offset };
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

export function sourceTime(value: number, offset: number, label: string) {
  const source = value + offset;
  if (!(Number.isSafeInteger(source) && source >= 0)) {
    throw new RangeError(`${label} must resolve to a nonnegative safe integer`);
  }
  return source;
}

export function writeTime(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000);
  const remainder = milliseconds % 60_000;
  return `${minutes}:${Math.floor(remainder / 1000)
    .toString()
    .padStart(2, "0")}.${(remainder % 1000).toString().padStart(3, "0")}`;
}

export function writeOffset(milliseconds: number) {
  if (!Number.isSafeInteger(milliseconds)) {
    throw new RangeError("ttml lyric offset must be a safe integer");
  }
  const sign = milliseconds < 0 ? "-" : "";
  const magnitude = Math.abs(milliseconds);
  return `${sign}${Math.floor(magnitude / 1000)}.${(magnitude % 1000)
    .toString()
    .padStart(3, "0")}`;
}
