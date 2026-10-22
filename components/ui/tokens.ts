/**
 * The palette, mirrored in TypeScript.
 *
 * Canvas overlays and fabric objects cannot read CSS custom properties, so the
 * same values live here and in the `@theme` block of app/globals.css. The drift
 * test in tests/uiTokens.test.ts keeps the two in step.
 */
export const PALETTE = {
  ink: "#16203a",
  inkSoft: "#4a5570",
  inkFaint: "#8891a8",
  paper: "#fbfaf7",
  desk: "#e7e6e1",
  rule: "#d6d5cf",
  ledger: "#0e7c5a",
  stamp: "#b3242b",
  marker: "#c77e0a",
  ledgerWash: "#e6f4ee",
  stampWash: "#fbeceb",
  markerWash: "#fdf3e3",
} as const;

export type PaletteToken = keyof typeof PALETTE;
