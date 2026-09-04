/**
 * Runs the Vite dev server and the simulation backend together.
 * Zero dependencies — just spawns both and forwards output. Ctrl-C stops both.
 */
import { spawn } from "node:child_process";

const procs = [
  { name: "web", cmd: "npm", args: ["run", "dev"], color: "\x1b[36m" },
  { name: "api", cmd: "npm", args: ["run", "server"], color: "\x1b[33m" },
];
const reset = "\x1b[0m";
const children = [];

for (const p of procs) {
  const child = spawn(p.cmd, p.args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
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
