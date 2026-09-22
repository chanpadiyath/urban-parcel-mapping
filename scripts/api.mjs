/**
 * Backend launcher (no need to activate the venv):
 *   node scripts/api.mjs               dev server with auto-reload on :8787
 *   node scripts/api.mjs test          pytest
 *   node scripts/api.mjs job <name>    run backend/jobs/<name>.py (extra args pass through)
 */
import { spawn } from "node:child_process";
import { BACKEND, python, requireVenv, uvicorn } from "./venv.mjs";

requireVenv();
const [mode, ...rest] = process.argv.slice(2);
const port = process.env.SIM_PORT ?? "8787";

let cmd, args;
if (mode === "test") [cmd, args] = [python, ["-m", "pytest", "-q", ...rest]];
else if (mode === "job") [cmd, args] = [python, ["-m", `jobs.${rest[0]}`, ...rest.slice(1)]];
else [cmd, args] = [uvicorn, ["app.main:app", "--reload", "--reload-dir", "app", "--port", port]];

const child = spawn(cmd, args, { cwd: BACKEND, stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
