import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildReport } from "./report.js";
import { start } from "./start.js";

const DEFAULT_PORT = 8787;
const DEFAULT_DIR = ".vitalscope";

const USAGE = `Usage: vitalscope <command> [options]

Commands:
  dev       Start the local collector
  report    Print p75 metrics and errors from collected data

Options:
  --dir <path>   Data folder (default: ${DEFAULT_DIR})
  --port <port>  Collector port, dev only (default: ${DEFAULT_PORT})
  -h, --help     Show this help
`;

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
      options: { dir: { type: "string" }, port: { type: "string" }, help: { type: "boolean", short: "h" } },
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
  if ((command !== "dev" && command !== "report") || rest.length > 0 || port === null) {
    console.error(`${port === null ? "--port must be a number from 0 to 65535." : `Unknown command: ${positionals.join(" ")}`}\n\n${USAGE}`);
    return 2;
  }

  try {
    if (command === "dev") return await dev(port, dir);
    console.log(buildReport(dir));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unknown error");
    return 1;
  }
}
