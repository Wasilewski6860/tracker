import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { config } from "dotenv";
import { Pool } from "pg";
import { commentAccess, editComment, removeComment } from "../src/comments";
import { migrate, pool } from "../src/db";
import { HttpError } from "../src/http";

config({ path: path.resolve(__dirname, "../../../.env") });

test("комментарий меняет автор, удаляет автор или владелец", () => {
  assert.deepEqual(commentAccess("member", "author", "author"), { edit: true, remove: true });
  assert.deepEqual(commentAccess("owner", "author", "owner"), { edit: false, remove: true });
  assert.deepEqual(commentAccess("member", "author", "other"), { edit: false, remove: false });
  assert.deepEqual(commentAccess("viewer", "author", "author"), { edit: false, remove: false });
});

test("правка и удаление комментария пишут новые события и не затирают старые", async () => {
  await migrate();
  const client = await pool.connect();
  const ownerId = randomUUID();
  const authorId = randomUUID();
  const otherId = randomUUID();
  const viewerId = randomUUID();
  const projectId = randomUUID();
  const statusId = randomUUID();
  const issueId = randomUUID();
  const commentId = randomUUID();
  const ownCommentId = randomUUID();
  try {
    await client.query("BEGIN");
    for (const [id, name] of [
      [ownerId, "Владелец"],
      [authorId, "Автор"],
      [otherId, "Участник"],
      [viewerId, "Наблюдатель"],
    ] as const) {
      await client.query(
        "INSERT INTO users (id, email, name, password_hash, email_verified_at) VALUES ($1, $2, $3, 'x', now())",
        [id, `${id}@example.com`, name],
      );
    }
    await client.query("INSERT INTO projects (id, key, name) VALUES ($1, $2, 'Тест')", [
      projectId,
      `C${projectId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    ]);
    for (const [id, role] of [
      [ownerId, "owner"],
      [authorId, "member"],
      [otherId, "member"],
      [viewerId, "viewer"],
    ] as const) {
      await client.query(
        "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)",
        [projectId, id, role],
      );
    }
    await client.query(
      "INSERT INTO statuses (id, project_id, name, category, position) VALUES ($1, $2, 'Бэклог', 'backlog', 0)",
      [statusId, projectId],
    );
    await client.query(
      `INSERT INTO issues (id, project_id, number, title, type, priority, status_id, reporter_id)
       VALUES ($1, $2, 1, 'Задача', 'task', 'medium', $3, $4)`,
      [issueId, projectId, statusId, authorId],
    );
    await client.query(
      "INSERT INTO comments (id, issue_id, author_id, body) VALUES ($1, $2, $3, 'было'), ($4, $2, $3, 'своё')",
      [commentId, issueId, authorId, ownCommentId],
    );
    await client.query(
      `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
       VALUES ($1, $2, $3, 'comment_added', $4::jsonb)`,
      [randomUUID(), issueId, authorId, JSON.stringify({ commentId })],
    );

    await assert.rejects(() => editComment(client, issueId, commentId, otherId, "чужое"), /только автор/);
    await assert.rejects(() => editComment(client, issueId, commentId, ownerId, "владелец"), /только автор/);
    await assert.rejects(() => editComment(client, issueId, commentId, viewerId, "смотрит"), /Недостаточно прав/);

    await editComment(client, issueId, commentId, authorId, "было");
    await editComment(client, issueId, commentId, authorId, "стало");
    const edited = await client.query<{ body: string; edited_at: Date | null }>(
      "SELECT body, edited_at FROM comments WHERE id = $1",
      [commentId],
    );
    assert.equal(edited.rows[0]?.body, "стало");
    assert.ok(edited.rows[0]?.edited_at);

    await assert.rejects(() => removeComment(client, issueId, commentId, otherId), /автор или владелец/);
    await removeComment(client, issueId, commentId, ownerId);
    const gone = await client.query("SELECT 1 FROM comments WHERE id = $1", [commentId]);
    assert.equal(gone.rowCount, 0);

    await removeComment(client, issueId, ownCommentId, authorId);

    const events = await client.query<{ kind: string }>(
      "SELECT kind FROM activities WHERE issue_id = $1",
      [issueId],
    );
    const kinds = events.rows.map((row) => row.kind);
    assert.equal(kinds.filter((kind) => kind === "comment_added").length, 1);
    assert.equal(kinds.filter((kind) => kind === "comment_edited").length, 1);
    assert.equal(kinds.filter((kind) => kind === "comment_removed").length, 2);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});

test("неизвестный комментарий не меняется", async () => {
  const idle = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await idle.connect();
  try {
    await client.query("BEGIN");
    await assert.rejects(
      () => editComment(client, randomUUID(), randomUUID(), randomUUID(), "текст"),
      (error: unknown) => error instanceof HttpError && error.status === 404,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await idle.end();
  }
});
