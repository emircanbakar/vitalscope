import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

// `vitalscope run` kendi Chromium'unu açar; tarayıcı projesinden bağımsız, sadece bir kez çalışır.
const CLI = resolve(import.meta.dirname, "../../../packages/cli/dist/cli.js");
const SITE = "http://localhost:4173";

test("vitalscope run measures a scenario and compares it with the previous run", async ({ browserName }) => {
  test.skip(browserName !== "chromium", "run uses its own Chromium");
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), "vitalscope-run-"));
  const port = 4195 + test.info().parallelIndex;
  try {
    const scenario = join(dir, "buy.mjs");
    writeFileSync(scenario, `export default async ({ page }) => { await page.click("#buy"); await page.waitForTimeout(300); };`);
    const url = `${SITE}/attribution/?endpoint=${encodeURIComponent(`http://localhost:${port}/v1/e`)}`;
    const run = async (label: string) => {
      const child = spawn(process.execPath, [CLI, "run", scenario, "--url", url, "--port", String(port), "--dir", join(dir, "data"), "--runs", "2", "--cpu", "1", "--label", label, "--json"], {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      const [code] = await once(child, "exit");
      expect(code, stderr).toBe(0);
      expect(stderr).toContain("Session 2/2 done");
      return JSON.parse(stdout);
    };

    const first = await run("first");
    expect(first).toMatchObject({ label: "first", scenario: "buy.mjs", runs: 2, sessions: 2, pageViews: 2, previous: null });
    const inp = first.metrics.find((m: { name: string }) => m.name === "INP");
    expect(inp.count).toBe(2);
    // Sayfadaki buton tıklamada 150 ms meşgul eder.
    expect(inp.median).toBeGreaterThanOrEqual(150);
    expect(first.interactions[0]).toMatchObject({ target: "button#buy", inInp: true });

    const second = await run("second");
    expect(second.previous).toMatchObject({ label: "first", sessions: 2 });
    // İki oturumla hüküm verilmez.
    expect(second.changes.INP).toEqual({ kind: "too-few" });
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
