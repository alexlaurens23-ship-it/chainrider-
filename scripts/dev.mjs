// Zero-dependency concurrent dev runner: spawns the api and web dev servers
// and prefixes their output so the root `npm run dev` needs no extra packages.
import { spawn } from "node:child_process";

const tasks = [
  { name: "api", color: "\x1b[35m", workspace: "@chainrider/api" },
  { name: "web", color: "\x1b[36m", workspace: "@chainrider/web" },
];

const RESET = "\x1b[0m";
const children = [];
let shuttingDown = false;

function pipePrefixed(stream, name, color, out) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) out.write(`${color}[${name}]${RESET} ${line}\n`);
  });
  stream.on("end", () => {
    if (buffer) out.write(`${color}[${name}]${RESET} ${buffer}\n`);
  });
}

for (const task of tasks) {
  const child = spawn(`npm run dev -w ${task.workspace}`, {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipePrefixed(child.stdout, task.name, task.color, process.stdout);
  pipePrefixed(child.stderr, task.name, task.color, process.stderr);
  child.on("exit", (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = code ?? 1;
    for (const other of children) {
      if (other !== child) other.kill();
    }
  });
  children.push(child);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shuttingDown = true;
    for (const child of children) child.kill();
  });
}
