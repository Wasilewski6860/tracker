import type { PoolClient } from "pg";
import { HttpError } from "./http";

export type IssueType = "epic" | "story" | "task" | "bug" | "subtask";

const typeLabel: Record<IssueType, string> = {
  epic: "Эпик",
  story: "История",
  task: "Задача",
  bug: "Ошибка",
  subtask: "Подзадача",
};

export function placementError(child: IssueType, parent: IssueType | null): string | null {
  if (parent === "subtask") return "У подзадачи не бывает вложенных задач";
  if (child === "epic" && parent) return "Эпик не может быть вложен в другую задачу";
  if (child === "bug" && parent) return "Ошибка остаётся самостоятельной задачей";
  if (child === "story" && parent && parent !== "epic") return "История может быть только внутри эпика";
  if (child === "task" && parent && parent !== "epic" && parent !== "story") {
    return "Задача может быть внутри эпика или истории";
  }
  if (child === "subtask" && parent !== "task" && parent !== "bug") {
    return "Подзадача может быть только у задачи или ошибки";
  }
  return null;
}

type Queryable = { query: PoolClient["query"] };

type ParentRow = { id: string; parent_id: string | null; type: IssueType; project_id: string };

async function parentChain(client: Queryable, parentId: string): Promise<ParentRow[]> {
  const rows: ParentRow[] = [];
  const seen = new Set<string>();
  let id: string | null = parentId;
  while (id && rows.length < 32 && !seen.has(id)) {
    seen.add(id);
    const result: { rows: ParentRow[] } = await client.query(
      "SELECT id, parent_id, type, project_id FROM issues WHERE id = $1 FOR UPDATE",
      [id],
    );
    const row: ParentRow | undefined = result.rows[0];
    if (!row) return rows;
    rows.push(row);
    id = row.parent_id;
  }
  if (id && seen.has(id)) throw new HttpError(400, "Так получится цикл в иерархии задач");
  if (id) throw new HttpError(400, "Слишком глубокая иерархия задач");
  return rows;
}

export async function assertPlacement(
  client: Queryable,
  projectId: string,
  issueId: string | undefined,
  type: IssueType,
  parentId: string | null,
): Promise<void> {
  if (issueId && parentId === issueId) {
    throw new HttpError(400, "Задача не может быть родителем самой себя");
  }
  if (issueId) {
    const locked = await client.query("SELECT id FROM issues WHERE id = $1 FOR UPDATE", [issueId]);
    if (!locked.rowCount) throw new HttpError(404, "Задача не найдена");
  }

  let parentType: IssueType | null = null;
  if (parentId) {
    const chain = await parentChain(client, parentId);
    for (const row of chain) {
      if (issueId && row.id === issueId) throw new HttpError(400, "Так получится цикл в иерархии задач");
      if (row.project_id !== projectId) throw new HttpError(400, "Родительская задача не найдена в этом проекте");
    }
    if (!chain[0]) throw new HttpError(400, "Родительская задача не найдена в этом проекте");
    parentType = chain[0].type;
  }

  const invalid = placementError(type, parentType);
  if (invalid) throw new HttpError(400, invalid);

  if (!issueId) return;
  const children = await client.query<{ type: IssueType }>(
    "SELECT type FROM issues WHERE parent_id = $1 FOR UPDATE",
    [issueId],
  );
  for (const child of children.rows) {
    const childError = placementError(child.type, type);
    if (childError) {
      throw new HttpError(400, `Нельзя сменить тип: ${typeLabel[child.type]} не подходит к «${typeLabel[type]}»`);
    }
  }
}
