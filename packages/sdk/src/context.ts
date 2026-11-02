import { LIMITS, type ContextInput } from "@vitalscope/protocol";
import type { ResolvedConfig } from "./config.js";

/** Kişiyi değil tek bir sekme oturumunu ilişkilendirir; sadece bellekte tutulur. */
export function createSessionId(): string {
  const bytes = new Uint8Array(LIMITS.sessionIdLength / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getDevice(): ContextInput["device"] {
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (!coarse) return "desktop";
  return innerWidth < 768 ? "mobile" : "tablet";
}

export function buildContext(config: ResolvedConfig, sid: string): ContextInput {
  const ctx: ContextInput = {
    sid,
    // pathname query ve hash içermez
    path: location.pathname.slice(0, LIMITS.maxPathLength),
    env: config.environment,
    device: getDevice(),
  };
  if (config.release !== undefined) ctx.release = config.release;
  return ctx;
}
