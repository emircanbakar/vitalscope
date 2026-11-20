import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildReport } from "./report.js";
import { start } from "./start.js";

const DEFAULT_PORT = 8787;
const DEFAULT_DIR = ".vitalscope";

const DEFAULT_RUNS = 5;

const USAGE = `Usage: vitalscope <command> [options]

Commands:
  dev               Start the local collector and panel
  report            Print p75 metrics and errors from collected data
  run <scenario>    Run a Playwright scenario several times and summarize it

Options:
  --dir <path>      Data folder (default: ${DEFAULT_DIR})
  --port <port>     Collector port, dev and run (default: ${DEFAULT_PORT})
  -h, --help        Show this help

Run options:
  --url <url>       Local page the scenario starts on (required)
  --runs <n>        Sessions, each in a fresh browser context (default: ${DEFAULT_RUNS})
  --cpu <rate>      CPU slowdown: auto, or a number; 1 turns it off (default: auto)
  --label <name>    Name of this run (default: git short SHA)
  --json            Print the summary as JSON
`;

const RUN_OPTIONS = ["url", "runs", "cpu", "label", "json"] as const;

/** Geçersizse kullanıcıya gösterilecek mesajı döner. */
function parseRunOptions(values: Record<string, string | boolean | undefined>, scenario: string | undefined) {
  if (scenario === undefined) return "run needs a scenario file.";
  if (typeof values.url !== "string") return "run needs --url.";
  const runs = values.runs === undefined ? DEFAULT_RUNS : Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 100) return "--runs must be a whole number from 1 to 100.";
  const cpu: number | "auto" = values.cpu === undefined || values.cpu === "auto" ? "auto" : Number(values.cpu);
  if (cpu !== "auto" && !(cpu >= 1 && cpu <= 20)) return "--cpu must be auto or a number from 1 to 20.";
  return { scenario, url: values.url, runs, cpu, json: values.json === true, ...(typeof values.label === "string" && { label: values.label }) };
}

function parsePort(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  return /^\d+$/.test(value) && port <= 65_535 ? port : null;
}

async function dev(port: number, dir: string): Promise<number> {
  let server;
  try {
    server = await start({ port, dir });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    console.error(`Port ${port} is already in use. Pick another one with --port.`);
    return 1;
  }
  console.log(`Vitalscope collector is running.

  Panel     http://localhost:${server.port}/
  Endpoint  http://localhost:${server.port}/v1/e
  Data      ${resolve(dir)}

Press Ctrl+C to stop. Run "vitalscope report" to see the results.`);

  await new Promise<void>((done) => {
    const stop = () => {
      void server.shutdown().then((lost) => {
        if (lost > 0) console.error(`${lost} events could not be written.`);
        done();
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

/** Çıkış kodunu döner: 0 başarılı, 1 çalışma hatası, 2 yanlış kullanım. */
export async function run(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        dir: { type: "string" },
        port: { type: "string" },
        help: { type: "boolean", short: "h" },
        url: { type: "string" },
        runs: { type: "string" },
        cpu: { type: "string" },
        label: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values.help || command === undefined) {
    console.log(USAGE);
    return 0;
  }

  const dir = values.dir ?? DEFAULT_DIR;
  const port = parsePort(values.port);
  const usageError = (message: string) => {
    console.error(`${message}\n\n${USAGE}`);
    return 2;
  };
  if (port === null) return usageError("--port must be a number from 0 to 65535.");
  if (command === "run") {
    const options = parseRunOptions(values, rest[0]);
    if (typeof options === "string") return usageError(options);
    if (rest.length > 1) return usageError(`Unknown command: ${positionals.join(" ")}`);
    try {
      const { runScenario } = await import("./run.js");
      console.log(await runScenario({ ...options, dir, port }));
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Unknown error");
      return 1;
    }
  }
  const runOnly = RUN_OPTIONS.filter((name) => values[name] !== undefined);
  if ((command !== "dev" && command !== "report") || rest.length > 0) return usageError(`Unknown command: ${positionals.join(" ")}`);
  if (runOnly.length > 0) return usageError(`--${runOnly[0]} is only for run.`);

  try {
    if (command === "dev") return await dev(port, dir);
    console.log(buildReport(dir));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unknown error");
    return 1;
  }
}
