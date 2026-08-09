/**
 * an input error that prevents a reader from producing a lyric document.
 */
export class ParseError extends Error {
  override readonly name = "ParseError";
}
