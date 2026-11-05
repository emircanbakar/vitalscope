import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import type { EventBuffer } from "./buffer.js";

/** Kapanışta tamponu yazmak için tanınan süre; orkestratörün `SIGKILL` süresinden kısa olmalı. */
const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;
/** Bitmeyen bir istek (yavaş gönderen istemci) tamponun yazılmasını engellemesin. */
const CLOSE_GRACE_MS = 2_000;

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
  return new Promise((resolve, reject) => {
    const options = hostname ? { fetch: app.fetch, port, hostname } : { fetch: app.fetch, port };
    const server = serve(options, (info: AddressInfo) => {
      server.off("error", reject);
      let closing: Promise<number> | undefined;
      resolve({
        port: info.port,
        shutdown: () =>
          (closing ??= new Promise<void>((closed) => {
            const force = setTimeout(() => {
              if ("closeAllConnections" in server) server.closeAllConnections();
            }, CLOSE_GRACE_MS);
            server.close(() => {
              clearTimeout(force);
              closed();
            });
            // Boştaki keep-alive bağlantıları kapanışı bekletmesin.
            if ("closeIdleConnections" in server) server.closeIdleConnections();
          }).then(() => buffer.drain(drainTimeoutMs))),
      });
    });
    // Port doluysa süreç yakalanmamış hatayla düşmesin; çağıran açıklamalı mesaj yazar.
    server.once("error", reject);
  });
}
