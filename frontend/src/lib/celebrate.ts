import confetti from "canvas-confetti";

const colors = ["#e2b714", "#d1d0c5", "#ca4754", "#5ce0a0", "#5cb8ff"];

/** Finish animation for the equipped cosmetic. */
export function celebrate(kind: string) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  switch (kind) {
    case "none":
      return;
    case "fireworks": {
      const end = Date.now() + 1200;
      const iv = setInterval(() => {
        if (Date.now() > end) return clearInterval(iv);
        void confetti({
          particleCount: 40,
          startVelocity: 30,
          spread: 360,
          ticks: 60,
          origin: { x: Math.random(), y: Math.random() * 0.4 + 0.1 },
          colors,
        });
      }, 220);
      return;
    }
    case "stars":
      void confetti({
        particleCount: 60,
        spread: 100,
        startVelocity: 35,
        shapes: ["star"],
        colors: ["#e2b714", "#fff3b0"],
        origin: { y: 0.6 },
      });
      return;
    case "gold": {
      const end = Date.now() + 1500;
      const frame = () => {
        void confetti({
          particleCount: 4,
          angle: 270,
          spread: 120,
          startVelocity: 10,
          gravity: 0.7,
          origin: { x: Math.random(), y: -0.05 },
          colors: ["#e2b714", "#f5d76e", "#b8901a"],
        });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();
      return;
    }
    default:
      void confetti({ particleCount: 90, spread: 75, origin: { y: 0.65 }, colors });
  }
}
