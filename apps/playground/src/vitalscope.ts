import { init } from "@vitalscope/sdk";
import { config } from "./config.js";

// `init` süresi performans bütçesi testinde okunur.
const start = performance.now();
init(config);
performance.measure("vitalscope:init", { start });
