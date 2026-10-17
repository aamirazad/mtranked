// Preferences (theme, quick restart, typing look and feel). Kept in localStorage
// so they work signed out and offline, and synced to the account when signed in.
// Every setting carries the time it was changed; when devices disagree the
// later change wins, per setting, with no prompt.
// These are all client-side and cosmetic, so they're allowed in every mode
// including ranked. Rules that change what counts live in @mtr/engine rules.ts.
import type { SyncedPrefs } from "@mtr/contracts";
import { DEFAULT_THEME, themeById, type Theme } from "@mtr/shared";
import { api } from "./api";
import { game } from "./game.svelte";
import { session } from "./session.svelte";
import { DEFAULT_FONT, FONTS, fontStack } from "./fonts";
import { CLICK_SOUNDS, ERROR_SOUNDS, VOLUMES } from "./sound";
import { LAYOUT_IDS } from "./layouts";

export type QuickRestart = "off" | "esc" | "tab" | "enter";
export type CaretSpeed = "off" | "slow" | "medium" | "fast";
export type LiveStyle = "off" | "text" | "mini";
export type ProgressStyle = "off" | "text" | "mini" | "bar";
export type TapeMode = "off" | "letter" | "word";
export type HighlightMode = "letter" | "word" | "off";
export type IndicateTypos = "off" | "below" | "replace";

type Values = {
  theme: string;
  quickRestart: QuickRestart;
  roomThemes: boolean;
  fontSize: number;
  smoothCaret: CaretSpeed;
  liveWpm: LiveStyle;
  liveAcc: LiveStyle;
  liveBurst: LiveStyle;
  liveProgress: ProgressStyle;
  fontFamily: string;
  soundOnClick: string;
  soundOnError: string;
  soundVolume: number;
  tapeMode: TapeMode;
  showAllLines: boolean;
  smoothLineScroll: boolean;
  highlightMode: HighlightMode;
  indicateTypos: IndicateTypos;
  blindMode: boolean;
  hideExtraLetters: boolean;
  flipColors: boolean;
  colorfulMode: boolean;
  layout: string;
};
export type PrefKey = keyof Values;

const DEFAULTS: Values = {
  theme: DEFAULT_THEME,
  quickRestart: "tab",
  roomThemes: true,
  fontSize: 1.65,
  smoothCaret: "medium",
  liveWpm: "text",
  liveAcc: "off",
  liveBurst: "off",
  liveProgress: "text",
  fontFamily: DEFAULT_FONT,
  soundOnClick: "off",
  soundOnError: "off",
  soundVolume: 0.5,
  tapeMode: "off",
  showAllLines: false,
  smoothLineScroll: true,
  highlightMode: "letter",
  indicateTypos: "off",
  blindMode: false,
  hideExtraLetters: false,
  flipColors: false,
  colorfulMode: false,
  layout: "default",
};
const KEYS = Object.keys(DEFAULTS) as PrefKey[];

export const FONT_SIZES = [1.25, 1.65, 2, 2.5, 3];
export const QUICK_RESTARTS: QuickRestart[] = ["off", "esc", "tab", "enter"];
export const CARET_SPEEDS: CaretSpeed[] = ["off", "slow", "medium", "fast"];
/** caret glide duration per speed, in ms */
export const CARET_MS: Record<CaretSpeed, number> = { off: 0, slow: 150, medium: 80, fast: 45 };
export const LIVE_STYLES: LiveStyle[] = ["off", "text", "mini"];
export const PROGRESS_STYLES: ProgressStyle[] = ["off", "text", "mini", "bar"];
export const TAPE_MODES: TapeMode[] = ["off", "letter", "word"];
export const HIGHLIGHT_MODES: HighlightMode[] = ["letter", "word", "off"];
export const INDICATE_TYPOS: IndicateTypos[] = ["off", "below", "replace"];
export const fontSizeName = (s: number) =>
  ({ 1.25: "small", 1.65: "default", 2: "large", 2.5: "huge", 3: "massive" })[s] ?? String(s);

const oneOf =
  <T>(list: readonly T[]) =>
  (v: unknown) =>
    list.includes(v as T);
const bool = (v: unknown) => typeof v === "boolean";

const VALID: { [K in PrefKey]: (v: unknown) => boolean } = {
  theme: (v) => typeof v === "string" && !!themeById(v),
  quickRestart: oneOf(QUICK_RESTARTS),
  roomThemes: bool,
  fontSize: oneOf(FONT_SIZES),
  smoothCaret: oneOf(CARET_SPEEDS),
  liveWpm: oneOf(LIVE_STYLES),
  liveAcc: oneOf(LIVE_STYLES),
  liveBurst: oneOf(LIVE_STYLES),
  liveProgress: oneOf(PROGRESS_STYLES),
  fontFamily: (v) => FONTS.some((f) => f.id === v),
  soundOnClick: (v) => typeof v === "string" && v in CLICK_SOUNDS,
  soundOnError: (v) => typeof v === "string" && v in ERROR_SOUNDS,
  soundVolume: oneOf(VOLUMES),
  tapeMode: oneOf(TAPE_MODES),
  showAllLines: bool,
  smoothLineScroll: bool,
  highlightMode: oneOf(HIGHLIGHT_MODES),
  indicateTypos: oneOf(INDICATE_TYPOS),
  blindMode: bool,
  hideExtraLetters: bool,
  flipColors: bool,
  colorfulMode: bool,
  layout: oneOf(LAYOUT_IDS),
};

/** settings that used to be on/off and gained more choices: map the old saved values */
function upgrade(k: PrefKey, v: unknown): unknown {
  if (k === "smoothCaret" && typeof v === "boolean") return v ? "medium" : "off";
  if (k === "liveWpm" && typeof v === "boolean") return v ? "text" : "off";
  return v;
}

const KEY = "prefs";
/** read by the inline script in app.html so the page never flashes the wrong theme */
const VARS_KEY = "theme-vars";

export function themeVars(t: Theme): Record<string, string> {
  return {
    "--color-bg": t.bg,
    "--color-main": t.main,
    "--color-caret": t.caret,
    "--color-sub": t.sub,
    "--color-sub-alt": t.subAlt,
    "--color-text": t.text,
    "--color-error": t.error,
    "--color-error-extra": t.errorExtra,
    "--font-logo": t.look ? `"${t.look.font}", "Lexend Deca", sans-serif` : `"Lexend Deca", "Roboto Mono", sans-serif`,
    // filled icon tiles (see .icon-tile in app.css); without them icons sit bare in the main colour
    "--tile-bg": t.look?.tiles ? t.main : "transparent",
    "--tile-fg": t.look?.tiles ? t.bg : t.main,
    "--tile-pad": t.look?.tiles ? "0.8rem" : "0px",
    // hovered cards get a faint main-coloured edge instead of a solid one
    "--edge-hover": t.look ? `${t.main}40` : t.main,
    "color-scheme": t.light ? "light" : "dark",
  };
}

class Prefs {
  theme = $state(DEFAULTS.theme);
  quickRestart = $state<QuickRestart>(DEFAULTS.quickRestart);
  /** let supporter hosts' room themes replace yours while you're in their room */
  roomThemes = $state(DEFAULTS.roomThemes);
  fontSize = $state(DEFAULTS.fontSize);
  smoothCaret = $state<CaretSpeed>(DEFAULTS.smoothCaret);
  liveWpm = $state<LiveStyle>(DEFAULTS.liveWpm);
  liveAcc = $state<LiveStyle>(DEFAULTS.liveAcc);
  liveBurst = $state<LiveStyle>(DEFAULTS.liveBurst);
  liveProgress = $state<ProgressStyle>(DEFAULTS.liveProgress);
  fontFamily = $state(DEFAULTS.fontFamily);
  soundOnClick = $state(DEFAULTS.soundOnClick);
  soundOnError = $state(DEFAULTS.soundOnError);
  soundVolume = $state(DEFAULTS.soundVolume);
  tapeMode = $state<TapeMode>(DEFAULTS.tapeMode);
  showAllLines = $state(DEFAULTS.showAllLines);
  smoothLineScroll = $state(DEFAULTS.smoothLineScroll);
  highlightMode = $state<HighlightMode>(DEFAULTS.highlightMode);
  indicateTypos = $state<IndicateTypos>(DEFAULTS.indicateTypos);
  blindMode = $state(DEFAULTS.blindMode);
  hideExtraLetters = $state(DEFAULTS.hideExtraLetters);
  flipColors = $state(DEFAULTS.flipColors);
  colorfulMode = $state(DEFAULTS.colorfulMode);
  layout = $state(DEFAULTS.layout);
  /** theme shown while hovering it in the command line; never saved */
  preview = $state<string | null>(null);

  /** when each setting was last changed (0 = never, so any account value wins) */
  private times: Partial<Record<PrefKey, number>> = {};
  private syncing = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    if (typeof localStorage === "undefined") return;
    let saved: Record<string, unknown> = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    } catch {}
    for (const k of KEYS) {
      // older saves stored bare values with no timestamp
      const e = saved[k];
      const [raw, t] = e && typeof e === "object" ? [(e as { v: unknown }).v, Number((e as { t: unknown }).t) || 0] : [e, 0];
      const v = upgrade(k, raw);
      if (VALID[k](v)) this.assign(k, v as Values[PrefKey], t);
    }
    this.applyFont();
  }

  private assign<K extends PrefKey>(k: K, v: Values[K], t: number) {
    (this as unknown as Values)[k] = v;
    this.times[k] = t;
  }

  /** the font family applies to the whole site, like monkeytype */
  private applyFont() {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--font-mono", fontStack(this.fontFamily));
  }

  private save() {
    const out: SyncedPrefs = {};
    for (const k of KEYS) {
      const t = this.times[k];
      if (t !== undefined) (out as Record<string, unknown>)[k] = { v: (this as unknown as Values)[k], t };
    }
    localStorage.setItem(KEY, JSON.stringify(out));
    localStorage.setItem(VARS_KEY, JSON.stringify(themeVars(themeById(this.theme)!)));
    return out;
  }

  set<K extends PrefKey>(k: K, v: Values[K]) {
    // re-picking the current value isn't a change and mustn't outrank newer ones
    if ((this as unknown as Values)[k] === v) return;
    // server-corrected clock, so devices compare on the same timeline
    this.assign(k, v, Math.round(game.serverNow()));
    if (k === "fontFamily") this.applyFont();
    this.save();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), 400);
  }

  /** Push local settings and take any newer ones from the account. Safe to call any time. */
  async sync() {
    if (!session.me) return;
    if (this.syncing) {
      this.again = true;
      return;
    }
    this.syncing = true;
    try {
      const r = await api.me.prefs({ body: this.save() }).catch(() => null);
      if (r?.status !== 200) return;
      let changed = false;
      for (const k of KEYS) {
        const e = r.body.prefs[k];
        if (!e) continue;
        const v = upgrade(k, e.v);
        // anything changed here while the request was out is newer and stays
        if (e.t > (this.times[k] ?? 0) && VALID[k](v)) {
          this.assign(k, v as Values[PrefKey], e.t);
          changed = true;
        }
      }
      if (changed) {
        this.save();
        this.applyFont();
      }
    } finally {
      this.syncing = false;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    }
  }
}

export const prefs = new Prefs();

/** Paint the site in a theme. Only the user's own theme is ever persisted (see Prefs.save). */
export function applyTheme(id: string) {
  const t = themeById(id) ?? themeById(DEFAULT_THEME)!;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themeVars(t))) root.style.setProperty(k, v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.bg);
}
