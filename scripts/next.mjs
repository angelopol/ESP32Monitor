import Module, { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { delimiter } from "node:path";

// Dependencies can live behind a junction whose target is not named node_modules.
// Keep that physical directory available to Next and its child processes.
const dependencies = realpathSync(new URL("../node_modules", import.meta.url));
process.env.NODE_PATH = [dependencies, process.env.NODE_PATH].filter(Boolean).join(delimiter);
Module._initPaths();
createRequire(import.meta.url)("next/dist/bin/next");
