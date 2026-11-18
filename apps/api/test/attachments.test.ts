import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { config } from "dotenv";
import { Pool } from "pg";
import {
  contentDisposition,
  parseMultipartFile,
  removeAttachment,
  safeFileName,
  storagePath,
  storeAttachment,
  unlinkStored,
} from "../src/attachments";
import { HttpError } from "../src/http";

config({ path: path.resolve(__dirname, "../../../.env") });

test("имя файла не выходит из каталога и не бывает программой", () => {
  assert.equal(safeFileName("заметка.txt"), "заметка.txt");
  assert.equal(safeFileName("..\\..\\windows\\system.ini"), "system.ini");
  assert.equal(safeFileName("report.PDF"), "report.PDF");
  assert.equal(safeFileName("setup.exe"), null);
  assert.equal(safeFileName("page.html"), null);
  assert.equal(safeFileName("icon.svg"), null);
  assert.equal(safeFileName(""), null);
  assert.match(contentDisposition("заметка.txt"), /filename\*=UTF-8''/);
});

test("из формы читается один файл", () => {
  const body = Buffer.from(
    '--edge\r\nContent-Disposition: form-data; name="file"; filename="заметка.txt"\r\nContent-Type: text/plain\r\n\r\nпривет\r\n--edge--\r\n',
    "utf8",
  );
  const file = parseMultipartFile(body, 'multipart/form-data; boundary=edge');
  assert.equal(file?.filename, "заметка.txt");
  assert.equal(file?.mime, "text/plain");
  assert.equal(file?.bytes.toString("utf8"), "привет");
  assert.equal(parseMultipartFile(body, "text/plain"), null);
});

test("файл пишется под случайным ключом и удаляется с проверкой прав", async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(pool);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-files-"));
  const client = await pool.connect();
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const projectId = randomUUID();
  const statusId = randomUUID();
  const issueId = randomUUID();
  let storageKey = "";
  try {
    await client.query("BEGIN");
    for (const [id, name] of [
      [ownerId, "Владелец"],
      [memberId, "Участник"],
    ] as const) {
      await client.query(
        "INSERT INTO users (id, email, name, password_hash, email_verified_at) VALUES ($1, $2, $3, 'x', now())",
        [id, `${id}@example.com`, name],
      );
    }
    await client.query("INSERT INTO projects (id, key, name) VALUES ($1, $2, 'Тест')", [
      projectId,
      `A${projectId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    ]);
    await client.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')",
      [projectId, ownerId, memberId],
    );
    await client.query(
      "INSERT INTO statuses (id, project_id, name, category, position) VALUES ($1, $2, 'Бэклог', 'backlog', 0)",
      [statusId, projectId],
    );
    await client.query(
      `INSERT INTO issues (id, project_id, number, title, type, priority, status_id, reporter_id)
       VALUES ($1, $2, 1, 'Задача', 'task', 'medium', $3, $4)`,
      [issueId, projectId, statusId, ownerId],
    );

    await assert.rejects(
      () => storeAttachment(client, dir, issueId, ownerId, { name: "run.exe", mime: "application/octet-stream", bytes: Buffer.from("x") }),
      (error: unknown) => error instanceof HttpError && error.status === 400,
    );
    const saved = await storeAttachment(client, dir, issueId, ownerId, {
      name: "заметка.txt",
      mime: "text/plain",
      bytes: Buffer.from("привет"),
    });
    storageKey = saved.storageKey;
    assert.equal(fs.readFileSync(storagePath(dir, storageKey), "utf8"), "привет");
    await assert.rejects(() => removeAttachment(client, issueId, memberId, saved.id), /автор или владелец/);
    const key = await removeAttachment(client, issueId, ownerId, saved.id);
    assert.equal(key, storageKey);
    const left = await client.query("SELECT 1 FROM attachments WHERE id = $1", [saved.id]);
    assert.equal(left.rowCount, 0);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    if (storageKey) await unlinkStored(dir, storageKey);
    fs.rmSync(dir, { recursive: true, force: true });
    await pool.end();
  }
});

async function migrate(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const migrations = path.resolve(__dirname, "../migrations");
  const files = fs.readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const existing = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
    if (existing.rowCount) continue;
    const sql = fs.readFileSync(path.join(migrations, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
