export type Toast = { id: number; text: string; kind: "info" | "error" | "success" };

class Toasts {
  list = $state<Toast[]>([]);
  private n = 0;
  show(text: string, kind: Toast["kind"] = "info", ms = 4000) {
    const id = ++this.n;
    this.list.push({ id, text, kind });
    setTimeout(() => this.dismiss(id), ms);
  }
  dismiss(id: number) {
    this.list = this.list.filter((t) => t.id !== id);
  }
}

// one instance per page: editing this module reloads the page, and any stale copy
// the dev server hands out shares the instance instead of making its own
import.meta.hot?.accept(() => location.reload());
export const toasts: Toasts = import.meta.hot ? (import.meta.hot.data.toasts ??= new Toasts()) : new Toasts();
