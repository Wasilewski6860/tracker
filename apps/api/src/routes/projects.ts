import type { FastifyInstance } from "fastify";
import { assertAssignee, loadMembership, type Role } from "../access";
import { assertPlacement, type IssueType } from "../hierarchy";
import { requireUser } from "../auth";
import { pool, query, tx } from "../db";
import { HttpError } from "../http";
import { createIssueSchema, createProjectSchema, createStatusSchema, createTransitionSchema, deleteStatusSchema, memberSchema, parseBody, shiftStatusSchema, updateStatusSchema } from "../schemas";
import { asLabels } from "../labels";
import { addStatus, addTransition, deleteStatus, removeTransition, shiftStatus, updateStatus } from "../workflow-edit";
import { DEFAULT_FLOW, FLOW_EDGES } from "../workflow";

type ProjectListRow = {
  id: string;
  key: string;
  name: string;
  description: string;
  role: Role;
  created_at: Date;
  issue_count: number;
};

type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

type StatusRow = {
  id: string;
  name: string;
  category: "backlog" | "todo" | "in_progress" | "review" | "done";
  position: number;
  issue_count: number;
};

type IssueRow = {
  id: string;
  number: number;
  title: string;
  description: string;
  type: "epic" | "story" | "task" | "bug" | "subtask";
  due_on: string | null;
  parent_number: number | null;
  priority: "low" | "medium" | "high" | "urgent";
  status_id: string;
  created_at: Date;
  updated_at: Date;
  reporter_id: string;
  reporter_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  label_items: unknown;
};

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get("/projects", async (request) => {
    const user = requireUser(request);
    const rows = await query<ProjectListRow>(
      `SELECT p.id, p.key, p.name, p.description, p.created_at, m.role,
              (SELECT count(*)::int FROM issues i WHERE i.project_id = p.id) AS issue_count
       FROM projects p
       JOIN project_members m ON m.project_id = p.id
       WHERE m.user_id = $1
       ORDER BY p.created_at DESC`,
      [user.id],
    );
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      role: row.role,
      issueCount: row.issue_count,
      createdAt: row.created_at,
    }));
  });

  app.post("/projects", async (request) => {
    const user = requireUser(request);
    const body = parseBody(createProjectSchema, request.body);
    try {
      return await tx(async (client) => {
        const projectId = crypto.randomUUID();
        await client.query(
          `INSERT INTO projects (id, key, name, description) VALUES ($1, $2, $3, $4)`,
          [projectId, body.key, body.name, body.description],
        );
        await client.query(
          `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
          [projectId, user.id],
        );
        const statusIds = new Map<string, string>();
        for (const status of DEFAULT_FLOW) {
          const id = crypto.randomUUID();
          statusIds.set(status.key, id);
          await client.query(
            `INSERT INTO statuses (id, project_id, name, category, position)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, projectId, status.name, status.category, status.position],
          );
        }
        for (const [from, to] of FLOW_EDGES) {
          await client.query(
            `INSERT INTO transitions (id, project_id, from_status_id, to_status_id)
             VALUES ($1, $2, $3, $4)`,
            [crypto.randomUUID(), projectId, statusIds.get(from), statusIds.get(to)],
          );
        }
        return {
          id: projectId,
          key: body.key,
          name: body.name,
          description: body.description,
          role: "owner" as const,
          issueCount: 0,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, "Проект с таким ключом уже есть");
      }
      throw error;
    }
  });

  app.get("/projects/:projectId/board", async (request) => {
    const user = requireUser(request);
    const { projectId } = request.params as { projectId: string };
    const membership = await loadMembership(pool, projectId, user.id, false);
    const members = await query<MemberRow>(
      `SELECT u.id, u.name, u.email, m.role
       FROM project_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.project_id = $1
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.name`,
      [projectId],
    );
    const statuses = await query<StatusRow>(
      `SELECT s.id, s.name, s.category, s.position,
              (SELECT count(*)::int FROM issues i WHERE i.status_id = s.id) AS issue_count
       FROM statuses s WHERE s.project_id = $1 ORDER BY s.position`,
      [projectId],
    );
    const transitions = await query<{ id: string; from_status_id: string; to_status_id: string }>(
      `SELECT id, from_status_id, to_status_id FROM transitions WHERE project_id = $1`,
      [projectId],
    );
    const labels = await query<{ id: string; name: string; color: string }>(
      "SELECT id, name, color FROM labels WHERE project_id = $1 ORDER BY lower(name)",
      [projectId],
    );
    const issues = await query<IssueRow>(
      `SELECT i.id, i.number, i.title, i.description, i.type, i.priority, i.status_id,
              i.created_at, i.updated_at, to_char(i.due_on, 'YYYY-MM-DD') AS due_on,
              parent.number AS parent_number,
              reporter.id AS reporter_id, reporter.name AS reporter_name,
              assignee.id AS assignee_id, assignee.name AS assignee_name,
              COALESCE((
                SELECT json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color) ORDER BY lower(l.name))
                FROM issue_labels il
                JOIN labels l ON l.id = il.label_id
                WHERE il.issue_id = i.id
              ), '[]'::json) AS label_items
       FROM issues i
       JOIN users reporter ON reporter.id = i.reporter_id
       LEFT JOIN users assignee ON assignee.id = i.assignee_id
       LEFT JOIN issues parent ON parent.id = i.parent_id
       WHERE i.project_id = $1
       ORDER BY i.number DESC`,
      [projectId],
    );
    return {
      project: {
        id: projectId,
        key: membership.key,
        name: membership.name,
        description: membership.description,
        role: membership.role,
      },
      members,
      statuses: statuses.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        position: row.position,
        issueCount: row.issue_count,
      })),
      transitions: transitions.map((row) => ({
        id: row.id,
        fromStatusId: row.from_status_id,
        toStatusId: row.to_status_id,
      })),
      issues: issues.map((row) => mapIssue(row, membership.key)),
      labels,
    };
  });

  app.post("/projects/:projectId/members", async (request) => {
    const user = requireUser(request);
    const { projectId } = request.params as { projectId: string };
    const body = parseBody(memberSchema, request.body);
    const membership = await loadMembership(pool, projectId, user.id, true);
    if (membership.role !== "owner") {
      throw new HttpError(403, "Участников приглашает владелец проекта");
    }
    const email = body.email.toLowerCase();
    const found = await query<{ id: string; email_verified_at: Date | null }>(
      "SELECT id, email_verified_at FROM users WHERE email = $1",
      [email],
    );
    const invited = found[0];
    if (!invited) {
      throw new HttpError(404, "Пользователь с такой почтой не зарегистрирован");
    }
    if (!invited.email_verified_at) {
      throw new HttpError(400, "Этот пользователь ещё не подтвердил почту");
    }
    await query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE
       SET role = EXCLUDED.role
       WHERE project_members.role <> 'owner'`,
      [projectId, invited.id, body.role],
    );
    return { ok: true };
  });

  app.delete("/projects/:projectId/members/:userId", async (request) => {
    const user = requireUser(request);
    const { projectId, userId } = request.params as { projectId: string; userId: string };
    const membership = await loadMembership(pool, projectId, user.id, true);
    if (membership.role !== "owner") {
      throw new HttpError(403, "Участников удаляет владелец проекта");
    }
    const target = await query<{ role: Role }>(
      "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, userId],
    );
    if (!target[0]) throw new HttpError(404, "Участник не найден");
    if (target[0].role === "owner") {
      throw new HttpError(400, "Владельца проекта нельзя исключить");
    }
    await tx(async (client) => {
      const assigned = await client.query<{ id: string; name: string }>(
        `SELECT i.id, u.name
         FROM issues i
         JOIN users u ON u.id = i.assignee_id
         WHERE i.project_id = $1 AND i.assignee_id = $2
         FOR UPDATE OF i`,
        [projectId, userId],
      );
      await client.query(
        "UPDATE issues SET assignee_id = NULL WHERE project_id = $1 AND assignee_id = $2",
        [projectId, userId],
      );
      for (const issue of assigned.rows) {
        await client.query(
          `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
           VALUES ($1, $2, $3, 'field_changed', $4::jsonb)`,
          [
            crypto.randomUUID(),
            issue.id,
            user.id,
            JSON.stringify({ field: "assignee", from: issue.name, to: "Никто" }),
          ],
        );
      }
      await client.query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2", [
        projectId,
        userId,
      ]);
    });
    return { ok: true };
  });

  app.post("/projects/:projectId/statuses", async (request, reply) => {
    const user = requireUser(request);
    const { projectId } = request.params as { projectId: string };
    const body = parseBody(createStatusSchema, request.body);
    const id = await tx((client) => addStatus(client, projectId, user.id, body.name, body.category));
    reply.code(201);
    return { id };
  });

  app.patch("/projects/:projectId/statuses/:statusId", async (request) => {
    const user = requireUser(request);
    const { projectId, statusId } = request.params as { projectId: string; statusId: string };
    const body = parseBody(updateStatusSchema, request.body);
    await tx((client) => updateStatus(client, projectId, user.id, statusId, body));
    return { ok: true };
  });

  app.post("/projects/:projectId/statuses/:statusId/shift", async (request) => {
    const user = requireUser(request);
    const { projectId, statusId } = request.params as { projectId: string; statusId: string };
    const body = parseBody(shiftStatusSchema, request.body);
    await tx((client) => shiftStatus(client, projectId, user.id, statusId, body.direction));
    return { ok: true };
  });

  app.delete("/projects/:projectId/statuses/:statusId", async (request) => {
    const user = requireUser(request);
    const { projectId, statusId } = request.params as { projectId: string; statusId: string };
    const body = parseBody(deleteStatusSchema, request.body ?? {});
    await tx((client) => deleteStatus(client, projectId, user.id, statusId, body.moveToStatusId));
    return { ok: true };
  });

  app.post("/projects/:projectId/transitions", async (request, reply) => {
    const user = requireUser(request);
    const { projectId } = request.params as { projectId: string };
    const body = parseBody(createTransitionSchema, request.body);
    await tx((client) => addTransition(client, projectId, user.id, body.fromStatusId, body.toStatusId));
    reply.code(201);
    return { ok: true };
  });

  app.delete("/projects/:projectId/transitions/:fromStatusId/:toStatusId", async (request) => {
    const user = requireUser(request);
    const { projectId, fromStatusId, toStatusId } = request.params as {
      projectId: string;
      fromStatusId: string;
      toStatusId: string;
    };
    await tx((client) => removeTransition(client, projectId, user.id, fromStatusId, toStatusId));
    return { ok: true };
  });

  app.delete("/projects/:projectId", async (request) => {
    const user = requireUser(request);
    const { projectId } = request.params as { projectId: string };
    const membership = await loadMembership(pool, projectId, user.id, true);
    if (membership.role !== "owner") {
      throw new HttpError(403, "Проект удаляет владелец");
    }
    await query("DELETE FROM projects WHERE id = $1", [projectId]);
    return { ok: true };
  });

  app.post("/projects/:projectId/issues", async (request, reply) => {
    const user = requireUser(request);
    const { projectId } = request.params as { projectId: string };
    const body = parseBody(createIssueSchema, request.body);
    const issue = await tx(async (client) => {
      const membership = await loadMembership(client, projectId, user.id, true);
      await assertAssignee(client, projectId, body.assigneeId);
      await assertPlacement(client, projectId, undefined, body.type as IssueType, body.parentId ?? null);
      await client.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
      const numberResult = await client.query<{ next_issue_number: number }>(
        `UPDATE projects SET next_issue_number = next_issue_number + 1
         WHERE id = $1 RETURNING next_issue_number`,
        [projectId],
      );
      const number = numberResult.rows[0].next_issue_number - 1;
      const status = await client.query<{ id: string }>(
        `SELECT id FROM statuses
         WHERE project_id = $1 AND category = 'backlog'
         ORDER BY position LIMIT 1`,
        [projectId],
      );
      const statusId = status.rows[0]?.id;
      if (!statusId) throw new HttpError(500, "У проекта нет начального статуса");
      const issueId = crypto.randomUUID();
      await client.query(
        `INSERT INTO issues
           (id, project_id, number, title, description, type, priority, status_id, reporter_id, assignee_id, due_on, parent_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          issueId,
          projectId,
          number,
          body.title,
          body.description,
          body.type,
          body.priority,
          statusId,
          user.id,
          body.assigneeId ?? null,
          body.dueOn ?? null,
          body.parentId ?? null,
        ],
      );
      await client.query(
        `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
         VALUES ($1, $2, $3, 'created', $4::jsonb)`,
        [crypto.randomUUID(), issueId, user.id, JSON.stringify({ title: body.title })],
      );
      return { id: issueId, key: `${membership.key}-${number}`, number };
    });
    reply.code(201);
    return issue;
  });
}

function mapIssue(row: IssueRow, projectKey: string) {
  return {
    id: row.id,
    number: row.number,
    key: `${projectKey}-${row.number}`,
    title: row.title,
    description: row.description,
    type: row.type,
    priority: row.priority,
    statusId: row.status_id,
    dueOn: row.due_on,
    parentKey: row.parent_number ? `${projectKey}-${row.parent_number}` : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reporter: { id: row.reporter_id, name: row.reporter_name },
    assignee: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name } : null,
    labels: asLabels(row.label_items),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
