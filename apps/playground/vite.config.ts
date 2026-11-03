import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { defineConfig, type Plugin } from "vite";

const root = import.meta.dirname;

/** Her senaryo kendi klasöründe bir `index.html`; hepsi çok sayfalı build'e girer. */
function pages(dir = root, prefix = ""): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (name === "index.html") entries[prefix || "main"] = path;
    else if (statSync(path).isDirectory() && !["node_modules", "dist", "src", "public", "e2e", "test-results", "playwright-report"].includes(name)) {
      Object.assign(entries, pages(path, prefix ? `${prefix}/${name}` : name));
    }
  }
  return entries;
}

/**
 * Rastgele pikselli PNG: Chromium düşük entropili görselleri LCP adayı saymaz. Attribution senaryosu
 * görselin gerçek bir http adresinden gelmesini ister (data: adresleri gönderilmez), bu yüzden dosya
 * olarak üretilir. Kodlayıcı en sade PNG: tek IDAT, filtresiz RGB satırlar.
 */
function noisePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bit, RGB
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), randomBytes(width * 3)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const HERO_PATH = "attribution/hero.png";

function heroImage(emit: boolean): Plugin {
  const png = noisePng(400, 200);
  return {
    name: "playground-hero-image",
    configureServer(server) {
      server.middlewares.use(`/${HERO_PATH}`, (_req, res) => {
        res.setHeader("Content-Type", "image/png");
        res.end(png);
      });
    },
    generateBundle() {
      if (emit) this.emitFile({ type: "asset", fileName: HERO_PATH, source: png });
    },
  };
}

/**
 * Attribution sayfası ayrı build edilir (`--mode attribution`, aynı `dist`'e). Aynı build'de olsaydı SDK
 * iki giriş noktasının ortak parçasına taşınırdı ve diğer sayfalarda `init`, onu çağıran betikten ayrı
 * bir dosyada kalırdı; performans bütçesi ölçümü SDK'nın uygulama betiğinin içinde olduğu durumu ölçer.
 */
const ATTRIBUTION = "attribution";

export default defineConfig(({ mode }) => {
  const { [ATTRIBUTION]: attribution, ...rest } = pages();
  // Geliştirme sunucusu görseli de sunar; build'de görsel sadece attribution build'inde üretilir.
  if (mode !== ATTRIBUTION) return { plugins: [heroImage(false)], build: { rolldownOptions: { input: rest } } };
  return {
    plugins: [heroImage(true)],
    build: { emptyOutDir: false, rolldownOptions: { input: { [ATTRIBUTION]: attribution! } } },
  };
});
