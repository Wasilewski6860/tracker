import type { PoolClient } from "pg";
import { loadMembership } from "./access";
import { HttpError } from "./http";

type Db = Pick<PoolClient, "query">;

export const statusCategories = ["backlog", "todo", "in_progress", "review", "done"] as const;
export type StatusCategory = (typeof statusCategories)[number];

async function ownerProject(client: Db, projectId: string, userId: string): Promise<void> {
  const membership = await loadMembership(client, projectId, userId, true);
  if (membership.role !== "owner") throw new HttpError(403, "Процесс настраивает владелец проекта");
}

function cleanName(name: string): string {
  const value = name.trim();
  if (!value || value.length > 40) throw new HttpError(400, "Название статуса: от 1 до 40 символов");
  return value;
}

async function lockStatuses(client: Db, projectId: string) {
  const result = await client.query<{ id: string; name: string; category: StatusCategory; position: number }>(
    `SELECT id, name, category, position
     FROM statuses
     WHERE project_id = $1
     ORDER BY position, id
     FOR UPDATE`,
    [projectId],
  );
  return result.rows;
}

export async function addStatus(
  client: Db,
  projectId: string,
  userId: string,
  name: string,
  category: StatusCategory,
): Promise<string> {
  await ownerProject(client, projectId, userId);
  const title = cleanName(name);
  const id = crypto.randomUUID();
  const position = await client.query<{ position: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM statuses WHERE project_id = $1",
    [projectId],
  );
  await insertUnique(
    client,
    `INSERT INTO statuses (id, project_id, name, category, position) VALUES ($1, $2, $3, $4, $5)`,
    [id, projectId, title, category, position.rows[0]?.position ?? 0],
    "Статус с таким названием уже есть",
  );
  return id;
}

export async function updateStatus(
  client: Db,
  projectId: string,
  userId: string,
  statusId: string,
  patch: { name?: string; category?: StatusCategory },
): Promise<void> {
  await ownerProject(client, projectId, userId);
  const rows = await lockStatuses(client, projectId);
  const current = rows.find((row) => row.id === statusId);
  if (!current) throw new HttpError(404, "Статус не найден");
  const name = patch.name === undefined ? current.name : cleanName(patch.name);
  const category = patch.category ?? current.category;
  if (current.category === "backlog" && category !== "backlog" && !rows.some((row) => row.id !== statusId && row.category === "backlog")) {
    throw new HttpError(409, "Нужен хотя бы один статус бэклога: с него начинаются новые задачи");
  }
  await insertUnique(
    client,
    "UPDATE statuses SET name = $2, category = $3 WHERE id = $1",
    [statusId, name, category],
    "Статус с таким названием уже есть",
  );
}

export async function shiftStatus(
  client: Db,
  projectId: string,
  userId: string,
  statusId: string,
  direction: "left" | "right",
): Promise<void> {
  await ownerProject(client, projectId, userId);
  const rows = await lockStatuses(client, projectId);
  const index = rows.findIndex((row) => row.id === statusId);
  if (index < 0) throw new HttpError(404, "Статус не найден");
  const next = index + (direction === "left" ? -1 : 1);
  if (next < 0 || next >= rows.length) return;
  const order = rows.map((row) => row.id);
  const current = order[index];
  order[index] = order[next];
  order[next] = current;
  for (let position = 0; position < order.length; position += 1) {
    await client.query("UPDATE statuses SET position = $2 WHERE id = $1", [order[position], position]);
  }
}

export async function deleteStatus(
  client: Db,
  projectId: string,
  userId: string,
  statusId: string,
  moveToStatusId?: string,
): Promise<void> {
  await ownerProject(client, projectId, userId);
  const rows = await lockStatuses(client, projectId);
  const current = rows.find((row) => row.id === statusId);
  if (!current) throw new HttpError(404, "Статус не найден");
  if (rows.length === 1) throw new HttpError(409, "Нельзя удалить последний статус");
  if (current.category === "backlog" && !rows.some((row) => row.id !== statusId && row.category === "backlog")) {
    throw new HttpError(409, "Нужен хотя бы один статус бэклога: с него начинаются новые задачи");
  }
  const issues = await client.query<{ id: string }>(
    "SELECT id FROM issues WHERE status_id = $1 FOR UPDATE",
    [statusId],
  );
  if (issues.rowCount) {
    if (!moveToStatusId || moveToStatusId === statusId) {
      throw new HttpError(409, "В статусе есть задачи. Выберите, куда их перенести");
    }
    const target = rows.find((row) => row.id === moveToStatusId);
    if (!target) throw new HttpError(400, "Статус для переноса не найден");
    await client.query("UPDATE issues SET status_id = $2 WHERE status_id = $1", [statusId, target.id]);
    for (const issue of issues.rows) {
      await client.query(
        `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
         VALUES ($1, $2, $3, 'status_changed', $4::jsonb)`,
        [crypto.randomUUID(), issue.id, userId, JSON.stringify({ from: current.name, to: target.name })],
      );
    }
  }
  await client.query("DELETE FROM statuses WHERE id = $1", [statusId]);
}

export async function addTransition(
  client: Db,
  projectId: string,
  userId: string,
  fromStatusId: string,
  toStatusId: string,
): Promise<void> {
  await ownerProject(client, projectId, userId);
  if (fromStatusId === toStatusId) throw new HttpError(400, "Переход в тот же статус не нужен");
  const rows = await lockStatuses(client, projectId);
  if (!rows.some((row) => row.id === fromStatusId) || !rows.some((row) => row.id === toStatusId)) {
    throw new HttpError(400, "Переход только между статусами этого проекта");
  }
  await insertUnique(
    client,
    `INSERT INTO transitions (id, project_id, from_status_id, to_status_id) VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), projectId, fromStatusId, toStatusId],
    "Такой переход уже есть",
  );
}

export async function removeTransition(
  client: Db,
  projectId: string,
  userId: string,
  fromStatusId: string,
  toStatusId: string,
): Promise<void> {
  await ownerProject(client, projectId, userId);
  const result = await client.query(
    "DELETE FROM transitions WHERE project_id = $1 AND from_status_id = $2 AND to_status_id = $3",
    [projectId, fromStatusId, toStatusId],
  );
  if (!result.rowCount) throw new HttpError(404, "Переход не найден");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function insertUnique(client: Db, sql: string, params: unknown[], message: string): Promise<void> {
  await client.query("SAVEPOINT unique_guard");
  try {
    await client.query(sql, params);
    await client.query("RELEASE SAVEPOINT unique_guard");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT unique_guard");
    if (isUniqueViolation(error)) throw new HttpError(409, message);
    throw error;
  }
}
