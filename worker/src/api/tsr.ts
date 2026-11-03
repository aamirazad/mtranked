import { tsr } from "@ts-rest/serverless/fetch";
import type { Http } from "../http";

/** What every route handler gets besides the parsed request. */
export type Ctx = { h: Http; cx: ExecutionContext };
export const s = tsr.platformContext<Ctx>();

export const unauth = { status: 401 as const, body: { message: "Sign in first." } };
export const tooMany = { status: 429 as const, body: { message: "Too many attempts. Try again in a few minutes." } };

export { hub } from "../stubs";
