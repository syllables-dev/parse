import type { FormatCapabilities } from "../../types";

export const capabilities = {
  agents: "identity",
  backing: true,
  metadata: {
    album: false,
    apple: true,
    artist: false,
    author: false,
    songwriters: true,
    title: false,
  },
  pronunciation: true,
  trackGenerated: true,
  trackKind: true,
  translation: true,
  wordTiming: true,
} satisfies FormatCapabilities;
