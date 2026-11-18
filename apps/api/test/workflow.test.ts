import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { config } from "dotenv";
import { Pool } from "pg";
import { addStatus, addTransition, deleteStatus, shiftStatus, updateStatus } from "../src/workflow-edit";

config({ path: path.resolve(__dirname, "../../../.env") });

test("статус с задачами переносится, последний бэклог остаётся", async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(pool);
  const client = await pool.connect();
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const projectId = randomUUID();
  const backlogId = randomUUID();
  const doneId = randomUUID();
  const issueId = randomUUID();
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
      `W${projectId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    ]);
    await client.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')",
      [projectId, ownerId, memberId],
    );
    await client.query(
      "INSERT INTO statuses (id, project_id, name, category, position) VALUES ($1, $2, 'Бэклог', 'backlog', 0), ($3, $2, 'Готово', 'done', 1)",
      [backlogId, projectId, doneId],
    );
    await client.query(
      `INSERT INTO issues (id, project_id, number, title, type, priority, status_id, reporter_id)
       VALUES ($1, $2, 1, 'Задача', 'task', 'medium', $3, $4)`,
      [issueId, projectId, doneId, ownerId],
    );

    await assert.rejects(() => addStatus(client, projectId, memberId, "Архив", "done"), /владелец/);
    await assert.rejects(() => deleteStatus(client, projectId, ownerId, backlogId), /бэклога/);
    await assert.rejects(() => updateStatus(client, projectId, ownerId, backlogId, { category: "todo" }), /бэклога/);
    await assert.rejects(() => deleteStatus(client, projectId, ownerId, doneId), /куда их перенести/);

    await deleteStatus(client, projectId, ownerId, doneId, backlogId);
    const moved = await client.query<{ status_id: string }>("SELECT status_id FROM issues WHERE id = $1", [issueId]);
    assert.equal(moved.rows[0]?.status_id, backlogId);
    const events = await client.query<{ kind: string; payload: { from: string; to: string } }>(
      "SELECT kind, payload FROM activities WHERE issue_id = $1",
      [issueId],
    );
    assert.equal(events.rows[0]?.kind, "status_changed");
    assert.equal(events.rows[0]?.payload.from, "Готово");
    assert.equal(events.rows[0]?.payload.to, "Бэклог");

    const extra = await addStatus(client, projectId, ownerId, "На проверке", "review");
    await addTransition(client, projectId, ownerId, backlogId, extra);
    await assert.rejects(() => addTransition(client, projectId, ownerId, backlogId, extra), /уже есть/);
    await shiftStatus(client, projectId, ownerId, extra, "left");
    const order = await client.query<{ name: string }>(
      "SELECT name FROM statuses WHERE project_id = $1 ORDER BY position",
      [projectId],
    );
    assert.deepEqual(
      order.rows.map((row) => row.name),
      ["На проверке", "Бэклог"],
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
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
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
