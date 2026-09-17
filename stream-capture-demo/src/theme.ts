// theme.ts
//
// A stand-in for the real design tokens: same idea (foundation → component), a fraction of the size.
export const theme = {
  foundation: {
    color: {
      background: "#f4f5f7",
      surface: "#ffffff",
      border: "#d9dde3",
      text: "#17181a",
      textMuted: "#5b6472",
      primary: "#2f5fd0",
      onPrimary: "#ffffff",
      positive: "#0a7d4f",
      warning: "#b25e00",
    },
    space: { 4: "4px", 8: "8px", 12: "12px", 16: "16px", 24: "24px", 32: "32px" },
    radius: { small: "6px", medium: "12px", pill: "999px" },
    font: {
      family: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`,
      mono: `ui-monospace, SFMono-Regular, Menlo, monospace`,
    },
  },
  component: {
    uploadArea: {
      background: "#ffffff",
      borderColor: "#b0b9c0",
      borderStyle: "dashed",
      borderWidth: "1px",
      borderRadius: "12px",
    },
  },
} as const;

export type Theme = typeof theme;
