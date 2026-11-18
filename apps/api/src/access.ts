import type { PoolClient, QueryResultRow } from "pg";
import { HttpError } from "./http";

export type Role = "owner" | "member" | "viewer";

export type Membership = {
  projectId: string;
  role: Role;
  key: string;
  name: string;
  description: string;
};

type MemberRow = QueryResultRow & {
  project_id: string;
  role: Role;
  key: string;
  name: string;
  description: string;
};

export async function loadMembership(
  client: PoolClient | { query: PoolClient["query"] },
  projectId: string,
  userId: string,
  write: boolean,
): Promise<Membership> {
  const result = await client.query<MemberRow>(
    `SELECT m.project_id, m.role, p.key, p.name, p.description
     FROM project_members m
     JOIN projects p ON p.id = m.project_id
     WHERE m.project_id = $1 AND m.user_id = $2`,
    [projectId, userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, "Проект не найден");
  }
  if (write && row.role === "viewer") {
    throw new HttpError(403, "Недостаточно прав");
  }
  return {
    projectId: row.project_id,
    role: row.role,
    key: row.key,
    name: row.name,
    description: row.description,
  };
}

export async function assertAssignee(
  client: { query: PoolClient["query"] },
  projectId: string,
  assigneeId: string | null | undefined,
): Promise<void> {
  if (!assigneeId) return;
  const result = await client.query(
    "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
    [projectId, assigneeId],
  );
  if (!result.rowCount) {
    throw new HttpError(400, "Исполнитель не состоит в проекте");
  }
}
