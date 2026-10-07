import { initClient } from "@ts-rest/core";
import { contract } from "@mtr/contracts";

export const api = initClient(contract, {
  baseUrl: "",
  baseHeaders: {},
  credentials: "include",
});

export type ApiResult = { status: number; body: unknown };

/** Pull a readable error message out of a non-200 response. */
export function errorMessage(r: ApiResult): string {
  const b = r.body as { message?: string } | undefined;
  return b?.message ?? `Request failed (${r.status})`;
}

export function fieldErrors(r: ApiResult): Record<string, string> {
  const b = r.body as { fields?: Record<string, string> } | undefined;
  return b?.fields ?? {};
}
