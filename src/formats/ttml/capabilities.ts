import type { FormatCapabilities } from "@/types";

export const capabilities = {
  agents: "identity",
  backing: true,
  metadata: {
    album: false,
    artist: false,
    songwriters: true,
    title: true,
  },
  pronunciation: true,
  timing: { line: true, static: true, word: true },
  trackGenerated: true,
  trackKind: true,
  translation: true,
} satisfies FormatCapabilities;
