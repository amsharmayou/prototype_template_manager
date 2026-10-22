/**
 * Copy the bundled open-licence fonts from their npm sources into
 * `assets/fonts/` (repository bytes) and `public/fonts/` (runtime fetches).
 *
 * The set is metric-compatible with the system stacks the editor's templates
 * were drawn with: Arimo/Arial, Tinos/Times New Roman, Carlito/Calibri,
 * Caladea/Cambria, plus Noto Sans and Noto Sans Devanagari for the scripts
 * the Latin four do not cover. Licences travel beside the files.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface BundledFont {
  pkg: string;
  dir: string;
  file: string;
  family: string;
  /** The system family name this font substitutes for. */
  systemAlias: string;
  licence: string;
  licenceUrl: string;
}

const FONTS: BundledFont[] = [
  { pkg: "@expo-google-fonts/arimo", dir: "400Regular", file: "Arimo_400Regular.ttf", family: "Arimo", systemAlias: "Arial", licence: "Apache-2.0", licenceUrl: "https://github.com/google/fonts/blob/main/apache/arimo/OFL.txt" },
  { pkg: "@expo-google-fonts/arimo", dir: "400Regular_Italic", file: "Arimo_400Regular_Italic.ttf", family: "Arimo", systemAlias: "Arial", licence: "Apache-2.0", licenceUrl: "https://github.com/google/fonts/blob/main/apache/arimo/OFL.txt" },
  { pkg: "@expo-google-fonts/arimo", dir: "700Bold", file: "Arimo_700Bold.ttf", family: "Arimo", systemAlias: "Arial", licence: "Apache-2.0", licenceUrl: "https://github.com/google/fonts/blob/main/apache/arimo/OFL.txt" },
  { pkg: "@expo-google-fonts/arimo", dir: "700Bold_Italic", file: "Arimo_700Bold_Italic.ttf", family: "Arimo", systemAlias: "Arial", licence: "Apache-2.0", licenceUrl: "https://github.com/google/fonts/blob/main/apache/arimo/OFL.txt" },
  { pkg: "@expo-google-fonts/tinos", dir: "400Regular", file: "Tinos_400Regular.ttf", family: "Tinos", systemAlias: "Times New Roman", licence: "Apache-2.0", licenceUrl: "https://github.com/google/fonts/blob/main/apache/tinos/OFL.txt" },
  { pkg: "@expo-google-fonts/tinos", dir: "400Regular_Italic", file: "Tinos_400Regular_Italic.ttf", family: "Tinos", systemAlias: "Times New Roman", licence: "Apache-2.0", licenceUrl: "https://github.com/google/fonts/blob/main/apache/tinos/OFL.txt" },
  { pkg: "@expo-google-fonts/tinos", dir: "700Bold", file: "Tinos_700Bold.ttf", family: "Tinos", systemAlias: "Times New Roman", licence: "Apache-2.0", licenceUrl: "https://github.com/google/fonts/blob/main/apache/tinos/OFL.txt" },
  { pkg: "@expo-google-fonts/tinos", dir: "700Bold_Italic", file: "Tinos_700Bold_Italic.ttf", family: "Tinos", systemAlias: "Times New Roman", licence: "Apache-2.0", licenceUrl: "https://github.com/google/fonts/blob/main/apache/tinos/OFL.txt" },
  { pkg: "@expo-google-fonts/carlito", dir: "400Regular", file: "Carlito_400Regular.ttf", family: "Carlito", systemAlias: "Calibri", licence: "OFL-1.1", licenceUrl: "https://github.com/google/fonts/blob/main/ofl/carlito/OFL.txt" },
  { pkg: "@expo-google-fonts/carlito", dir: "700Bold", file: "Carlito_700Bold.ttf", family: "Carlito", systemAlias: "Calibri", licence: "OFL-1.1", licenceUrl: "https://github.com/google/fonts/blob/main/ofl/carlito/OFL.txt" },
  { pkg: "@expo-google-fonts/caladea", dir: "400Regular", file: "Caladea_400Regular.ttf", family: "Caladea", systemAlias: "Cambria", licence: "OFL-1.1", licenceUrl: "https://github.com/google/fonts/blob/main/ofl/caladea/OFL.txt" },
  { pkg: "@expo-google-fonts/caladea", dir: "700Bold", file: "Caladea_700Bold.ttf", family: "Caladea", systemAlias: "Cambria", licence: "OFL-1.1", licenceUrl: "https://github.com/google/fonts/blob/main/ofl/caladea/OFL.txt" },
  { pkg: "@expo-google-fonts/noto-sans", dir: "400Regular", file: "NotoSans_400Regular.ttf", family: "Noto Sans", systemAlias: "", licence: "OFL-1.1", licenceUrl: "https://github.com/google/fonts/blob/main/ofl/notosans/OFL.txt" },
  { pkg: "@expo-google-fonts/noto-sans", dir: "700Bold", file: "NotoSans_700Bold.ttf", family: "Noto Sans", systemAlias: "", licence: "OFL-1.1", licenceUrl: "https://github.com/google/fonts/blob/main/ofl/notosans/OFL.txt" },
  { pkg: "@expo-google-fonts/noto-sans-devanagari", dir: "400Regular", file: "NotoSansDevanagari_400Regular.ttf", family: "Noto Sans Devanagari", systemAlias: "", licence: "OFL-1.1", licenceUrl: "https://github.com/google/fonts/blob/main/ofl/notosansdevanagari/OFL.txt" },
  { pkg: "@expo-google-fonts/noto-sans-devanagari", dir: "700Bold", file: "NotoSansDevanagari_700Bold.ttf", family: "Noto Sans Devanagari", systemAlias: "", licence: "OFL-1.1", licenceUrl: "https://github.com/google/fonts/blob/main/ofl/notosansdevanagari/OFL.txt" },
];

const root = join(import.meta.dirname, "..");
const assets = join(root, "assets", "fonts");
const publicDir = join(root, "public", "fonts");
mkdirSync(assets, { recursive: true });
mkdirSync(publicDir, { recursive: true });

const catalogue: unknown[] = [];
for (const font of FONTS) {
  const source = join(root, "node_modules", font.pkg, font.dir, font.file);
  copyFileSync(source, join(assets, font.file));
  copyFileSync(source, join(publicDir, font.file));
  catalogue.push({
    file: `fonts/${font.file}`,
    family: font.family,
    weight: font.dir.startsWith("700") ? 700 : 400,
    italic: font.dir.includes("Italic"),
    systemAlias: font.systemAlias,
    licence: font.licence,
    licenceUrl: font.licenceUrl,
  });
}

writeFileSync(join(assets, "fonts.json"), JSON.stringify({ fonts: catalogue }, null, 2), "utf8");
console.log(`synced ${FONTS.length} font files into assets/fonts and public/fonts`);
