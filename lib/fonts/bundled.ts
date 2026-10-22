/**
 * The font set the pipeline bundles and prints with.
 *
 * The editor's pickers may offer nothing else: a family outside this list has
 * no file in the bundle, and the engine's contract is to refuse a print that
 * needs one rather than substitute a lookalike. Metric-compatible aliases
 * (Arial, Times New Roman, Calibri, Cambria) are offered alongside the real
 * faces because templates authored before the pipeline carried those names,
 * and they resolve to the same files at print time.
 */

export interface BundledFontOption {
  /** The family string a template stores. */
  value: string;
  label: string;
  /** The face file inside the font set, for the PDF checklist. */
  file: string;
}

export const BUNDLED_FONTS: readonly BundledFontOption[] = [
  { value: "Arial", label: "Arial (prints as Arimo)", file: "fonts/Arimo_400Regular.ttf" },
  { value: "Arimo", label: "Arimo", file: "fonts/Arimo_400Regular.ttf" },
  { value: "Times New Roman", label: "Times New Roman (prints as Tinos)", file: "fonts/Tinos_400Regular.ttf" },
  { value: "Tinos", label: "Tinos", file: "fonts/Tinos_400Regular.ttf" },
  { value: "Calibri", label: "Calibri (prints as Carlito)", file: "fonts/Carlito_400Regular.ttf" },
  { value: "Carlito", label: "Carlito", file: "fonts/Carlito_400Regular.ttf" },
  { value: "Cambria", label: "Cambria (prints as Caladea)", file: "fonts/Caladea_400Regular.ttf" },
  { value: "Caladea", label: "Caladea", file: "fonts/Caladea_400Regular.ttf" },
  { value: "Noto Sans", label: "Noto Sans", file: "fonts/NotoSans_400Regular.ttf" },
  { value: "Noto Sans Devanagari", label: "Noto Sans Devanagari", file: "fonts/NotoSansDevanagari_400Regular.ttf" },
];

/** True when the named family has a file in the font set (alias included). */
export function isBundledFamily(family: string): boolean {
  return BUNDLED_FONTS.some((f) => f.value === family);
}
