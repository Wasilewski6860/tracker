import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { config } from "dotenv";
import { Pool } from "pg";
import { assertPlacement, placementError } from "../src/hierarchy";

config({ path: path.resolve(__dirname, "../../../.env") });

test("эпик и ошибка остаются самостоятельными", () => {
  assert.equal(placementError("epic", null), null);
  assert.ok(placementError("epic", "story"));
  assert.equal(placementError("bug", null), null);
  assert.ok(placementError("bug", "epic"));
});

test("история и задача вкладываются только в допустимых родителей", () => {
  assert.equal(placementError("story", "epic"), null);
  assert.equal(placementError("story", null), null);
  assert.ok(placementError("story", "task"));
  assert.equal(placementError("task", "epic"), null);
  assert.equal(placementError("task", "story"), null);
  assert.equal(placementError("task", null), null);
  assert.ok(placementError("task", "bug"));
});

test("подзадача бывает только у задачи или ошибки", () => {
  assert.equal(placementError("subtask", "task"), null);
  assert.equal(placementError("subtask", "bug"), null);
  assert.ok(placementError("subtask", null));
  assert.ok(placementError("subtask", "epic"));
  assert.ok(placementError("subtask", "story"));
  assert.ok(placementError("task", "subtask"));
});

test("база отклоняет цикл и чужой тип родителя", async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userId = randomUUID();
    const projectId = randomUUID();
    const statusId = randomUUID();
    const epicId = randomUUID();
    const taskId = randomUUID();
    await client.query(
      "INSERT INTO users (id, email, name, password_hash, email_verified_at) VALUES ($1, $2, 'Тест', 'x', now())",
      [userId, `${userId}@example.com`],
    );
    await client.query("INSERT INTO projects (id, key, name) VALUES ($1, $2, 'Тест')", [
      projectId,
      `T${projectId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    ]);
    await client.query(
      "INSERT INTO statuses (id, project_id, name, category, position) VALUES ($1, $2, 'Бэклог', 'backlog', 0)",
      [statusId, projectId],
    );
    await client.query(
      `INSERT INTO issues (id, project_id, number, title, type, priority, status_id, reporter_id)
       VALUES ($1, $2, 1, 'Эпик', 'epic', 'medium', $3, $4)`,
      [epicId, projectId, statusId, userId],
    );
    await client.query(
      `INSERT INTO issues (id, project_id, number, title, type, priority, status_id, reporter_id, parent_id)
       VALUES ($1, $2, 2, 'Задача', 'task', 'medium', $3, $4, $5)`,
      [taskId, projectId, statusId, userId, epicId],
    );

    await assertPlacement(client, projectId, undefined, "subtask", taskId);
    await assert.rejects(() => assertPlacement(client, projectId, undefined, "subtask", epicId), /Подзадача/);
    await assert.rejects(() => assertPlacement(client, projectId, epicId, "epic", taskId), /цикл/);
    await assert.rejects(() => assertPlacement(client, projectId, taskId, "task", taskId), /самой себя/);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
