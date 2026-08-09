const lyricTag = /^\[([A-Za-z]+):(.*)\]$/u;

export function readTag(line: string) {
  const match = lyricTag.exec(line.trim());
  if (!match) {
    return null;
  }
  const colon = match[0].indexOf(":");
  const name = match[0].slice(1, colon).toLowerCase();
  const text = match[0].slice(colon + 1, -1);
  return { name, text: name === "by" ? text : text.trim() };
}
