import type { Guest, Me } from "@mtr/contracts";
import { api } from "./api";

class Session {
  me = $state<Me | null>(null);
  guest = $state<Guest | null>(null);
  loaded = $state(false);
  /** supporter is for sale; while false the site shows no trace of a supporter tier */
  supporterSales = $state(false);

  async refresh() {
    const r = await api.auth.me().catch(() => null);
    if (r?.status === 200) {
      this.me = r.body.user;
      this.guest = r.body.guest;
      this.supporterSales = r.body.supporterSales;
    }
    this.loaded = true;
  }

  set(me: Me | null) {
    this.me = me;
    if (me) this.guest = null;
  }
}

// one instance per page even if the dev server hands out a stale copy of this module
export const session: Session = import.meta.hot ? (import.meta.hot.data.session ??= new Session()) : new Session();
