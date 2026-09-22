/** One-time setup: install frontend (npm) and backend (Python venv + pip) dependencies. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { BACKEND, ROOT, python } from "./venv.mjs";

const run = (cmd, args, cwd = ROOT) => {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run("npm", ["--prefix", "frontend", "install"]);
if (!existsSync(python)) run(process.platform === "win32" ? "python" : "python3", ["-m", "venv", ".venv"], BACKEND);
run(python, ["-m", "pip", "install", "-q", "-r", resolve(BACKEND, "requirements-dev.txt")]);
console.log("\nSetup complete. Start everything with:  npm run dev");
