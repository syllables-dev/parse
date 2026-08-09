import { ParseError } from "../errors";

export interface XmlAttr {
  local: string;
  name: string;
  prefix: string | null;
  uri: string | null;
  value: string;
}

export interface XmlElement {
  attrs: XmlAttr[];
  children: XmlNode[];
  kind: "element";
  local: string;
  name: string;
  prefix: string | null;
  uri: string | null;
}

export interface XmlText {
  kind: "text";
  text: string;
}

export type XmlNode = XmlElement | XmlText;

interface RawAttr {
  at: number;
  name: string;
  value: string;
}

interface StartTag {
  attrs: XmlAttr[];
  closed: boolean;
  local: string;
  name: string;
  namespaces: Record<string, string>;
  prefix: string | null;
  uri: string | null;
}

const xmlUri = "http://www.w3.org/XML/1998/namespace";
const xmlnsUri = "http://www.w3.org/2000/xmlns/";
const nameStart = /[:\p{L}\p{Nl}_]/u;
const namePart = /[-.:\p{L}\p{Nl}\p{Nd}\p{Mc}\p{Mn}\p{Pc}\u00b7_]/u;
const xmlSpace = /[\t\n\r ]/u;
const declarationAttrs = /^(version)(,encoding)?(,standalone)?$/u;
const encodingName = /^[A-Za-z][A-Za-z0-9._-]*$/u;
const decimalDigits = /^\d+$/u;
const hexDigits = /^[\dA-Fa-f]+$/u;
const entities = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["quot", '"'],
]);

const isXmlChar = (code: number) =>
  code === 0x9 ||
  code === 0xa ||
  code === 0xd ||
  (code >= 0x20 && code <= 0xd7_ff) ||
  (code >= 0xe0_00 && code <= 0xff_fd) ||
  (code >= 0x1_00_00 && code <= 0x10_ff_ff);

class XmlReader {
  private at = 0;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
    let at = 0;
    while (at < source.length) {
      const first = source.charCodeAt(at);
      const paired = first >= 0xd8_00 && first <= 0xdb_ff;
      const second = paired ? source.charCodeAt(at + 1) : 0;
      const code = paired
        ? (first - 0xd8_00) * 0x4_00 + second - 0xdc_00 + 0x1_00_00
        : first;
      if (
        (paired && (second < 0xdc_00 || second > 0xdf_ff)) ||
        !isXmlChar(code)
      ) {
        this.fail("invalid character", at);
      }
      at += paired ? 2 : 1;
    }
  }

  read() {
    if (this.source.charCodeAt(0) === 0xfe_ff) {
      this.at = 1;
    }
    if (this.starts("<?xml") && xmlSpace.test(this.source[this.at + 5] ?? "")) {
      this.declaration();
    }
    this.misc();
    if (!this.starts("<") || this.starts("</") || this.starts("<!")) {
      this.fail("root element expected");
    }
    const root = this.element({ xml: xmlUri });
    this.misc();
    if (this.at !== this.source.length) {
      this.fail("content after root element");
    }
    return root;
  }

  private declaration() {
    this.at += 5;
    const attrs: RawAttr[] = [];
    for (;;) {
      const spaced = this.space();
      if (this.starts("?>")) {
        this.at += 2;
        break;
      }
      if (!spaced) {
        this.fail("space expected in XML declaration");
      }
      attrs.push(this.rawAttr());
    }
    const names = attrs.map((attr) => attr.name).join(",");
    if (!declarationAttrs.test(names)) {
      this.fail("invalid XML declaration", attrs[0]?.at);
    }
    if (attrs[0]?.value !== "1.0") {
      this.fail("unsupported XML version", attrs[0]?.at);
    }
    if (attrs[1]?.name === "encoding" && !encodingName.test(attrs[1].value)) {
      this.fail("invalid XML encoding", attrs[1].at);
    }
    const standalone = attrs.find((attr) => attr.name === "standalone");
    if (standalone && standalone.value !== "yes" && standalone.value !== "no") {
      this.fail("invalid standalone value", standalone.at);
    }
  }

  private misc() {
    for (;;) {
      this.space();
      if (this.starts("<!--")) {
        this.comment();
      } else if (this.starts("<?")) {
        this.instruction();
      } else {
        return;
      }
    }
  }

  private element(namespaces: Record<string, string>): XmlElement {
    const start = this.start(namespaces);
    return {
      attrs: start.attrs,
      children: start.closed ? [] : this.content(start),
      kind: "element",
      local: start.local,
      name: start.name,
      prefix: start.prefix,
      uri: start.uri,
    };
  }

  private content(start: StartTag) {
    const children: XmlNode[] = [];
    while (!this.starts("</")) {
      if (this.at === this.source.length) {
        this.fail(`unclosed element <${start.name}>`);
      }
      if (this.starts("<!--")) {
        this.comment();
      } else if (this.starts("<![CDATA[")) {
        children.push({ kind: "text", text: this.cdata() });
      } else if (this.starts("<?")) {
        this.instruction();
      } else if (this.starts("<!")) {
        this.fail("unsupported declaration");
      } else if (this.starts("<")) {
        children.push(this.element(start.namespaces));
      } else {
        children.push({ kind: "text", text: this.text() });
      }
    }
    this.end(start.name);
    return children;
  }

  private start(parent: Record<string, string>) {
    this.at += 1;
    const nameAt = this.at;
    const name = this.readName();
    const rawAttrs: RawAttr[] = [];
    let closed = false;
    for (;;) {
      const spaced = this.space();
      if (this.starts("/>")) {
        this.at += 2;
        closed = true;
        break;
      }
      if (this.starts(">")) {
        this.at += 1;
        break;
      }
      if (!spaced) {
        this.fail("space expected before attribute");
      }
      rawAttrs.push(this.rawAttr());
    }
    const namespaces = this.namespaces(rawAttrs, parent);
    const expanded = this.expand(name, namespaces, false, nameAt);
    return {
      attrs: this.attrs(rawAttrs, namespaces),
      closed,
      ...expanded,
      namespaces,
    };
  }

  private end(expected: string) {
    this.at += 2;
    const { at } = this;
    const name = this.readName();
    this.space();
    if (!this.starts(">")) {
      this.fail("closing bracket expected");
    }
    this.at += 1;
    if (name !== expected) {
      this.fail(`expected </${expected}>`, at);
    }
  }

  private rawAttr() {
    const { at } = this;
    const name = this.readName();
    this.space();
    if (!this.starts("=")) {
      this.fail("equals sign expected");
    }
    this.at += 1;
    this.space();
    const quote = this.source[this.at];
    if (quote !== '"' && quote !== "'") {
      this.fail("quoted attribute expected");
    }
    this.at += 1;
    const valueAt = this.at;
    const end = this.source.indexOf(quote, this.at);
    if (end < 0) {
      this.fail("unclosed attribute", at);
    }
    const raw = this.source.slice(this.at, end);
    if (raw.includes("<")) {
      this.fail("less-than sign in attribute", valueAt + raw.indexOf("<"));
    }
    this.at = end + 1;
    return { at, name, value: this.decode(raw, valueAt) };
  }

  private namespaces(attrs: RawAttr[], parent: Record<string, string>) {
    const namespaces = { ...parent };
    for (const attr of attrs) {
      const parts = this.parts(attr.name, attr.at);
      if (attr.name === "xmlns") {
        this.bind(namespaces, "", attr.value, attr.at);
      } else if (parts.prefix === "xmlns") {
        this.bind(namespaces, parts.local, attr.value, attr.at);
      }
    }
    return namespaces;
  }

  private bind(
    namespaces: Record<string, string>,
    prefix: string,
    uri: string,
    at: number
  ) {
    if (prefix === "xmlns" || uri === xmlnsUri || (prefix && !uri)) {
      this.fail("invalid namespace declaration", at);
    }
    if ((prefix === "xml") !== (uri === xmlUri)) {
      this.fail("invalid xml namespace binding", at);
    }
    if (prefix) {
      namespaces[prefix] = uri;
    } else if (uri) {
      namespaces[""] = uri;
    } else {
      namespaces[""] = "";
    }
  }

  private attrs(rawAttrs: RawAttr[], namespaces: Record<string, string>) {
    const attrs: XmlAttr[] = [];
    for (const raw of rawAttrs) {
      const parts = this.parts(raw.name, raw.at);
      let attr: XmlAttr;
      if (raw.name === "xmlns") {
        attr = {
          local: "xmlns",
          name: raw.name,
          prefix: null,
          uri: xmlnsUri,
          value: raw.value,
        };
      } else if (parts.prefix === "xmlns") {
        attr = { ...parts, name: raw.name, uri: xmlnsUri, value: raw.value };
      } else {
        attr = {
          ...this.expand(raw.name, namespaces, true, raw.at),
          value: raw.value,
        };
      }
      if (
        attrs.some((seen) => seen.local === attr.local && seen.uri === attr.uri)
      ) {
        this.fail(`duplicate attribute ${raw.name}`, raw.at);
      }
      attrs.push(attr);
    }
    return attrs;
  }

  private expand(
    name: string,
    namespaces: Record<string, string>,
    attribute: boolean,
    at: number
  ) {
    const parts = this.parts(name, at);
    if (parts.prefix === "xmlns") {
      this.fail("reserved xmlns prefix", at);
    }
    if (!parts.prefix) {
      return { ...parts, name, uri: attribute ? null : namespaces[""] || null };
    }
    const uri = namespaces[parts.prefix];
    if (!uri) {
      this.fail(`unbound namespace prefix ${parts.prefix}`, at);
    }
    return { ...parts, name, uri };
  }

  private parts(name: string, at: number) {
    const colon = name.indexOf(":");
    if (colon < 0) {
      return { local: name, prefix: null };
    }
    if (
      colon === 0 ||
      colon === name.length - 1 ||
      colon !== name.lastIndexOf(":")
    ) {
      this.fail("invalid qualified name", at);
    }
    return { local: name.slice(colon + 1), prefix: name.slice(0, colon) };
  }

  private readName() {
    const { at } = this;
    const first = this.char();
    if (!nameStart.test(first)) {
      this.fail("name expected");
    }
    this.at += first.length;
    let char = this.char();
    while (namePart.test(char)) {
      this.at += char.length;
      char = this.char();
    }
    return this.source.slice(at, this.at);
  }

  private text() {
    const end = this.source.indexOf("<", this.at);
    const textEnd = end < 0 ? this.source.length : end;
    const { at } = this;
    const raw = this.source.slice(at, textEnd);
    if (raw.includes("]]>")) {
      this.fail("CDATA close outside CDATA", at + raw.indexOf("]]>"));
    }
    this.at = textEnd;
    return this.decode(raw, at);
  }

  private cdata() {
    const { at } = this;
    this.at += 9;
    const end = this.source.indexOf("]]>", this.at);
    if (end < 0) {
      this.fail("unclosed CDATA", at);
    }
    const text = this.source.slice(this.at, end);
    this.at = end + 3;
    return text;
  }

  private comment() {
    const { at } = this;
    this.at += 4;
    const end = this.source.indexOf("-->", this.at);
    if (end < 0) {
      this.fail("unclosed comment", at);
    }
    const text = this.source.slice(this.at, end);
    if (text.includes("--") || text.endsWith("-")) {
      this.fail("double hyphen in comment", this.at);
    }
    this.at = end + 3;
  }

  private instruction() {
    const { at } = this;
    this.at += 2;
    const target = this.readName();
    if (target.toLowerCase() === "xml") {
      this.fail("misplaced XML declaration", at);
    }
    if (!(this.starts("?>") || this.space())) {
      this.fail("space expected in processing instruction");
    }
    const end = this.source.indexOf("?>", this.at);
    if (end < 0) {
      this.fail("unclosed processing instruction", at);
    }
    this.at = end + 2;
  }

  private decode(raw: string, at: number) {
    let decoded = "";
    let from = 0;
    while (from < raw.length) {
      const amp = raw.indexOf("&", from);
      if (amp < 0) {
        return decoded + raw.slice(from);
      }
      const end = raw.indexOf(";", amp + 1);
      if (end < 0) {
        this.fail("unclosed entity", at + amp);
      }
      decoded +=
        raw.slice(from, amp) + this.entity(raw.slice(amp + 1, end), at + amp);
      from = end + 1;
    }
    return decoded;
  }

  private entity(ref: string, at: number) {
    const named = entities.get(ref);
    if (named !== undefined) {
      return named;
    }
    const hex = ref.startsWith("#x");
    const digits = ref.slice(hex ? 2 : 1);
    const valid =
      ref.startsWith("#") &&
      (hex ? hexDigits.test(digits) : decimalDigits.test(digits));
    const code = valid ? Number.parseInt(digits, hex ? 16 : 10) : -1;
    if (!isXmlChar(code)) {
      this.fail(`invalid entity &${ref};`, at);
    }
    return String.fromCodePoint(code);
  }

  private space() {
    const { at } = this;
    while (xmlSpace.test(this.source[this.at] ?? "")) {
      this.at += 1;
    }
    return this.at > at;
  }

  private char() {
    const first = this.source.charCodeAt(this.at);
    if (Number.isNaN(first)) {
      return "";
    }
    return first >= 0xd8_00 && first <= 0xdb_ff
      ? this.source.slice(this.at, this.at + 2)
      : (this.source[this.at] ?? "");
  }

  private starts(text: string) {
    return this.source.startsWith(text, this.at);
  }

  private fail(message: string, at = this.at): never {
    const before = this.source.slice(0, at);
    const line = before.split("\n").length;
    const column = at - before.lastIndexOf("\n");
    throw new ParseError(`${message} at ${line}:${column}`);
  }
}

export const readXml = (source: string) => new XmlReader(source).read();
