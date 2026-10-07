import type { Guest, Me } from "@mtr/contracts";
import { api } from "./api";

class Session {
  me = $state<Me | null>(null);
  guest = $state<Guest | null>(null);
  loaded = $state(false);

  async refresh() {
    const r = await api.auth.me().catch(() => null);
    if (r?.status === 200) {
      this.me = r.body.user;
      this.guest = r.body.guest;
    }
    this.loaded = true;
  }

  set(me: Me | null) {
    this.me = me;
    if (me) this.guest = null;
  }
}

export const session = new Session();
