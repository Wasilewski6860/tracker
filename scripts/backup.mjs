import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "backups");
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join(dir, `tracker-${stamp}.sql`);
const user = process.env.POSTGRES_USER || "tracker";
const database = process.env.POSTGRES_DB || "tracker";
const composeFile = process.env.COMPOSE_FILE || "docker-compose.yml";

const out = fs.createWriteStream(file);
const child = spawn(
  "docker",
  ["compose", "-f", composeFile, "exec", "-T", "postgres", "pg_dump", "-U", user, "-d", database, "--no-owner"],
  { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
);
child.stdout.pipe(out);

child.on("close", (code) => {
  if (code !== 0) {
    fs.rmSync(file, { force: true });
    process.exit(code ?? 1);
  }
  const dumps = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith("tracker-") && name.endsWith(".sql"))
    .sort();
  for (const old of dumps.slice(0, Math.max(0, dumps.length - 14))) {
    fs.rmSync(path.join(dir, old), { force: true });
  }
  console.log(file);
});
