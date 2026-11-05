#!/usr/bin/env node
import { MIN_NODE, isSupportedNode } from "./node-version.js";

// Komutlar sürüm kontrolünden sonra yüklenir: eski Node'da `node:sqlite` importu anlaşılmaz bir hata verir.
if (isSupportedNode(process.versions.node)) {
  const { run } = await import("./commands.js");
  process.exitCode = await run(process.argv.slice(2));
} else {
  console.error(`vitalscope needs Node ${MIN_NODE} or newer (found ${process.version}).`);
  process.exitCode = 1;
}
