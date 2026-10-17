// Short-lived feedback shown right next to the control that caused it (instead
// of a toast in the corner). Keyed by whatever the page uses to tell its
// controls apart, e.g. a row id.
export type Note = { text: string; kind: "info" | "error" | "success" };

export class Notes {
  map = $state<Record<string, Note>>({});
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  get(key: string): Note | null {
    return this.map[key] ?? null;
  }
  set(key: string, text: string, kind: Note["kind"] = "info", ms = 5000) {
    this.map[key] = { text, kind };
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.clear(key), ms));
  }
  clear(key: string) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    delete this.map[key];
  }
}
