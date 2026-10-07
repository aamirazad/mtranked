/** Deterministic PRNG so the server and replays regenerate identical text from a seed. */
export function seededRandom(seed: string): () => number {
  // cyrb53-style string hash -> mulberry32
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  let a = h1 >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
