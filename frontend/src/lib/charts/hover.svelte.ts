// Hover state for the charts: the hovered data index snaps to the nearest point, but the
// guide line, dots and tooltip glide there on springs instead of jumping.
import { Spring, prefersReducedMotion } from "svelte/motion";

const OPTS = { stiffness: 0.22, damping: 0.8 };

export class ChartHover {
  /** hovered data index; kept while fading out so the tooltip content doesn't vanish */
  index = $state<number | null>(null);
  shown = $state(false);
  x = new Spring(0, OPTS);
  y = new Spring(0, OPTS);
  /** extra animated value, e.g. a second line's dot */
  y2 = new Spring(0, OPTS);

  move(i: number, x: number, y = 0, y2 = 0) {
    const instant = !this.shown || prefersReducedMotion.current;
    void this.x.set(x, { instant });
    void this.y.set(y, { instant });
    void this.y2.set(y2, { instant });
    this.index = i;
    this.shown = true;
  }

  hide() {
    this.shown = false;
  }

  /** Arrow keys / Home / End step through the points; returns the new index or null if not handled. */
  key(e: KeyboardEvent, n: number): number | null {
    const last = n - 1;
    const cur = this.shown ? this.index : null;
    let next: number;
    if (e.key === "ArrowLeft") next = Math.max(0, (cur ?? last + 1) - 1);
    else if (e.key === "ArrowRight") next = Math.min(last, (cur ?? -1) + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return null;
    e.preventDefault();
    return next;
  }
}
