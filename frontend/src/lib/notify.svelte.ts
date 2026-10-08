// Browser notifications for when a queued match is found while the tab is in
// the background. We only ever ask the browser for permission after the user
// opts in from our own prompt on the queue screen.
import type { Mode } from "@mtr/race-protocol";

type Permission = NotificationPermission | "unsupported";

const KEY = "notify-dismissed";
const supported = () => typeof window !== "undefined" && "Notification" in window;

class Notifier {
  permission = $state<Permission>(supported() ? Notification.permission : "unsupported");
  /** the user said "no thanks" to our prompt; don't keep asking */
  dismissed = $state(typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1");
  /** the user opted in but the browser request was declined or closed */
  refused = $state(false);
  private current: Notification | null = null;

  /** show our opt-in prompt? */
  get offer() {
    return this.permission !== "unsupported" && this.permission !== "granted" && (!this.dismissed || this.refused);
  }

  async enable() {
    if (!supported()) return;
    this.refused = false;
    this.permission = await Notification.requestPermission().catch(() => Notification.permission);
    if (this.permission !== "granted") this.refused = true;
  }

  dismiss() {
    this.dismissed = true;
    this.refused = false;
    localStorage.setItem(KEY, "1");
  }

  matchFound(mode: Mode) {
    if (!supported() || Notification.permission !== "granted" || !document.hidden) return;
    try {
      const n = new Notification(`${mode} match found`, {
        body: "Click to jump back in and ready up.",
        icon: "/favicon.svg",
        tag: "match-found",
        requireInteraction: true,
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
      this.current = n;
    } catch {
      // some browsers (e.g. Android Chrome) only allow notifications from a service worker
    }
  }

  /** the ready check is over (or we're back on the tab), so the notification is stale */
  clear() {
    this.current?.close();
    this.current = null;
  }
}

export const notifier = new Notifier();

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) notifier.clear();
  });
}
