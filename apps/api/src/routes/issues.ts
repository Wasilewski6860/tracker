import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { assertAssignee, loadMembership, type Role } from "../access";
import { requireUser } from "../auth";
import { commentAccess, editComment, removeComment } from "../comments";
import { pool, query, tx } from "../db";
import { assertPlacement } from "../hierarchy";
import { HttpError } from "../http";
import { env } from "../env";
import {
  contentDisposition,
  parseMultipartFile,
  removeAttachment,
  storagePath,
  storeAttachment,
  unlinkStored,
} from "../attachments";
import { commentSchema, labelSchema, linkSchema, parseBody, transitionSchema, updateIssueSchema } from "../schemas";
import { addIssueLabel, removeIssueLabel, type LabelChip } from "../labels";

type IssueDetailRow = {
  id: string;
  project_id: string;
  number: number;
  title: string;
  description: string;
  type: "epic" | "story" | "task" | "bug" | "subtask";
  priority: "low" | "medium" | "high" | "urgent";
  status_id: string;
  due_on: string | null;
  parent_id: string | null;
  parent_number: number | null;
  created_at: Date;
  updated_at: Date;
  reporter_id: string;
  reporter_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  project_key: string;
};

const FIELD_LABELS: Record<string, string> = {
  title: "название",
  description: "описание",
  type: "тип",
  priority: "приоритет",
  assignee: "исполнителя",
  due: "срок",
  parent: "родителя",
};

export async function issueRoutes(app: FastifyInstance): Promise<void> {
  app.get("/issues/:issueId", async (request) => {
    const user = requireUser(request);
    const { issueId } = request.params as { issueId: string };
    const issue = await findIssue(issueId);
    const membership = await loadMembership(pool, issue.project_id, user.id, false);
    const comments = await query<{
      id: string;
      body: string;
      created_at: Date;
      edited_at: Date | null;
      author_id: string;
      author_name: string;
    }>(
      `SELECT c.id, c.body, c.created_at, c.edited_at, u.id AS author_id, u.name AS author_name
       FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.issue_id = $1
       ORDER BY c.created_at ASC`,
      [issueId],
    );
    const activities = await query<{
      id: string;
      kind: string;
      payload: Record<string, string>;
      created_at: Date;
      actor_name: string;
    }>(
      `SELECT a.id, a.kind, a.payload, a.created_at, u.name AS actor_name
       FROM activities a
       JOIN users u ON u.id = a.actor_id
       WHERE a.issue_id = $1
       ORDER BY a.created_at DESC, a.id DESC`,
      [issueId],
    );
    const transitions = await query<{ to_status_id: string; name: string }>(
      `SELECT t.to_status_id, s.name
       FROM transitions t
       JOIN statuses s ON s.id = t.to_status_id
       WHERE t.from_status_id = $1
       ORDER BY s.position`,
      [issue.status_id],
    );
    const statuses = await query<{ id: string; name: string; category: string }>(
      `SELECT id, name, category FROM statuses WHERE project_id = $1 ORDER BY position`,
      [issue.project_id],
    );
    const labels = await query<LabelChip>(
      `SELECT l.id, l.name, l.color
       FROM issue_labels il
       JOIN labels l ON l.id = il.label_id
       WHERE il.issue_id = $1
       ORDER BY lower(l.name)`,
      [issueId],
    );
    const projectLabels = await query<LabelChip>(
      `SELECT id, name, color FROM labels WHERE project_id = $1 ORDER BY lower(name)`,
      [issue.project_id],
    );
    const attachments = await query<{
      id: string;
      name: string;
      size_bytes: number;
      created_at: Date;
      author_id: string;
      author_name: string;
    }>(
      `SELECT a.id, a.name, a.size_bytes, a.created_at, u.id AS author_id, u.name AS author_name
       FROM attachments a
       JOIN users u ON u.id = a.author_id
       WHERE a.issue_id = $1
       ORDER BY a.created_at`,
      [issueId],
    );
    const members = await query<{ id: string; name: string; role: Role }>(
      `SELECT u.id, u.name, m.role
       FROM project_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.project_id = $1
       ORDER BY u.name`,
      [issue.project_id],
    );
    return {
      issue: {
        ...publicIssue(issue),
        role: membership.role,
      },
      comments: comments.map((row) => {
        const access = commentAccess(membership.role, row.author_id, user.id);
        return {
          id: row.id,
          body: row.body,
          createdAt: row.created_at,
          editedAt: row.edited_at,
          author: { id: row.author_id, name: row.author_name },
          canEdit: access.edit,
          canDelete: access.remove,
        };
      }),
      activities: activities.map((row) => ({
        id: row.id,
        kind: row.kind,
        payload: row.payload,
        createdAt: row.created_at,
        actorName: row.actor_name,
        text: activityText(row.kind, row.payload, row.actor_name),
      })),
      transitions: transitions.map((row) => ({ toStatusId: row.to_status_id, name: row.name })),
      statuses,
      members,
      children: await childIssues(issue.project_id, issueId, issue.project_key),
      candidates: await projectIssues(issue.project_id, issueId, issue.project_key),
      links: await issueLinks(issueId, issue.project_key),
      labels,
      projectLabels,
      attachments: attachments.map((row) => ({
        id: row.id,
        name: row.name,
        sizeBytes: row.size_bytes,
        createdAt: row.created_at,
        author: { id: row.author_id, name: row.author_name },
        canDelete: membership.role === "owner" || row.author_id === user.id,
      })),
      canDelete: membership.role === "owner" || issue.reporter_id === user.id,
    };
  });

  app.patch("/issues/:issueId", async (request) => {
    const user = requireUser(request);
    const { issueId } = request.params as { issueId: string };
    const body = parseBody(updateIssueSchema, request.body);
    await tx(async (client) => {
      const current = await lockIssue(client, issueId);
      await loadMembership(client, current.project_id, user.id, true);
      await assertAssignee(client, current.project_id, body.assigneeId);
      const nextType = body.type ?? current.type;
      const nextParent = body.parentId !== undefined ? body.parentId : current.parent_id;
      await assertPlacement(client, current.project_id, issueId, nextType, nextParent);
      const changes: Array<{ field: string; from: string; to: string }> = [];
      if (body.title !== undefined && body.title !== current.title) {
        changes.push({ field: "title", from: current.title, to: body.title });
      }
      if (body.description !== undefined && body.description !== current.description) {
        changes.push({ field: "description", from: current.description, to: body.description });
      }
      if (body.type !== undefined && body.type !== current.type) {
        changes.push({ field: "type", from: current.type, to: body.type });
      }
      if (body.priority !== undefined && body.priority !== current.priority) {
        changes.push({ field: "priority", from: current.priority, to: body.priority });
      }
      if (body.dueOn !== undefined && (body.dueOn ?? null) !== current.due_on) {
        changes.push({
          field: "due",
          from: current.due_on ?? "нет",
          to: body.dueOn ?? "нет",
        });
      }
      if (body.parentId !== undefined && body.parentId !== current.parent_id) {
        const fromKey = current.parent_number
          ? `${current.project_key}-${current.parent_number}`
          : "нет";
        const toKey = body.parentId
          ? await issueKey(client, current.project_id, body.parentId)
          : "нет";
        changes.push({ field: "parent", from: fromKey, to: toKey });
      }
      if (body.assigneeId !== undefined && body.assigneeId !== current.assignee_id) {
        const fromName = current.assignee_name ?? "Никто";
        const toName = body.assigneeId
          ? await memberName(client, current.project_id, body.assigneeId)
          : "Никто";
        changes.push({ field: "assignee", from: fromName, to: toName });
      }
      await client.query(
        `UPDATE issues SET
           title = COALESCE($2, title),
           description = COALESCE($3, description),
           type = COALESCE($4, type),
           priority = COALESCE($5, priority),
           assignee_id = CASE WHEN $6::boolean THEN $7::uuid ELSE assignee_id END,
           due_on = CASE WHEN $8::boolean THEN $9::date ELSE due_on END,
           parent_id = CASE WHEN $10::boolean THEN $11::uuid ELSE parent_id END
         WHERE id = $1`,
        [
          issueId,
          body.title ?? null,
          body.description ?? null,
          body.type ?? null,
          body.priority ?? null,
          body.assigneeId !== undefined,
          body.assigneeId ?? null,
          body.dueOn !== undefined,
          body.dueOn ?? null,
          body.parentId !== undefined,
          body.parentId ?? null,
        ],
      );
      for (const change of changes) {
        await client.query(
          `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
           VALUES ($1, $2, $3, 'field_changed', $4::jsonb)`,
          [crypto.randomUUID(), issueId, user.id, JSON.stringify(change)],
        );
      }
    });
    return { ok: true };
  });

  app.post("/issues/:issueId/transitions", async (request) => {
    const user = requireUser(request);
    const { issueId } = request.params as { issueId: string };
    const body = parseBody(transitionSchema, request.body);
    await tx(async (client) => {
      const current = await lockIssue(client, issueId);
      await loadMembership(client, current.project_id, user.id, true);
      const allowed = await client.query<{ name: string }>(
        `SELECT s.name
         FROM transitions t
         JOIN statuses s ON s.id = t.to_status_id
         WHERE t.from_status_id = $1 AND t.to_status_id = $2`,
        [current.status_id, body.toStatusId],
      );
      if (!allowed.rowCount) {
        throw new HttpError(400, "Такой переход статуса не разрешён");
      }
      const fromStatus = await client.query<{ name: string }>(
        "SELECT name FROM statuses WHERE id = $1",
        [current.status_id],
      );
      await client.query("UPDATE issues SET status_id = $2 WHERE id = $1", [
        issueId,
        body.toStatusId,
      ]);
      await client.query(
        `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
         VALUES ($1, $2, $3, 'status_changed', $4::jsonb)`,
        [
          crypto.randomUUID(),
          issueId,
          user.id,
          JSON.stringify({
            from: fromStatus.rows[0]?.name ?? "",
            to: allowed.rows[0].name,
          }),
        ],
      );
    });
    return { ok: true };
  });

  app.post("/issues/:issueId/comments", async (request, reply) => {
    const user = requireUser(request);
    const { issueId } = request.params as { issueId: string };
    const body = parseBody(commentSchema, request.body);
    const id = crypto.randomUUID();
    await tx(async (client) => {
      const issue = await lockIssue(client, issueId);
      await loadMembership(client, issue.project_id, user.id, true);
      await client.query(
        "INSERT INTO comments (id, issue_id, author_id, body) VALUES ($1, $2, $3, $4)",
        [id, issueId, user.id, body.body],
      );
      await client.query(
        `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
         VALUES ($1, $2, $3, 'comment_added', $4::jsonb)`,
        [crypto.randomUUID(), issueId, user.id, JSON.stringify({ commentId: id })],
      );
    });
    reply.code(201);
    return { id };
  });

  app.patch("/issues/:issueId/comments/:commentId", async (request) => {
    const user = requireUser(request);
    const { issueId, commentId } = request.params as { issueId: string; commentId: string };
    const body = parseBody(commentSchema, request.body);
    await tx((client) => editComment(client, issueId, commentId, user.id, body.body));
    return { ok: true };
  });

  app.delete("/issues/:issueId/comments/:commentId", async (request) => {
    const user = requireUser(request);
    const { issueId, commentId } = request.params as { issueId: string; commentId: string };
    await tx((client) => removeComment(client, issueId, commentId, user.id));
    return { ok: true };
  });

  app.post("/issues/:issueId/labels", async (request, reply) => {
    const user = requireUser(request);
    const { issueId } = request.params as { issueId: string };
    const body = parseBody(labelSchema, request.body);
    const label = await tx((client) => addIssueLabel(client, issueId, user.id, body.name));
    reply.code(201);
    return label;
  });

  app.delete("/issues/:issueId/labels/:labelId", async (request) => {
    const user = requireUser(request);
    const { issueId, labelId } = request.params as { issueId: string; labelId: string };
    await tx((client) => removeIssueLabel(client, issueId, user.id, labelId));
    return { ok: true };
  });

  app.post("/issues/:issueId/attachments", async (request, reply) => {
    const user = requireUser(request);
    const { issueId } = request.params as { issueId: string };
    const contentType = request.headers["content-type"];
    if (!Buffer.isBuffer(request.body) || !contentType) throw new HttpError(400, "Файл не выбран");
    const file = parseMultipartFile(request.body, contentType);
    if (!file) throw new HttpError(400, "Файл не выбран");
    const saved = await tx((client) =>
      storeAttachment(client, env.attachmentDir, issueId, user.id, {
        name: file.filename,
        mime: file.mime,
        bytes: file.bytes,
      }),
    );
    reply.code(201);
    return { id: saved.id };
  });

  app.get("/issues/:issueId/attachments/:attachmentId", async (request, reply) => {
    const user = requireUser(request);
    const { issueId, attachmentId } = request.params as { issueId: string; attachmentId: string };
    const issue = await findIssue(issueId);
    await loadMembership(pool, issue.project_id, user.id, false);
    const rows = await query<{ name: string; storage_key: string }>(
      "SELECT name, storage_key FROM attachments WHERE id = $1 AND issue_id = $2",
      [attachmentId, issueId],
    );
    const file = rows[0];
    if (!file) throw new HttpError(404, "Файл не найден");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Disposition", contentDisposition(file.name));
    reply.type("application/octet-stream");
    return reply.send(fs.createReadStream(storagePath(env.attachmentDir, file.storage_key)));
  });

  app.delete("/issues/:issueId/attachments/:attachmentId", async (request) => {
    const user = requireUser(request);
    const { issueId, attachmentId } = request.params as { issueId: string; attachmentId: string };
    const key = await tx((client) => removeAttachment(client, issueId, user.id, attachmentId));
    await unlinkStored(env.attachmentDir, key);
    return { ok: true };
  });

  app.delete("/issues/:issueId", async (request) => {
    const user = requireUser(request);
    const { issueId } = request.params as { issueId: string };
    const keys = await tx(async (client) => {
      const issue = await lockIssue(client, issueId);
      const membership = await loadMembership(client, issue.project_id, user.id, true);
      if (membership.role !== "owner" && issue.reporter_id !== user.id) {
        throw new HttpError(403, "Задачу может удалить автор или владелец проекта");
      }
      const children = await client.query(
        "SELECT id FROM issues WHERE parent_id = $1 FOR UPDATE",
        [issueId],
      );
      if (children.rowCount) {
        throw new HttpError(409, "Нельзя удалить задачу, пока у неё есть вложенные. Сначала перенесите или удалите их.");
      }
      const files = await client.query<{ storage_key: string }>(
        "SELECT storage_key FROM attachments WHERE issue_id = $1",
        [issueId],
      );
      await client.query("DELETE FROM issues WHERE id = $1", [issueId]);
      return files.rows.map((row) => row.storage_key);
    });
    await Promise.all(keys.map((key) => unlinkStored(env.attachmentDir, key)));
    return { ok: true };
  });

  app.post("/issues/:issueId/links", async (request, reply) => {
    const user = requireUser(request);
    const { issueId } = request.params as { issueId: string };
    const body = parseBody(linkSchema, request.body);
    const id = crypto.randomUUID();
    await tx(async (client) => {
      const issue = await lockIssue(client, issueId);
      await loadMembership(client, issue.project_id, user.id, true);
      if (body.targetId === issueId) throw new HttpError(400, "Нельзя связать задачу с самой собой");
      const target = await client.query<{ id: string; project_id: string; number: number }>(
        "SELECT id, project_id, number FROM issues WHERE id = $1 FOR UPDATE",
        [body.targetId],
      );
      const other = target.rows[0];
      if (!other || other.project_id !== issue.project_id) {
        throw new HttpError(400, "Связать можно только задачи одного проекта");
      }
      const [sourceId, targetId] =
        body.type === "relates" && body.targetId < issueId ? [body.targetId, issueId] : [issueId, body.targetId];
      try {
        await client.query(
          `INSERT INTO issue_links (id, project_id, source_id, target_id, type)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, issue.project_id, sourceId, targetId, body.type],
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new HttpError(409, "Такая связь уже есть");
        throw error;
      }
      const otherKey = `${issue.project_key}-${other.number}`;
      const payload = JSON.stringify({ type: body.type, key: otherKey });
      await client.query(
        `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
         VALUES ($1, $2, $3, 'link_added', $4::jsonb)`,
        [crypto.randomUUID(), issueId, user.id, payload],
      );
    });
    reply.code(201);
    return { id };
  });

  app.delete("/issues/:issueId/links/:linkId", async (request) => {
    const user = requireUser(request);
    const { issueId, linkId } = request.params as { issueId: string; linkId: string };
    await tx(async (client) => {
      const issue = await lockIssue(client, issueId);
      await loadMembership(client, issue.project_id, user.id, true);
      const link = await client.query<{ type: string; source_id: string; target_id: string }>(
        `SELECT type, source_id, target_id FROM issue_links
         WHERE id = $1 AND project_id = $2 AND (source_id = $3 OR target_id = $3)`,
        [linkId, issue.project_id, issueId],
      );
      const row = link.rows[0];
      if (!row) throw new HttpError(404, "Связь не найдена");
      await client.query("DELETE FROM issue_links WHERE id = $1", [linkId]);
      const otherId = row.source_id === issueId ? row.target_id : row.source_id;
      const other = await client.query<{ number: number }>("SELECT number FROM issues WHERE id = $1", [otherId]);
      await client.query(
        `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
         VALUES ($1, $2, $3, 'link_removed', $4::jsonb)`,
        [
          crypto.randomUUID(),
          issueId,
          user.id,
          JSON.stringify({ type: row.type, key: `${issue.project_key}-${other.rows[0]?.number ?? "?"}` }),
        ],
      );
    });
    return { ok: true };
  });
}

async function projectIssues(projectId: string, issueId: string, projectKey: string) {
  const rows = await query<{ id: string; number: number; title: string; type: IssueDetailRow["type"] }>(
    `SELECT id, number, title, type FROM issues
     WHERE project_id = $1 AND id <> $2
     ORDER BY number DESC`,
    [projectId, issueId],
  );
  return rows.map((row) => ({
    id: row.id,
    key: `${projectKey}-${row.number}`,
    title: row.title,
    type: row.type,
  }));
}

async function issueLinks(issueId: string, projectKey: string) {
  const rows = await query<{
    id: string;
    type: "relates" | "blocks" | "duplicates";
    source_id: string;
    number: number;
    title: string;
    issue_type: IssueDetailRow["type"];
    other_id: string;
  }>(
    `SELECT l.id, l.type, l.source_id, other.id AS other_id, other.number, other.title, other.type AS issue_type
     FROM issue_links l
     JOIN issues other ON other.id = CASE WHEN l.source_id = $1 THEN l.target_id ELSE l.source_id END
     WHERE l.source_id = $1 OR l.target_id = $1
     ORDER BY other.number`,
    [issueId],
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    outward: row.source_id === issueId,
    issue: {
      id: row.other_id,
      key: `${projectKey}-${row.number}`,
      title: row.title,
      type: row.issue_type,
    },
  }));
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "23505";
}

async function childIssues(projectId: string, issueId: string, projectKey: string) {
  const rows = await query<{ id: string; number: number; title: string; type: IssueDetailRow["type"] }>(
    `SELECT id, number, title, type FROM issues
     WHERE project_id = $1 AND parent_id = $2
     ORDER BY number`,
    [projectId, issueId],
  );
  return rows.map((row) => ({
    id: row.id,
    key: `${projectKey}-${row.number}`,
    title: row.title,
    type: row.type,
  }));
}

async function issueKey(
  client: { query: typeof pool.query },
  projectId: string,
  issueId: string,
): Promise<string> {
  const result = await client.query<{ key: string }>(
    `SELECT p.key || '-' || i.number AS key
     FROM issues i JOIN projects p ON p.id = i.project_id
     WHERE i.id = $1 AND i.project_id = $2`,
    [issueId, projectId],
  );
  return result.rows[0]?.key ?? "нет";
}

async function findIssue(issueId: string): Promise<IssueDetailRow> {
  const rows = await query<IssueDetailRow>(
    `SELECT i.id, i.project_id, i.number, i.title, i.description, i.type, i.priority,
            i.status_id, i.created_at, i.updated_at,
            to_char(i.due_on, 'YYYY-MM-DD') AS due_on, i.parent_id,
            parent.number AS parent_number,
            reporter.id AS reporter_id, reporter.name AS reporter_name,
            assignee.id AS assignee_id, assignee.name AS assignee_name,
            p.key AS project_key
     FROM issues i
     JOIN projects p ON p.id = i.project_id
     JOIN users reporter ON reporter.id = i.reporter_id
     LEFT JOIN users assignee ON assignee.id = i.assignee_id
     LEFT JOIN issues parent ON parent.id = i.parent_id
     WHERE i.id = $1`,
    [issueId],
  );
  const issue = rows[0];
  if (!issue) throw new HttpError(404, "Задача не найдена");
  return issue;
}

async function lockIssue(
  client: { query: typeof pool.query },
  issueId: string,
): Promise<IssueDetailRow> {
  const locked = await client.query<{ id: string }>(
    "SELECT id FROM issues WHERE id = $1 FOR UPDATE",
    [issueId],
  );
  if (!locked.rowCount) throw new HttpError(404, "Задача не найдена");
  const result = await client.query<IssueDetailRow>(
    `SELECT i.id, i.project_id, i.number, i.title, i.description, i.type, i.priority,
            i.status_id, i.created_at, i.updated_at,
            to_char(i.due_on, 'YYYY-MM-DD') AS due_on, i.parent_id,
            parent.number AS parent_number,
            reporter.id AS reporter_id, reporter.name AS reporter_name,
            assignee.id AS assignee_id, assignee.name AS assignee_name,
            p.key AS project_key
     FROM issues i
     JOIN projects p ON p.id = i.project_id
     JOIN users reporter ON reporter.id = i.reporter_id
     LEFT JOIN users assignee ON assignee.id = i.assignee_id
     LEFT JOIN issues parent ON parent.id = i.parent_id
     WHERE i.id = $1`,
    [issueId],
  );
  return result.rows[0];
}

async function memberName(
  client: { query: typeof pool.query },
  projectId: string,
  userId: string,
): Promise<string> {
  const result = await client.query<{ name: string }>(
    `SELECT u.name FROM users u
     JOIN project_members m ON m.user_id = u.id
     WHERE m.project_id = $1 AND u.id = $2`,
    [projectId, userId],
  );
  return result.rows[0]?.name ?? "Никто";
}

function publicIssue(issue: IssueDetailRow) {
  return {
    id: issue.id,
    projectId: issue.project_id,
    number: issue.number,
    key: `${issue.project_key}-${issue.number}`,
    title: issue.title,
    description: issue.description,
    type: issue.type,
    priority: issue.priority,
    statusId: issue.status_id,
    dueOn: issue.due_on,
    parent: issue.parent_id
      ? { id: issue.parent_id, key: `${issue.project_key}-${issue.parent_number}` }
      : null,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    reporter: { id: issue.reporter_id, name: issue.reporter_name },
    assignee: issue.assignee_id
      ? { id: issue.assignee_id, name: issue.assignee_name }
      : null,
  };
}

function linkPhrase(type: string, outward: boolean): string {
  if (type === "blocks") return outward ? "блокирует" : "заблокирована";
  if (type === "duplicates") return outward ? "дублирует" : "дублируется";
  return "связана с";
}

function ruDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function activityText(kind: string, payload: Record<string, string>, actorName: string): string {
  if (kind === "created") return `${actorName} · задача создана`;
  if (kind === "comment_added") return `${actorName} · добавлен комментарий`;
  if (kind === "comment_edited") return `${actorName} · изменён комментарий`;
  if (kind === "comment_removed") return `${actorName} · удалён комментарий`;
  if (kind === "link_added") return `${actorName} · связь «${linkPhrase(payload.type, true)}» ${payload.key}`;
  if (kind === "link_removed") return `${actorName} · убрана связь «${linkPhrase(payload.type, true)}» ${payload.key}`;
  if (kind === "label_added") return `${actorName} · метка «${payload.name}»`;
  if (kind === "label_removed") return `${actorName} · убрана метка «${payload.name}»`;
  if (kind === "attachment_added") return `${actorName} · файл «${payload.name}»`;
  if (kind === "attachment_removed") return `${actorName} · удалён файл «${payload.name}»`;
  if (kind === "status_changed") {
    return `${actorName} · статус ${payload.from} → ${payload.to}`;
  }
  if (kind === "field_changed") {
    const label = FIELD_LABELS[payload.field] ?? payload.field;
    if (payload.field === "description") {
      return `${actorName} · изменено описание`;
    }
    const from = payload.field === "due" ? ruDay(payload.from) : payload.from;
    const to = payload.field === "due" ? ruDay(payload.to) : payload.to;
    return `${actorName} · ${label}: ${from} → ${to}`;
  }
  return `${actorName} обновил задачу`;
}
