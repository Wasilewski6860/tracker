import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { config } from "dotenv";
import { Pool } from "pg";
import { addIssueLabel, normalizeLabel, removeIssueLabel } from "../src/labels";
import { HttpError } from "../src/http";

config({ path: path.resolve(__dirname, "../../../.env") });

test("название метки короткое и без знаков разметки", () => {
  assert.equal(normalizeLabel("  Релиз  1 "), "Релиз 1");
  assert.equal(normalizeLabel(""), null);
  assert.equal(normalizeLabel("a,b"), null);
  assert.equal(normalizeLabel("<script>"), null);
  assert.equal(normalizeLabel("я".repeat(41)), null);
});

test("метка проекта переиспользуется, снятие с задачи её не удаляет", async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(pool);
  const client = await pool.connect();
  const ownerId = randomUUID();
  const viewerId = randomUUID();
  const projectId = randomUUID();
  const statusId = randomUUID();
  const issueId = randomUUID();
  try {
    await client.query("BEGIN");
    for (const [id, name] of [
      [ownerId, "Владелец"],
      [viewerId, "Наблюдатель"],
    ] as const) {
      await client.query(
        "INSERT INTO users (id, email, name, password_hash, email_verified_at) VALUES ($1, $2, $3, 'x', now())",
        [id, `${id}@example.com`, name],
      );
    }
    await client.query("INSERT INTO projects (id, key, name) VALUES ($1, $2, 'Тест')", [
      projectId,
      `L${projectId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    ]);
    await client.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'viewer')",
      [projectId, ownerId, viewerId],
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

    await assert.rejects(() => addIssueLabel(client, issueId, viewerId, "Релиз"), (error: unknown) => {
      return error instanceof HttpError && error.status === 403;
    });
    const first = await addIssueLabel(client, issueId, ownerId, "Релиз");
    const second = await addIssueLabel(client, issueId, ownerId, "релиз");
    assert.equal(second.id, first.id);
    const stored = await client.query("SELECT name FROM labels WHERE project_id = $1", [projectId]);
    assert.equal(stored.rowCount, 1);
    assert.equal(stored.rows[0]?.name, "Релиз");

    await removeIssueLabel(client, issueId, ownerId, first.id);
    const still = await client.query("SELECT 1 FROM labels WHERE id = $1", [first.id]);
    const linked = await client.query("SELECT 1 FROM issue_labels WHERE issue_id = $1", [issueId]);
    assert.equal(still.rowCount, 1);
    assert.equal(linked.rowCount, 0);
    const events = await client.query<{ kind: string }>(
      "SELECT kind FROM activities WHERE issue_id = $1 ORDER BY kind",
      [issueId],
    );
    assert.deepEqual(
      events.rows.map((row) => row.kind),
      ["label_added", "label_removed"],
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
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
  const dir = path.resolve(__dirname, "../migrations");
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const existing = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
    if (existing.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
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
