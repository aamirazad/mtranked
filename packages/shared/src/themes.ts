// Site color themes. Each one fills the same CSS variables the default
// (mt ranked) defines in app.css, so every page re-colors at once.
export type Theme = {
  id: string;
  name: string;
  /** shown next to the name in theme pickers */
  note?: string;
  light?: boolean;
  /** more than colors: heading font and filled icon tiles. themes without it keep the monkeytype look */
  look?: { font: string; tiles: boolean };
  bg: string;
  main: string;
  caret: string;
  sub: string;
  subAlt: string;
  text: string;
  error: string;
  errorExtra: string;
};

export const DEFAULT_THEME = "mt_ranked";

// the site's own theme and monkeytype's lead the list, the rest are alphabetical
export const THEMES: Theme[] = [
  { id: "mt_ranked", name: "mt ranked", look: { font: "Montserrat", tiles: true }, bg: "#141414", main: "#f8c630", caret: "#f8c630", sub: "#6e6e6e", subAlt: "#1f1f1f", text: "#ededed", error: "#e5484d", errorExtra: "#8a2a2e" },
  { id: "serika_dark", name: "serika dark", note: "monkeytype.com's default look", bg: "#323437", main: "#e2b714", caret: "#e2b714", sub: "#646669", subAlt: "#2c2e31", text: "#d1d0c5", error: "#ca4754", errorExtra: "#7e2a33" },
  { id: "8008", name: "8008", bg: "#333a45", main: "#f44c7f", caret: "#f44c7f", sub: "#939eae", subAlt: "#2e343d", text: "#e9ecf0", error: "#da3333", errorExtra: "#791717" },
  { id: "botanical", name: "botanical", bg: "#7b9c98", main: "#eaf1f3", caret: "#abc6c4", sub: "#495755", subAlt: "#6f8f8b", text: "#eaf1f3", error: "#f6c9b4", errorExtra: "#f59a71" },
  { id: "carbon", name: "carbon", bg: "#313131", main: "#f66e0d", caret: "#f66e0d", sub: "#616161", subAlt: "#2b2b2b", text: "#f5e6c8", error: "#e72d2d", errorExtra: "#7e2a33" },
  { id: "catppuccin", name: "catppuccin", bg: "#1e1e2e", main: "#cba6f7", caret: "#f5e0dc", sub: "#7f849c", subAlt: "#181825", text: "#cdd6f4", error: "#f38ba8", errorExtra: "#e64553" },
  { id: "dark", name: "dark", bg: "#111111", main: "#eeeeee", caret: "#eeeeee", sub: "#444444", subAlt: "#191919", text: "#eeeeee", error: "#da3333", errorExtra: "#791717" },
  { id: "dracula", name: "dracula", bg: "#282a36", main: "#bd93f9", caret: "#f8f8f2", sub: "#6272a4", subAlt: "#20222c", text: "#f8f8f2", error: "#ff5555", errorExtra: "#a33a3a" },
  { id: "gruvbox_dark", name: "gruvbox dark", bg: "#282828", main: "#d79921", caret: "#d79921", sub: "#665c54", subAlt: "#1d2021", text: "#ebdbb2", error: "#fb4934", errorExtra: "#cc241d" },
  { id: "lavender", name: "lavender", light: true, bg: "#e8e4f2", main: "#8e6fd8", caret: "#8e6fd8", sub: "#a49cbf", subAlt: "#ddd6ec", text: "#2f2a3d", error: "#d6457a", errorExtra: "#9c2f57" },
  { id: "matrix", name: "matrix", bg: "#000000", main: "#15ff00", caret: "#15ff00", sub: "#006500", subAlt: "#032000", text: "#d1ffcd", error: "#da3333", errorExtra: "#791717" },
  { id: "miami", name: "miami", bg: "#f35588", main: "#05dfd7", caret: "#a3f7bf", sub: "#94294c", subAlt: "#e9416f", text: "#f0e9ec", error: "#fff591", errorExtra: "#b9b269" },
  { id: "midnight", name: "midnight", bg: "#0b0e13", main: "#60759f", caret: "#60759f", sub: "#394760", subAlt: "#1a2633", text: "#9fadc6", error: "#c27070", errorExtra: "#c28b70" },
  { id: "nord", name: "nord", bg: "#242933", main: "#d8dee9", caret: "#d8dee9", sub: "#617b94", subAlt: "#1b1f27", text: "#d8dee9", error: "#bf616a", errorExtra: "#793e44" },
  { id: "nord_light", name: "nord light", light: true, bg: "#eceff4", main: "#5e81ac", caret: "#5e81ac", sub: "#9aa5b8", subAlt: "#e0e5ed", text: "#3b4252", error: "#bf616a", errorExtra: "#d08770" },
  { id: "olivia", name: "olivia", bg: "#1c1b1d", main: "#deaf9d", caret: "#deaf9d", sub: "#4e3b42", subAlt: "#232124", text: "#f2efed", error: "#bf616a", errorExtra: "#793e44" },
  { id: "paper", name: "paper", light: true, bg: "#eeeeee", main: "#444444", caret: "#444444", sub: "#b2b2b2", subAlt: "#e1e1e1", text: "#444444", error: "#d70000", errorExtra: "#923d3d" },
  { id: "rose_pine", name: "rose pine", bg: "#1f1d27", main: "#9ccfd8", caret: "#f6c177", sub: "#6e6a86", subAlt: "#26233a", text: "#e0def4", error: "#eb6f92", errorExtra: "#ebbcba" },
  { id: "rose_pine_dawn", name: "rose pine dawn", light: true, bg: "#fffaf3", main: "#56949f", caret: "#ea9d34", sub: "#9893a5", subAlt: "#f2e9de", text: "#286983", error: "#b4637a", errorExtra: "#d7827e" },
  { id: "serika", name: "serika", light: true, bg: "#e1e1e3", main: "#e2b714", caret: "#e2b714", sub: "#aaaeb3", subAlt: "#d1d3d8", text: "#323437", error: "#da3333", errorExtra: "#791717" },
  { id: "solarized_light", name: "solarized light", light: true, bg: "#fdf6e3", main: "#859900", caret: "#dc322f", sub: "#93a1a1", subAlt: "#eee8d5", text: "#002b36", error: "#d33682", errorExtra: "#9b225c" },
  { id: "tokyo_night", name: "tokyo night", bg: "#1a1b26", main: "#7aa2f7", caret: "#c0caf5", sub: "#565f89", subAlt: "#16161e", text: "#c0caf5", error: "#f7768e", errorExtra: "#db4b4b" },
];

export const themeById = (id: string | null | undefined) => THEMES.find((t) => t.id === id);
