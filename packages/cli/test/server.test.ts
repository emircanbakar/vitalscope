import { once } from "node:events";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createEventBuffer } from "../src/buffer.js";
import { startServer, type RunningServer } from "../src/server.js";
import { fakeSink } from "./helpers.js";

const ORIGIN = "http://localhost:3000";
const batch = JSON.stringify({
  v: 1,
  k: "pk_3f9a0c1d2e4b5a6978c0d1e2",
  sdk: "0.1.1",
  ctx: { sid: "0123456789abcdef", path: "/", device: "desktop" },
  e: [{ t: "pageview", ts: 1730000000000 }],
});

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.shutdown();
  running = undefined;
});

async function start(drainTimeoutMs = 2000) {
  const fake = fakeSink();
  const buffer = createEventBuffer(fake.sink, { flushIntervalMs: 60_000 });
  const app = createApp({ buffer });
  running = await startServer(app, buffer, { port: 0, hostname: "127.0.0.1", drainTimeoutMs });
  const url = `http://127.0.0.1:${running.port}`;
  const post = () => fetch(`${url}/v1/e`, { method: "POST", body: batch, headers: { "Content-Type": "text/plain", Origin: ORIGIN } });
  return { fake, url, post, server: running };
}

// Gerçek HTTP üzerinden: sendBeacon'ın gönderdiği biçim ve kapanış davranışı.
describe("server", () => {
  it("accepts a batch over HTTP", async () => {
    const { url, post } = await start();
    expect((await post()).status).toBe(202);
    expect((await fetch(`${url}/healthz`)).status).toBe(204);
  });

  it("rejects an oversized body over HTTP", async () => {
    const { url } = await start();
    const res = await fetch(`${url}/v1/e`, {
      method: "POST",
      body: "x".repeat(65 * 1024),
      headers: { "Content-Type": "text/plain", Origin: ORIGIN },
    });
    expect(res.status).toBe(413);
  });

  it("on shutdown stops accepting requests and writes what is buffered", async () => {
    const { fake, url, post, server } = await start();
    await post();
    await post();
    expect(fake.written()).toHaveLength(0);

    await expect(server.shutdown()).resolves.toBe(0);

    expect(fake.written()).toHaveLength(2);
    await expect(fetch(`${url}/healthz`)).rejects.toThrow();
  });

  it("reports events it could not write before the timeout", async () => {
    const { fake, post, server } = await start(200);
    await post();
    fake.fail(true);
    await expect(server.shutdown()).resolves.toBe(1);
  });

  it("does not let an unfinished request block shutdown", async () => {
    const { fake, post, server } = await start();
    await post();
    const socket = net.connect(server.port, "127.0.0.1");
    socket.on("error", () => {});
    await once(socket, "connect");
    socket.write(`POST /v1/e HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: text/plain\r\nContent-Length: 1000\r\n\r\n{`);
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(server.shutdown()).resolves.toBe(0);
    expect(fake.written()).toHaveLength(1);
    socket.destroy();
  });

  it("can be asked to shut down twice", async () => {
    const { server } = await start();
    const [first, second] = await Promise.all([server.shutdown(), server.shutdown()]);
    expect([first, second]).toEqual([0, 0]);
  });
});
