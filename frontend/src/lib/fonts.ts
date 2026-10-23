// Typing fonts, self-hosted from monkeytype's webfonts (each under its own
// open font license). The @font-face rules live in app.css, so a font is only
// downloaded once something on the page uses it.
export type FontDef = { id: string; name: string };

export const FONTS: FontDef[] = [
  { id: "roboto_mono", name: "Roboto Mono" },
  { id: "jetbrains_mono", name: "JetBrains Mono" },
  { id: "fira_code", name: "Fira Code" },
  { id: "source_code_pro", name: "Source Code Pro" },
  { id: "ibm_plex_mono", name: "IBM Plex Mono" },
  { id: "ubuntu_mono", name: "Ubuntu Mono" },
  { id: "inconsolata", name: "Inconsolata" },
  { id: "commit_mono", name: "Commit Mono" },
  { id: "geist_mono", name: "Geist Mono" },
  { id: "mononoki", name: "Mononoki" },
  { id: "hack", name: "Hack" },
  { id: "overpass_mono", name: "Overpass Mono" },
  { id: "lexend_deca", name: "Lexend Deca" },
  { id: "atkinson_hyperlegible", name: "Atkinson Hyperlegible" },
  { id: "comfortaa", name: "Comfortaa" },
  { id: "montserrat", name: "Montserrat" },
  { id: "nunito", name: "Nunito" },
  { id: "lato", name: "Lato" },
  { id: "space_grotesk", name: "Space Grotesk" },
  { id: "titillium_web", name: "Titillium Web" },
  { id: "ubuntu", name: "Ubuntu" },
  { id: "oxygen", name: "Oxygen" },
  { id: "open_dyslexic", name: "OpenDyslexic" },
  { id: "coming_soon", name: "Coming Soon" },
  { id: "itim", name: "Itim" },
];

export const DEFAULT_FONT = "roboto_mono";
export const fontById = (id: string) => FONTS.find((f) => f.id === id);
/** name shown in pickers; the default is marked so searching "default" finds it */
export const fontLabel = (f: FontDef) => (f.id === DEFAULT_FONT ? `${f.name} (Default)` : f.name);
export const fontStack = (id: string) => `"${fontById(id)?.name ?? "Roboto Mono"}", "Roboto Mono", ui-monospace, monospace`;
