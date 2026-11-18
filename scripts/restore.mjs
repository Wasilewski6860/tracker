import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("Укажите существующий файл дампа: node scripts/restore.mjs backups/tracker-....sql");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const user = process.env.POSTGRES_USER || "tracker";
const database = process.env.POSTGRES_DB || "tracker";
const composeFile = process.env.COMPOSE_FILE || "docker-compose.yml";
const input = fs.createReadStream(path.resolve(file));
const child = spawn(
  "docker",
  ["compose", "-f", composeFile, "exec", "-T", "postgres", "psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1"],
  { cwd: root, stdio: ["pipe", "inherit", "inherit"] },
);
input.pipe(child.stdin);
child.on("close", (code) => process.exit(code ?? 1));
