import type { PoolClient } from "pg";
import { loadMembership } from "./access";
import { HttpError } from "./http";

type Db = Pick<PoolClient, "query">;

const COLORS = ["#5b4b8a", "#1f4e45", "#24557a", "#9f1239", "#8a5a2b", "#0c66e4"];

export type LabelChip = { id: string; name: string; color: string };

export function normalizeLabel(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u.test(name)) return null;
  return name;
}

export function labelColor(name: string): string {
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash + char.charCodeAt(0)) % COLORS.length;
  return COLORS[hash];
}

export function asLabels(value: unknown): LabelChip[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<LabelChip>;
    if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.color !== "string") return [];
    return [{ id: row.id, name: row.name, color: row.color }];
  });
}

async function projectOf(client: Db, issueId: string): Promise<string> {
  const issue = await client.query<{ project_id: string }>(
    "SELECT project_id FROM issues WHERE id = $1 FOR UPDATE",
    [issueId],
  );
  const projectId = issue.rows[0]?.project_id;
  if (!projectId) throw new HttpError(404, "Задача не найдена");
  return projectId;
}

async function findLabel(client: Db, projectId: string, name: string): Promise<LabelChip | undefined> {
  const found = await client.query<LabelChip>(
    "SELECT id, name, color FROM labels WHERE project_id = $1 AND lower(name) = lower($2)",
    [projectId, name],
  );
  return found.rows[0];
}

export async function addIssueLabel(client: Db, issueId: string, userId: string, rawName: string): Promise<LabelChip> {
  const name = normalizeLabel(rawName);
  if (!name) {
    throw new HttpError(400, "Метка: до 40 букв и цифр, можно пробел, точку, дефис и подчёркивание");
  }
  const projectId = await projectOf(client, issueId);
  await loadMembership(client, projectId, userId, true);
  let label = await findLabel(client, projectId, name);
  if (!label) {
    label = { id: crypto.randomUUID(), name, color: labelColor(name) };
    try {
      await client.query(
        "INSERT INTO labels (id, project_id, name, color) VALUES ($1, $2, $3, $4)",
        [label.id, projectId, label.name, label.color],
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      label = await findLabel(client, projectId, name);
      if (!label) throw error;
    }
  }
  const linked = await client.query(
    "INSERT INTO issue_labels (issue_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [issueId, label.id],
  );
  if (linked.rowCount) {
    await client.query(
      `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
       VALUES ($1, $2, $3, 'label_added', $4::jsonb)`,
      [crypto.randomUUID(), issueId, userId, JSON.stringify({ name: label.name })],
    );
  }
  return label;
}

export async function removeIssueLabel(client: Db, issueId: string, userId: string, labelId: string): Promise<void> {
  const projectId = await projectOf(client, issueId);
  await loadMembership(client, projectId, userId, true);
  const label = await client.query<LabelChip>(
    `SELECT l.id, l.name, l.color
     FROM labels l
     JOIN issue_labels il ON il.label_id = l.id
     WHERE l.id = $1 AND l.project_id = $2 AND il.issue_id = $3
     FOR UPDATE OF il`,
    [labelId, projectId, issueId],
  );
  const row = label.rows[0];
  if (!row) throw new HttpError(404, "Метка не найдена");
  await client.query("DELETE FROM issue_labels WHERE issue_id = $1 AND label_id = $2", [issueId, labelId]);
  await client.query(
    `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
     VALUES ($1, $2, $3, 'label_removed', $4::jsonb)`,
    [crypto.randomUUID(), issueId, userId, JSON.stringify({ name: row.name })],
  );
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
