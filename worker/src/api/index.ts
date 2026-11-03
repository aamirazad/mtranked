import { fetchRequestHandler, RequestValidationError, TsRestHttpError, TsRestResponse } from "@ts-rest/serverless/fetch";
import { contract } from "@mtr/contracts";
import { http } from "../http";
import { reportError } from "../sentry";
import { authRouter } from "./auth";
import { billingRouter, stripeWebhook } from "./billing";
import { friendsRouter } from "./friends";
import { modRouter } from "./mod";
import { practiceRouter } from "./practice";
import { s } from "./tsr";
import { leaderboardRoute, matchRoute, meRouter, reportRoute, seasonRoute, usersRouter } from "./users";

const router = s.router(contract, {
  auth: authRouter,
  me: meRouter,
  users: usersRouter,
  leaderboard: leaderboardRoute,
  season: seasonRoute,
  match: matchRoute,
  report: reportRoute,
  practice: practiceRouter,
  friends: friendsRouter,
  mod: modRouter,
  billing: billingRouter,
});

const MAX_BODY = 100 * 1024;

function errorHandler(err: unknown, req: Request) {
  if (err instanceof RequestValidationError) {
    const issue = err.bodyError?.issues[0] ?? err.queryError?.issues[0] ?? err.pathParamsError?.issues[0];
    const fields: Record<string, string> = {};
    for (const i of err.bodyError?.issues ?? []) fields[String(i.path[0])] = i.message;
    const message = issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid request";
    return TsRestResponse.fromJson({ message, fields }, { status: 400 });
  }
  // ts-rest's own client errors (e.g. 404 for an unknown route) are expected, not bugs
  if (err instanceof TsRestHttpError && err.statusCode < 500) {
    return TsRestResponse.fromJson(err.body, { status: err.statusCode });
  }
  reportError("[api] request failed", err, { route: `${req.method} ${new URL(req.url).pathname}` });
  return TsRestResponse.fromJson({ message: "Something went wrong on our side." }, { status: 500 });
}

export async function handleApi(request: Request, cx: ExecutionContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/health") return Response.json({ ok: true });
  if (pathname === "/api/billing/webhook" && request.method === "POST") return stripeWebhook(request);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
    return Response.json({ message: "Request too large." }, { status: 413 });
  }
  const out = new Headers();
  const res: Response = await fetchRequestHandler({
    request,
    contract,
    router,
    options: { errorHandler, responseValidation: false },
    platformContext: { h: http(request, out), cx },
  });
  const final = new Response(res.body, res);
  for (const c of out.getSetCookie()) final.headers.append("set-cookie", c);
  // API responses are per-user; never let a cache keep them
  final.headers.set("cache-control", "no-store");
  return final;
}
