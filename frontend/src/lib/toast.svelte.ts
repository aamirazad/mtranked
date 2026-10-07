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

export const toasts = new Toasts();
