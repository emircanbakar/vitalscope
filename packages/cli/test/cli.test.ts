import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isSupportedNode } from "../src/node-version.js";

const entry = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "vitalscope-cli-"));
  dirs.push(dir);
  return dir;
}

function launch(args: string[]) {
  const child = spawn(process.execPath, [entry, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  const output = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk) => (output.stdout += chunk));
  child.stderr.on("data", (chunk) => (output.stderr += chunk));
  return { child, output };
}

async function run(args: string[]) {
  const { child, output } = launch(args);
  const [code] = await once(child, "exit");
  return { code, ...output };
}

async function startDev(dir: string) {
  const { child, output } = launch(["dev", "--port", "0", "--dir", dir]);
  await once(child.stdout, "data");
  const port = /localhost:(\d+)/.exec(output.stdout)?.[1];
  return { child, port: Number(port), output };
}

describe("isSupportedNode", () => {
  it.each(["24.15.0", "24.22.1", "25.0.0", "26.1.0"])("accepts %s", (version) => {
    expect(isSupportedNode(version)).toBe(true);
  });
  it.each(["24.14.9", "22.20.0", "20.0.0", ""])("rejects %j", (version) => {
    expect(isSupportedNode(version)).toBe(false);
  });
});

describe("vitalscope", () => {
  it.each([[[]], [["--help"]], [["-h"]], [["dev", "--help"]]])("prints usage for %j", async (args) => {
    const { code, stdout } = await run(args);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage: vitalscope");
  });

  it.each([
    [["nope"], "Unknown command: nope"],
    [["report", "extra"], "Unknown command: report extra"],
    [["dev", "--unknown"], "--unknown"],
    [["dev", "--port", "abc"], "--port must be"],
    [["dev", "--port", "70000"], "--port must be"],
    [["dev", "--port", "-1"], "--port"],
  ])("rejects %j with exit code 2", async (args, message) => {
    const { code, stderr } = await run(args);
    expect(code).toBe(2);
    expect(stderr).toContain(message);
  });

  it("explains an empty report", async () => {
    const { code, stdout } = await run(["report", "--dir", join(tempDir(), "yok")]);
    expect(code).toBe(0);
    expect(stdout).toContain("No measurements yet");
  });

  it("fails clearly when the data file is not a database", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "vitalscope.db"), "bu bir veritabanı değil, uzun bir metin dosyası");
    const { code, stderr } = await run(["report", "--dir", dir]);
    expect(code).toBe(1);
    expect(stderr).not.toContain("    at ");
  });

  it("explains a busy port", async () => {
    const blocker = net.createServer().listen(0, "127.0.0.1");
    await once(blocker, "listening");
    const { port } = blocker.address() as net.AddressInfo;
    const { code, stderr } = await run(["dev", "--port", String(port), "--dir", tempDir()]);
    blocker.close();
    expect(code).toBe(1);
    expect(stderr).toContain(`Port ${port} is already in use`);
  });

  it("serves the built panel and its data", async () => {
    const { child, port, output } = await startDev(tempDir());
    try {
      expect(output.stdout).toContain(`Panel     http://localhost:${port}/`);
      const page = await fetch(`http://127.0.0.1:${port}/`);
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(page.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
      const script = /src="([^"]+\.js)"/.exec(html)?.[1];
      const code = await fetch(`http://127.0.0.1:${port}${script}`);
      expect(code.status).toBe(200);
      expect(code.headers.get("Content-Type")).toContain("javascript");
      expect(await (await fetch(`http://127.0.0.1:${port}/api/options`)).json()).toEqual({ environments: [], pages: [], devices: [] });
    } finally {
      child.kill();
      await once(child, "exit");
    }
  });

  it("collects while running and reports at the same time", async () => {
    const dir = tempDir();
    const { child, port, output } = await startDev(dir);
    expect(output.stdout).toContain(`http://localhost:${port}/v1/e`);
    const body = JSON.stringify({
      v: 1,
      k: "pk_3f9a0c1d2e4b5a6978c0d1e2",
      sdk: "0.1.1",
      ctx: { sid: "0123456789abcdef", path: "/hello", device: "desktop" },
      e: [{ t: "vital", ts: Date.now(), name: "LCP", value: 1500, rating: "good", id: "m1" }],
    });
    const res = await fetch(`http://127.0.0.1:${port}/v1/e`, { method: "POST", body, headers: { "Content-Type": "text/plain", Origin: "http://localhost:3000" } });
    expect(res.status).toBe(202);

    // Tampon en geç 1 sn'de yazar.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const { code, stdout } = await run(["report", "--dir", dir]);
    expect(code).toBe(0);
    expect(stdout).toContain("/hello");
    expect(stdout).toContain("1.50 s");

    child.kill();
    await once(child, "exit");
  });

  // Windows'ta `kill` süreci sinyalsiz öldürür; bu test CI'da (Linux) çalışır.
  it.skipIf(process.platform === "win32")("writes buffered events and exits cleanly on SIGTERM", async () => {
    const dir = tempDir();
    const { child, port } = await startDev(dir);
    const body = JSON.stringify({
      v: 1,
      k: "pk_3f9a0c1d2e4b5a6978c0d1e2",
      sdk: "0.1.1",
      ctx: { sid: "0123456789abcdef", path: "/sigterm", device: "desktop" },
      e: [{ t: "pageview", ts: Date.now() }],
    });
    await fetch(`http://127.0.0.1:${port}/v1/e`, { method: "POST", body, headers: { "Content-Type": "text/plain", Origin: "http://localhost:3000" } });

    child.kill("SIGTERM");
    const [code] = await once(child, "exit");
    expect(code).toBe(0);
    expect((await run(["report", "--dir", dir])).stdout).toContain("/sigterm");
  });
});
