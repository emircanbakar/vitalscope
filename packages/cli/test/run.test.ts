import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { RunError, runScenario } from "../src/run.js";

const dir = mkdtempSync(join(tmpdir(), "vitalscope-run-"));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("explains how to install Playwright when it is missing", async () => {
  const scenario = join(dir, "scenario.mjs");
  writeFileSync(scenario, "export default async () => {};");
  const missing = () => Promise.reject(Object.assign(new Error("Cannot find package 'playwright'"), { code: "ERR_MODULE_NOT_FOUND" }));
  const run = runScenario({ scenario, url: "http://localhost:3000/", runs: 1, cpu: 1, dir, port: 0, json: false }, missing);
  await expect(run).rejects.toBeInstanceOf(RunError);
  await expect(run).rejects.toThrow("npx playwright install chromium");
});
