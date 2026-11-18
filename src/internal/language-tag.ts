const languageTag = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u;

export function isLanguageTag(language: string) {
  return languageTag.test(language);
}
