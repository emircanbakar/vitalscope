// Panelin build çıktısı CLI paketine girer; `vitalscope dev` onu dist/panel klasöründen sunar.
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const target = join(root, "dist/panel");
rmSync(target, { recursive: true, force: true });
cpSync(join(root, "../../apps/panel/dist"), target, { recursive: true });
