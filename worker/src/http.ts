// Request helpers for API handlers: cookies, client address and rate limits.
import { env } from "cloudflare:workers";

export type Http = {
  request: Request;
  /** headers added to the response (Set-Cookie) */
  out: Headers;
  cookies: Record<string, string>;
  ip: string | null;
  userAgent: string | null;
  secure: boolean;
};

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function http(request: Request, out: Headers): Http {
  return {
    request,
    out,
    cookies: parseCookies(request.headers.get("cookie")),
    // set by Cloudflare's edge for every request; can't be spoofed by the client
    ip: request.headers.get("cf-connecting-ip"),
    userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    secure: new URL(request.url).protocol === "https:",
  };
}

export function setCookie(h: Http, name: string, value: string, maxAgeSec: number) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (h.secure) parts.push("Secure");
  h.out.append("Set-Cookie", parts.join("; "));
}

export const clearCookie = (h: Http, name: string) => setCookie(h, name, "", 0);

/**
 * Workers rate limiting: fixed 60s windows counted per Cloudflare location.
 *   strict 5/min (signup, password reset mail, reports), normal 20/min, loose 120/min.
 */
export async function rateLimit(kind: "strict" | "normal" | "loose", key: string): Promise<boolean> {
  const binding = kind === "strict" ? env.RL_STRICT : kind === "normal" ? env.RL_NORMAL : env.RL_LOOSE;
  try {
    return (await binding.limit({ key })).success;
  } catch {
    // never lock everyone out because the limiter hiccuped
    return true;
  }
}
