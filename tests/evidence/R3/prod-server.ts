// R3 phase 2: the production page as it is served: the built dist through server/hosting.ts's servePage (its safety headers and
// content types included), with the API sent on to a mocked server. Run: pnpm exec vite build; then
//   PROD_PORT=18965 API_PORT=18961 pnpm exec tsx tests/evidence/R3/prod-server.ts
import { serve } from "@hono/node-server";
import { servePage } from "../../../server/hosting";

const api = process.env.API_PORT ?? "18961";
const app = servePage({ fetch: (req: Request) => {
  const u = new URL(req.url);
  return fetch(`http://localhost:${api}${u.pathname}${u.search}`, { method: req.method, headers: req.headers, ...(req.method === "GET" || req.method === "HEAD" ? {} : { body: req.body, duplex: "half" }) } as RequestInit);
} });
serve({ fetch: app.fetch, port: Number(process.env.PROD_PORT ?? 18965) }, (i) => console.log(`the built page on ${i.port}`));
