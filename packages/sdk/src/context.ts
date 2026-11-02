import { LIMITS, type ContextInput } from "@vitalscope/protocol";
import type { ResolvedConfig } from "./config.js";
import { getActivationStart, getNavigationEntry } from "./navigation-timing.js";

const CONNECTIONS: readonly string[] = ["slow-2g", "2g", "3g", "4g"];
const NAV_TYPES: readonly string[] = ["navigate", "reload", "back_forward", "prerender"];

let restored = false;

/** bfcache'ten dönen sayfanın bundan sonraki olayları `nav: "restore"` taşır. */
export function markRestored(): void {
  restored = true;
}

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

function getConnection(): ContextInput["conn"] {
  const type = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType;
  return type !== undefined && CONNECTIONS.includes(type) ? (type as ContextInput["conn"]) : undefined;
}

function getNavigationType(): ContextInput["nav"] {
  if (restored) return "restore";
  if (getActivationStart() > 0) return "prerender";
  const type = getNavigationEntry()?.type;
  return type !== undefined && NAV_TYPES.includes(type) ? (type as ContextInput["nav"]) : undefined;
}

export function buildContext(config: ResolvedConfig, sid: string): ContextInput {
  const ctx: ContextInput = {
    sid,
    // pathname query ve hash içermez
    path: location.pathname.slice(0, LIMITS.maxPathLength),
    env: config.environment,
    device: getDevice(),
    sr: config.sampleRate,
  };
  if (config.release !== undefined) ctx.release = config.release;
  const conn = getConnection();
  if (conn) ctx.conn = conn;
  const nav = getNavigationType();
  if (nav) ctx.nav = nav;
  return ctx;
}
