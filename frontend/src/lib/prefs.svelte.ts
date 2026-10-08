// Preferences (theme, quick restart, typing look). Kept in localStorage so they
// work signed out and offline, and synced to the account when signed in.
// Every setting carries the time it was changed; when devices disagree the
// later change wins, per setting, with no prompt.
import type { SyncedPrefs } from "@mtr/contracts";
import { DEFAULT_THEME, themeById, type Theme } from "@mtr/shared";
import { api } from "./api";
import { game } from "./game.svelte";
import { session } from "./session.svelte";

export type QuickRestart = "off" | "esc" | "tab" | "enter";

type Values = {
  theme: string;
  quickRestart: QuickRestart;
  roomThemes: boolean;
  fontSize: number;
  smoothCaret: boolean;
  liveWpm: boolean;
};
type Key = keyof Values;

const DEFAULTS: Values = {
  theme: DEFAULT_THEME,
  quickRestart: "tab",
  roomThemes: true,
  fontSize: 1.65,
  smoothCaret: true,
  liveWpm: true,
};
const KEYS = Object.keys(DEFAULTS) as Key[];

export const FONT_SIZES = [1.25, 1.65, 2, 2.5];
export const QUICK_RESTARTS: QuickRestart[] = ["off", "esc", "tab", "enter"];
export const fontSizeName = (s: number) => ({ 1.25: "small", 1.65: "default", 2: "large", 2.5: "huge" })[s] ?? String(s);

const VALID: { [K in Key]: (v: unknown) => boolean } = {
  theme: (v) => typeof v === "string" && !!themeById(v),
  quickRestart: (v) => QUICK_RESTARTS.includes(v as QuickRestart),
  roomThemes: (v) => typeof v === "boolean",
  fontSize: (v) => FONT_SIZES.includes(v as number),
  smoothCaret: (v) => typeof v === "boolean",
  liveWpm: (v) => typeof v === "boolean",
};

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
    "color-scheme": t.light ? "light" : "dark",
  };
}

class Prefs {
  theme = $state(DEFAULTS.theme);
  quickRestart = $state<QuickRestart>(DEFAULTS.quickRestart);
  /** let supporter hosts' room themes replace yours while you're in their room */
  roomThemes = $state(DEFAULTS.roomThemes);
  fontSize = $state(DEFAULTS.fontSize);
  smoothCaret = $state(DEFAULTS.smoothCaret);
  liveWpm = $state(DEFAULTS.liveWpm);
  /** theme shown while hovering it in the command line; never saved */
  preview = $state<string | null>(null);

  /** when each setting was last changed (0 = never, so any account value wins) */
  private times: Partial<Record<Key, number>> = {};
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
      const [v, t] = e && typeof e === "object" ? [(e as { v: unknown }).v, Number((e as { t: unknown }).t) || 0] : [e, 0];
      if (VALID[k](v)) this.assign(k, v as Values[Key], t);
    }
  }

  private assign<K extends Key>(k: K, v: Values[K], t: number) {
    (this as unknown as Values)[k] = v;
    this.times[k] = t;
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

  set<K extends Key>(k: K, v: Values[K]) {
    // re-picking the current value isn't a change and mustn't outrank newer ones
    if ((this as unknown as Values)[k] === v) return;
    // server-corrected clock, so devices compare on the same timeline
    this.assign(k, v, Math.round(game.serverNow()));
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
        // anything changed here while the request was out is newer and stays
        if (e && e.t > (this.times[k] ?? 0) && VALID[k](e.v)) {
          this.assign(k, e.v as Values[Key], e.t);
          changed = true;
        }
      }
      if (changed) this.save();
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
