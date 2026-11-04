import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import type { EventBuffer } from "./buffer.js";

/** Kapanışta tamponu yazmak için tanınan süre; orkestratörün `SIGKILL` süresinden kısa olmalı. */
const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

export interface RunningServer {
  port: number;
  /** Yeni istek kabulünü durdurur, açık istekleri bitirir, tamponu boşaltır; kaybolan olay sayısını döner. */
  shutdown(): Promise<number>;
}

export function startServer(
  app: Hono,
  buffer: EventBuffer,
  { port, hostname, drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS }: { port: number; hostname?: string; drainTimeoutMs?: number },
): Promise<RunningServer> {
  return new Promise((resolve) => {
    const options = hostname ? { fetch: app.fetch, port, hostname } : { fetch: app.fetch, port };
    const server = serve(options, (info: AddressInfo) => {
      let closing: Promise<number> | undefined;
      resolve({
        port: info.port,
        shutdown: () =>
          (closing ??= new Promise<void>((closed) => {
            server.close(() => closed());
            // Boştaki keep-alive bağlantıları kapanışı bekletmesin.
            if ("closeIdleConnections" in server) server.closeIdleConnections();
          }).then(() => buffer.drain(drainTimeoutMs))),
      });
    });
  });
}
