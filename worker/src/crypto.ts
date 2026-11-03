// Tokens, hashes and signed payloads (Web Crypto). Guests and WebSocket tickets are signed
// rather than stored, so they cost no database rows.
import { env } from "cloudflare:workers";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
export const newToken = () => b64url(randomBytes(32));
export const randomHex = (n: number) => [...randomBytes(n)].map((b) => b.toString(16).padStart(2, "0")).join("");
/** Uniform integer in [0, max). */
export function randomInt(max: number): number {
  const lim = Math.floor(0x1_0000_0000 / max) * max;
  for (;;) {
    const v = crypto.getRandomValues(new Uint32Array(1))[0]!;
    if (v < lim) return v % max;
  }
}

export async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let hmacKey: Promise<CryptoKey> | undefined;
function key() {
  if (!env.AUTH_SECRET) throw new Error("AUTH_SECRET is not set");
  hmacKey ??= crypto.subtle.importKey("raw", enc.encode(env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
  return hmacKey;
}

/** `payload.signature`, both base64url; `exp` (ms) is checked by `unsign`. */
export async function sign(data: object, ttlMs: number): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...data, exp: Date.now() + ttlMs })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function unsign<T>(token: string | undefined | null): Promise<T | null> {
  if (!token || token.length > 1000) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    if (!(await crypto.subtle.verify("HMAC", await key(), unb64url(sig), enc.encode(body)))) return null;
    const data = JSON.parse(dec.decode(unb64url(body))) as T & { exp: number };
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ passwords
// PBKDF2-SHA256 at the Workers maximum of 100k iterations. Run in the Compute Durable Object
// (src/compute.ts), whose CPU limit is far above a free-plan Worker's 10 ms.
const ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, 256);
  return new Uint8Array(bits);
}

export async function hashPasswordNow(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `pbkdf2-sha256$${ITERATIONS}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function verifyPasswordNow(stored: string, password: string): Promise<boolean> {
  const [alg, iter, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2-sha256" || !iter || !salt || !hash) {
    // still spend the time, so unknown accounts and bots take as long as real ones
    await pbkdf2(password, randomBytes(16), ITERATIONS);
    return false;
  }
  const got = await pbkdf2(password, unb64url(salt), Number(iter));
  const want = unb64url(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ want[i]!;
  return diff === 0;
}
