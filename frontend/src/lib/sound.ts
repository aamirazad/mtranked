// Typing sounds, ported from monkeytype's sound controller: sample packs
// (static/sounds, from monkeytype) and a few synthesised oscillator voices.
// Samples are fetched the first time a pack is used.
type Pack = { name: string; dir?: string; n?: number; osc?: OscillatorType; scale?: number[] };

export const CLICK_SOUNDS: Record<string, Pack> = {
  off: { name: "off" },
  click: { name: "click", dir: "click1", n: 3 },
  beep: { name: "beep", dir: "click2", n: 3 },
  pop: { name: "pop", dir: "click3", n: 3 },
  nk_creams: { name: "nk creams", dir: "click4", n: 6 },
  typewriter: { name: "typewriter", dir: "click5", n: 6 },
  osu: { name: "osu", dir: "click6", n: 3 },
  hitmarker: { name: "hitmarker", dir: "click7", n: 3 },
  rubber_keys: { name: "rubber keys", dir: "click15", n: 5 },
  sine: { name: "sine", osc: "sine" },
  sawtooth: { name: "sawtooth", osc: "sawtooth" },
  square: { name: "square", osc: "square" },
  triangle: { name: "triangle", osc: "triangle" },
  // C D E G A across two octaves
  pentatonic: { name: "pentatonic", scale: [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.26, 783.99, 880] },
};

export const ERROR_SOUNDS: Record<string, Pack> = {
  off: { name: "off" },
  damage: { name: "damage", dir: "error1", n: 1 },
  triangle: { name: "triangle", dir: "error2", n: 1 },
  square: { name: "square", dir: "error3", n: 1 },
  punch: { name: "missed punch", dir: "error4", n: 2 },
};

export const VOLUMES = [0.1, 0.25, 0.5, 0.75, 1];

let ctx: AudioContext | null | undefined;
const buffers = new Map<string, Promise<AudioBuffer[]>>();

function audio(): AudioContext | null {
  if (ctx === undefined) {
    try {
      ctx = new AudioContext();
    } catch {
      ctx = null;
    }
  }
  if (ctx?.state === "suspended") void ctx.resume();
  return ctx;
}

function load(p: Pack): Promise<AudioBuffer[]> {
  const key = p.dir!;
  let b = buffers.get(key);
  if (!b) {
    const c = audio();
    b = Promise.all(
      Array.from({ length: p.n! }, (_, i) =>
        fetch(`/sounds/${p.dir}/${i + 1}.wav`)
          .then((r) => r.arrayBuffer())
          .then((a) => c!.decodeAudioData(a)),
      ),
    ).catch(() => []);
    buffers.set(key, b);
  }
  return b;
}

/** Start fetching a pack so the first keypress isn't silent. */
export function preload(id: string, error = false) {
  const p = (error ? ERROR_SOUNDS : CLICK_SOUNDS)[id];
  if (p?.dir && audio()) void load(p);
}

function playPack(p: Pack | undefined, volume: number, code?: string) {
  if (!p || (!p.dir && !p.osc && !p.scale)) return;
  const c = audio();
  if (!c) return;
  const gain = c.createGain();
  gain.connect(c.destination);
  if (p.dir) {
    gain.gain.value = volume;
    void load(p).then((bufs) => {
      const buf = bufs[Math.floor(Math.random() * bufs.length)];
      if (!buf) return;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      src.start();
    });
    return;
  }
  // synthesised voices: pitch follows the key so typing plays a little tune
  const osc = c.createOscillator();
  osc.type = p.osc ?? "sine";
  const h = [...(code ?? "KeyA")].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 997, 7);
  osc.frequency.value = p.scale ? p.scale[h % p.scale.length]! : 220 + (h % 24) * 20;
  gain.gain.value = volume / 8;
  gain.gain.setTargetAtTime(0, c.currentTime, 0.1);
  osc.connect(gain);
  osc.start();
  osc.stop(c.currentTime + 0.5);
}

export function playClick(id: string, volume: number, code?: string) {
  playPack(CLICK_SOUNDS[id], volume, code);
}

export function playError(id: string, volume: number) {
  playPack(ERROR_SOUNDS[id], volume);
}
