// Yayın betiği; sadece .github/workflows/release.yml çalıştırır. Node'un TypeScript desteğiyle: `node scripts/release.ts`.
//   check   → npm'de henüz olmayan paket sürümlerini GITHUB_OUTPUT'a `unpublished` olarak yazar
//   publish → o sürümleri trusted publishing (OIDC) ile yayınlar, her biri için GitHub release'i açar;
//             SDK release notuna dist dosyalarının SHA-384 özetleri ve script etiketi için SRI değeri eklenir
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Sıra önemli: CLI, yayınlanmış protokol sürümüne bağlıdır.
const PACKAGES = ["packages/protocol", "packages/sdk", "packages/cli"];
/** Trusted publishing için gereken en düşük npm sürümü. */
const MIN_NPM = [11, 5, 1];

interface Pkg {
  dir: string;
  name: string;
  version: string;
  private?: boolean;
}

const run = (command: string, args: string[], cwd?: string) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

function isPublished({ name, version }: Pkg): boolean {
  try {
    return run("npm", ["view", `${name}@${version}`, "version"]) === version;
  } catch {
    // Paket hiç yoksa npm 404 ile çıkar.
    return false;
  }
}

function unpublished(): Pkg[] {
  return PACKAGES.map((dir) => ({ dir, ...JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) }) as Pkg)
    .filter((pkg) => !pkg.private && !isPublished(pkg));
}

const sri = (file: string) => `sha384-${createHash("sha384").update(readFileSync(file)).digest("base64")}`;
const sha384 = (file: string) => createHash("sha384").update(readFileSync(file)).digest("hex");

function releaseNotes(pkg: Pkg): string {
  const changelog = readFileSync(join(pkg.dir, "CHANGELOG.md"), "utf8");
  // Bu sürümün bölümü: `## <sürüm>` başlığından bir sonraki `## ` başlığına kadar.
  const section = changelog.split(/^## /m).find((part) => part.startsWith(`${pkg.version}\n`));
  const notes = [section ? section.slice(pkg.version.length).trim() : ""];
  const dist = join(pkg.dir, "dist");
  if (pkg.name === "@vitalscope/sdk") {
    const url = `https://cdn.jsdelivr.net/npm/${pkg.name}@${pkg.version}/dist/vitalscope.iife.js`;
    notes.push(
      "### Script etiketi",
      [
        "```html",
        `<script async src="${url}"`,
        `  integrity="${sri(join(dist, "vitalscope.iife.js"))}"`,
        '  crossorigin="anonymous"',
        '  data-key="pk_…" data-endpoint="https://…/v1/e"></script>',
        "```",
      ].join("\n"),
    );
  }
  const files = readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  notes.push(
    "### dist SHA-384",
    ["```", ...files.map((file) => `${sha384(file)}  ${file.slice(pkg.dir.length + 1)}`), "```"].join("\n"),
  );
  return notes.join("\n\n");
}

function publish(pkg: Pkg): void {
  // `pnpm pack` workspace: bağımlılıklarını gerçek sürümlere çevirir; yayın OIDC için npm CLI ile yapılır.
  const tarball = run("pnpm", ["pack", "--pack-destination", "."], pkg.dir).split("\n").at(-1)!;
  run("npm", ["publish", `./${tarball}`, "--access", "public"], pkg.dir);
  const tag = `${pkg.name}@${pkg.version}`;
  const notesFile = join(pkg.dir, "release-notes.md");
  writeFileSync(notesFile, releaseNotes(pkg));
  run("gh", ["release", "create", tag, "--title", tag, "--notes-file", notesFile, "--target", process.env.GITHUB_SHA ?? "main"]);
}

const mode = process.argv[2];
if (mode === "check") {
  const names = unpublished().map((pkg) => `${pkg.name}@${pkg.version}`);
  console.log(names.length ? `Yayınlanacak: ${names.join(", ")}` : "Yayınlanacak sürüm yok.");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `unpublished=${names.join(" ")}\n`);
} else if (mode === "publish") {
  const npm = run("npm", ["--version"]).split(".").map(Number);
  const differs = MIN_NPM.findIndex((part, i) => npm[i] !== part);
  if (differs >= 0 && (npm[differs] ?? 0) < MIN_NPM[differs]!) {
    throw new Error(`npm ${npm.join(".")} trusted publishing için çok eski (en az ${MIN_NPM.join(".")}).`);
  }
  for (const pkg of unpublished()) publish(pkg);
} else {
  throw new Error("Kullanım: node scripts/release.ts check|publish");
}
