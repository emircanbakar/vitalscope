// e2e testleri için sahte ingest: gelen gövdeleri bellekte, test başına ayrı tutar.
// Playwright'ın `route` yakalamasından bağımsızdır; sayfa kapanırken giden istekler de gerçek ağdan gelir.
// Node'un TypeScript desteğiyle doğrudan çalışır: `node e2e/ingest-server.ts`.
import { createServer } from "node:http";

const INGEST_PORT = 4174;
const MAX_BODY_BYTES = 64 * 1024;

const runs = new Map<string, string[]>();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${INGEST_PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");

  const ingest = /^\/v1\/e\/([\w-]+)$/.exec(url.pathname);
  if (req.method === "POST" && ingest) {
    const run = ingest[1] ?? "";
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) req.destroy();
    });
    req.on("end", () => {
      runs.set(run, [...(runs.get(run) ?? []), body]);
      res.writeHead(204).end();
    });
    return;
  }

  const read = /^\/runs\/([\w-]+)$/.exec(url.pathname);
  if (req.method === "GET" && read) {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(runs.get(read[1] ?? "") ?? []));
    return;
  }

  if (url.pathname === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  res.writeHead(404).end();
});

server.listen(INGEST_PORT, "127.0.0.1");
