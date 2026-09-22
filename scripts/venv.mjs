/** Shared helper: locate the backend virtualenv's executables (cross-platform). */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BACKEND = resolve(ROOT, "backend");
const bin = process.platform === "win32" ? "Scripts" : "bin";
const exe = (name) => resolve(BACKEND, ".venv", bin, process.platform === "win32" ? `${name}.exe` : name);

export const python = exe("python");
export const uvicorn = exe("uvicorn");

export function requireVenv() {
  if (!existsSync(python)) {
    console.error("Backend virtualenv not found. Run:  npm run setup");
    process.exit(1);
  }
}
