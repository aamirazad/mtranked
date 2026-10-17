// Friends list (from the API) plus each friend's live presence (pushed by the
// realtime server). Signed-in players only.
import type { FriendRow, FriendsList } from "@mtr/contracts";
import type { FriendActivity, FriendPresence } from "@mtr/race-protocol";
import { api, errorMessage } from "./api";
import { toasts } from "./toast.svelte";

const OFFLINE: FriendPresence = { online: false, activity: null };

/** Short description of what a friend is doing, for lists. */
export function describeActivity(p: FriendPresence): string {
  if (!p.online) return "offline";
  const a: FriendActivity | null = p.activity;
  if (!a) return "online";
  if (a.kind === "queue") return `looking for a ${a.mode} match`;
  if (a.kind === "match") return a.mode === "ghost" ? "racing a ghost" : `racing ${a.mode}`;
  const room = a.name ? `“${a.name}”` : "a private room";
  return `${a.racing ? "racing in" : "in"} ${room} · ${a.players}/${a.cap}${a.locked ? " · locked" : ""}`;
}

class Friends {
  list = $state<FriendsList | null>(null);
  presence = $state<Record<string, FriendPresence>>({});
  private loading: Promise<void> | null = null;

  /** friends sorted online first, then by name */
  get sorted(): (FriendRow & { presence: FriendPresence })[] {
    const rows = (this.list?.friends ?? []).map((f) => ({ ...f, presence: this.presence[f.id] ?? OFFLINE }));
    return rows.sort((a, b) => Number(b.presence.online) - Number(a.presence.online) || a.name.localeCompare(b.name));
  }
  get online() {
    return this.sorted.filter((f) => f.presence.online);
  }
  get incomingCount() {
    return this.list?.incoming.length ?? 0;
  }
  presenceOf(id: string) {
    return this.presence[id] ?? OFFLINE;
  }
  nameOf(id: string) {
    return this.list?.friends.find((f) => f.id === id)?.name;
  }

  load() {
    this.loading ??= (async () => {
      const r = await api.friends.list().catch(() => null);
      if (r?.status === 200) this.list = r.body;
    })().finally(() => (this.loading = null));
    return this.loading;
  }

  clear() {
    this.list = null;
    this.presence = {};
  }

  async add(name: string): Promise<boolean> {
    const r = await api.friends.request({ body: { name } });
    if (r.status !== 200) {
      toasts.show(errorMessage(r), "error");
      return false;
    }
    const { status, already } = r.body;
    if (already) {
      toasts.show(status === "friends" ? `You're already friends with ${name}.` : `You already sent ${name} a friend request.`, "info");
    } else {
      toasts.show(status === "friends" ? `You and ${name} are now friends.` : `Friend request sent to ${name}.`, "success");
    }
    await this.load();
    return true;
  }

  async accept(f: Pick<FriendRow, "id">) {
    const r = await api.friends.accept({ params: { id: f.id } });
    if (r.status !== 200) toasts.show(errorMessage(r), "error");
    await this.load();
  }

  async remove(f: Pick<FriendRow, "id">) {
    await api.friends.remove({ params: { id: f.id } }).catch(() => null);
    await this.load();
  }
}

export const friends = new Friends();
