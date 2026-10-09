import { reportError } from "./sentry";
import express from "express";
import cookieParser from "cookie-parser";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@mtr/contracts";
import { env } from "./env";
import { authRouter } from "./routes/auth";
import { meRouter, usersRouter, leaderboardRoute, seasonRoute, matchRoute, reportRoute } from "./routes/users";
import { modRouter } from "./routes/mod";
import { billingRouter, stripeWebhook } from "./routes/billing";

const app = express();
app.set("trust proxy", env.trustProxy);
app.disable("x-powered-by");
app.use(stripeWebhook());
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => void res.json({ ok: true }));

const s = initServer();
const router = s.router(contract, {
  auth: authRouter,
  me: meRouter,
  users: usersRouter,
  leaderboard: leaderboardRoute,
  season: seasonRoute,
  match: matchRoute,
  report: reportRoute,
  mod: modRouter,
  billing: billingRouter,
});

createExpressEndpoints(contract, router, app, {
  requestValidationErrorHandler: (err, _req, res) => {
    const issue = err.body?.issues[0] ?? err.query?.issues[0] ?? err.pathParams?.issues[0];
    const fields: Record<string, string> = {};
    for (const i of err.body?.issues ?? []) fields[String(i.path[0])] = i.message;
    res.status(400).json({ message: issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid request", fields });
  },
});

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  reportError("[api] request failed", err, { route: `${req.method} ${req.path}` });
  res.status(500).json({ message: "Something went wrong on our side." });
});

app.listen(env.port, () => console.log(`api listening on :${env.port}`));
