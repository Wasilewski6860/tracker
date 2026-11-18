import type { PoolClient } from "pg";
import { loadMembership, type Role } from "./access";
import { HttpError } from "./http";

type Db = Pick<PoolClient, "query">;

export function commentAccess(
  role: Role,
  authorId: string,
  userId: string,
): { edit: boolean; remove: boolean } {
  const author = authorId === userId && role !== "viewer";
  return {
    edit: author,
    remove: role === "owner" || author,
  };
}

async function lockedProject(client: Db, issueId: string): Promise<string> {
  const issue = await client.query<{ project_id: string }>(
    "SELECT project_id FROM issues WHERE id = $1 FOR UPDATE",
    [issueId],
  );
  const projectId = issue.rows[0]?.project_id;
  if (!projectId) throw new HttpError(404, "Задача не найдена");
  return projectId;
}

async function lockedComment(client: Db, issueId: string, commentId: string) {
  const comment = await client.query<{ author_id: string; body: string }>(
    "SELECT author_id, body FROM comments WHERE id = $1 AND issue_id = $2 FOR UPDATE",
    [commentId, issueId],
  );
  const row = comment.rows[0];
  if (!row) throw new HttpError(404, "Комментарий не найден");
  return row;
}

export async function editComment(
  client: Db,
  issueId: string,
  commentId: string,
  userId: string,
  body: string,
): Promise<void> {
  const projectId = await lockedProject(client, issueId);
  const membership = await loadMembership(client, projectId, userId, true);
  const row = await lockedComment(client, issueId, commentId);
  if (!commentAccess(membership.role, row.author_id, userId).edit) {
    throw new HttpError(403, "Комментарий может изменить только автор");
  }
  if (row.body === body) return;
  await client.query("UPDATE comments SET body = $2, edited_at = now() WHERE id = $1", [commentId, body]);
  await client.query(
    `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
     VALUES ($1, $2, $3, 'comment_edited', $4::jsonb)`,
    [crypto.randomUUID(), issueId, userId, JSON.stringify({ commentId })],
  );
}

export async function removeComment(
  client: Db,
  issueId: string,
  commentId: string,
  userId: string,
): Promise<void> {
  const projectId = await lockedProject(client, issueId);
  const membership = await loadMembership(client, projectId, userId, true);
  const row = await lockedComment(client, issueId, commentId);
  if (!commentAccess(membership.role, row.author_id, userId).remove) {
    throw new HttpError(403, "Комментарий может удалить автор или владелец проекта");
  }
  await client.query("DELETE FROM comments WHERE id = $1", [commentId]);
  await client.query(
    `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
     VALUES ($1, $2, $3, 'comment_removed', $4::jsonb)`,
    [crypto.randomUUID(), issueId, userId, JSON.stringify({ commentId })],
  );
}
