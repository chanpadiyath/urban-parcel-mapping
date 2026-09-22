/**
 * Runs the frontend dev server (Vite, :5173) and the backend API (FastAPI, :8787)
 * together with prefixed output. Zero dependencies. Ctrl-C stops both.
 */
import { spawn } from "node:child_process";
import { BACKEND, ROOT, requireVenv, uvicorn } from "./venv.mjs";

requireVenv();
const port = process.env.SIM_PORT ?? "8787";
const procs = [
  { name: "web", cmd: "npm", args: ["--prefix", "frontend", "run", "dev"], cwd: ROOT, color: "\x1b[36m" },
  { name: "api", cmd: uvicorn, args: ["app.main:app", "--reload", "--reload-dir", "app", "--port", port], cwd: BACKEND, color: "\x1b[33m" },
];
const reset = "\x1b[0m";
const children = [];

for (const p of procs) {
  const child = spawn(p.cmd, p.args, { cwd: p.cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  children.push(child);
  const tag = `${p.color}[${p.name}]${reset} `;
  const pipe = (stream) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) process.stdout.write(tag + l + "\n");
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on("exit", (code) => {
    process.stdout.write(tag + `exited (${code})\n`);
    shutdown();
  });
}

function shutdown() {
  for (const c of children) { try { c.kill("SIGTERM"); } catch { /* already gone */ } }
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
