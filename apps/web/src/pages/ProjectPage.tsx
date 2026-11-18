import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Banner, useAuth } from "../App";
import { api, isAbort, type Board, type Issue, type IssueType, type Priority, type Role } from "../api";
import { DateField } from "../DateField";
import { Field, MenuSelect, PeopleButton, PeopleDialog, UserPicker } from "../fields";
import { LabelChips } from "../LabelField";
import { WorkflowDialog } from "../WorkflowDialog";
import { formatDay, placementError, priorityLabel, typeLabel, typeMark } from "../labels";

const priorityRank: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function ProjectPage() {
  const { projectId = "" } = useParams();
  const { refreshProjects, user } = useAuth();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(false);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<IssueType>("task");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [parentId, setParentId] = useState("");
  const confirmedStatus = useRef<Record<string, string>>({});
  const moveSeq = useRef<Record<string, number>>({});

  function rememberBoard(next: Board) {
    const statuses: Record<string, string> = {};
    for (const issue of next.issues) statuses[issue.id] = issue.statusId;
    confirmedStatus.current = statuses;
    setBoard(next);
  }

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setBoard(null);
    api<Board>(`/api/projects/${projectId}/board`, { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) rememberBoard(next);
      })
      .catch((err: unknown) => {
        if (isAbort(err) || controller.signal.aborted) return;
        setBoard(null);
        setError(err instanceof Error ? err.message : "Не удалось открыть проект");
      });
    return () => controller.abort();
  }, [projectId]);

  async function load() {
    rememberBoard(await api<Board>(`/api/projects/${projectId}/board`));
  }

  useEffect(() => {
    if (type === "epic" || type === "bug") {
      if (parentId) setParentId("");
      return;
    }
    if (!parentId || !board) return;
    const parent = board.issues.find((issue) => issue.id === parentId);
    if (!parent || placementError(type, parent.type)) setParentId("");
  }, [type, parentId, board]);

  const issues = useMemo(() => {
    if (!board) return [];
    const needle = query.trim().toLowerCase();
    return board.issues.filter((issue) => {
      if (mine && issue.assignee?.id !== user.id) return false;
      if (labelIds.length > 0 && !labelIds.every((id) => issue.labels.some((label) => label.id === id))) return false;
      if (!needle) return true;
      return (
        issue.title.toLowerCase().includes(needle) ||
        issue.key.toLowerCase().includes(needle) ||
        (issue.assignee?.name.toLowerCase().includes(needle) ?? false) ||
        issue.labels.some((label) => label.name.toLowerCase().includes(needle))
      );
    });
  }, [board, query, mine, labelIds, user.id]);

  async function createIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api(`/api/projects/${projectId}/issues`, {
        method: "POST",
        body: JSON.stringify({
          title,
          description,
          type,
          priority,
          assigneeId: assigneeId || null,
          dueOn: dueOn || null,
          parentId: parentId || null,
        }),
      });
      setTitle("");
      setDescription("");
      setType("task");
      setPriority("medium");
      setAssigneeId("");
      setDueOn("");
      setParentId("");
      setCreating(false);
      await load();
      await refreshProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать задачу");
    }
  }

  async function move(issue: Issue, toStatusId: string) {
    if (issue.statusId === toStatusId || !board) return;
    const allowed = board.transitions.some(
      (item) => item.fromStatusId === issue.statusId && item.toStatusId === toStatusId,
    );
    if (!allowed) {
      setError("Такой переход статуса не разрешён");
      return;
    }
    setError("");
    const seq = (moveSeq.current[issue.id] ?? 0) + 1;
    moveSeq.current[issue.id] = seq;
    const known = confirmedStatus.current[issue.id] ?? issue.statusId;
    setBoard((current) =>
      current
        ? {
            ...current,
            issues: current.issues.map((item) => (item.id === issue.id ? { ...item, statusId: toStatusId } : item)),
          }
        : current,
    );
    try {
      await api(`/api/issues/${issue.id}/transitions`, {
        method: "POST",
        body: JSON.stringify({ toStatusId }),
      });
      if (moveSeq.current[issue.id] === seq) confirmedStatus.current[issue.id] = toStatusId;
    } catch (err) {
      if (moveSeq.current[issue.id] !== seq) return;
      setBoard((current) =>
        current
          ? {
              ...current,
              issues: current.issues.map((item) => (item.id === issue.id ? { ...item, statusId: known } : item)),
            }
          : current,
      );
      setError(err instanceof Error ? err.message : "Не удалось сменить статус");
    }
  }

  async function inviteRole(email: string, role: string) {
    await api(`/api/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
    await load();
  }

  async function inviteMany(emails: string[], role: Exclude<Role, "owner">) {
    for (const email of emails) {
      await api(`/api/projects/${projectId}/members`, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
    }
    await load();
  }

  async function removeMember(userId: string) {
    if (!confirm("Исключить участника из проекта?")) return;
    await api(`/api/projects/${projectId}/members/${userId}`, { method: "DELETE" });
    await load();
  }

  async function removeProject() {
    if (!board || !confirm(`Удалить проект ${board.project.key}? Задачи тоже исчезнут.`)) return;
    await api(`/api/projects/${projectId}`, { method: "DELETE" });
    await refreshProjects();
    window.location.assign("/");
  }

  if (!board && !error) return <p className="muted">Загрузка проекта…</p>;
  if (!board) return <Banner>{error}</Banner>;

  const canWrite = board.project.role !== "viewer";

  return (
    <section>
      <div className="page-head">
        <div>
          <p className="key">{board.project.key}</p>
          <h1>{board.project.name}</h1>
          {board.project.description && <p className="muted">{board.project.description}</p>}
        </div>
        <div className="head-actions">
          <PeopleButton
            members={board.members}
            isOwner={board.project.role === "owner"}
            onClick={() => setPeopleOpen(true)}
          />
          {board.project.role === "owner" && (
            <button type="button" className="btn" onClick={() => setWorkflowOpen(true)}>
              Процесс
            </button>
          )}
          {canWrite && (
            <button type="button" className="btn primary" onClick={() => setCreating((value) => !value)}>
              Создать
            </button>
          )}
        </div>
      </div>
      {error && <Banner>{error}</Banner>}
      {creating && (
        <form className="panel form-grid" onSubmit={(event) => void createIssue(event)}>
          <Field className="span-2" label="Название">
            <input value={title} required maxLength={200} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Тип">
            <MenuSelect
              ariaLabel="Тип"
              value={type}
              onChange={(next) => setType(next as IssueType)}
              options={(Object.keys(typeLabel) as IssueType[]).map((item) => ({ value: item, label: typeLabel[item] }))}
            />
          </Field>
          <Field label="Приоритет">
            <MenuSelect
              ariaLabel="Приоритет"
              value={priority}
              onChange={(next) => setPriority(next as Priority)}
              options={(Object.keys(priorityLabel) as Priority[]).map((item) => ({
                value: item,
                label: priorityLabel[item],
              }))}
            />
          </Field>
          <Field label="Исполнитель">
            <UserPicker
              ariaLabel="Исполнитель"
              value={assigneeId}
              meId={user.id}
              people={board.members}
              onChange={setAssigneeId}
            />
          </Field>
          <Field label="Срок">
            <DateField ariaLabel="Срок" value={dueOn} onChange={setDueOn} />
          </Field>
          <Field label="Родитель">
            <MenuSelect
              searchable
              ariaLabel="Родитель"
              value={parentId}
              disabled={type === "epic" || type === "bug"}
              onChange={setParentId}
              options={[
                ...(type === "subtask" ? [] : [{ value: "", label: "Нет" }]),
                ...board.issues
                  .filter((issue) => !placementError(type, issue.type))
                  .map((issue) => ({
                    value: issue.id,
                    label: `${issue.key} ${issue.title}`,
                    hint: typeLabel[issue.type],
                  })),
              ]}
            />
          </Field>
          <label className="field span-2">
            <span>Описание</span>
            <textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <div className="span-2 row-actions">
            <button className="btn primary" type="submit">
              Создать
            </button>
            <button className="btn" type="button" onClick={() => setCreating(false)}>
              Отмена
            </button>
          </div>
        </form>
      )}
      <div className="toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по ключу, названию, исполнителю, метке"
        />
        <label className="check">
          <input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} />
          Только мои
        </label>
      </div>
      {board.labels.length > 0 && (
        <div className="label-row label-filter">
          {board.labels.map((label) => {
            const selected = labelIds.includes(label.id);
            return (
              <button
                key={label.id}
                type="button"
                className={`label-chip ${selected ? "selected" : ""}`}
                style={{ background: label.color }}
                aria-pressed={selected}
                onClick={() =>
                  setLabelIds((current) =>
                    current.includes(label.id) ? current.filter((id) => id !== label.id) : [...current, label.id],
                  )
                }
              >
                {label.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="board">
        {board.statuses.map((status) => {
          const column = issues
            .filter((issue) => issue.statusId === status.id)
            .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || b.number - a.number);
          return (
            <div
              key={status.id}
              className={`column cat-${status.category} ${dragOver === status.id ? "over" : ""}`}
              onDragOver={(event) => {
                if (!canWrite) return;
                event.preventDefault();
                setDragOver(status.id);
              }}
              onDragLeave={() => setDragOver((current) => (current === status.id ? null : current))}
              onDrop={(event: DragEvent<HTMLDivElement>) => {
                setDragOver(null);
                const issueId = event.dataTransfer.getData("text/plain");
                const issue = board.issues.find((item) => item.id === issueId);
                if (issue) void move(issue, status.id);
              }}
            >
              <header>
                <strong>{status.name}</strong>
                <span>{column.length}</span>
              </header>
              {column.map((issue) => (
                <article
                  key={issue.id}
                  className={`issue-card priority-${issue.priority}`}
                  draggable={canWrite}
                  onDragStart={(event) => event.dataTransfer.setData("text/plain", issue.id)}
                >
                  <div className="issue-card-top">
                    <span className={`type-mark type-${issue.type}`}>{typeMark[issue.type]}</span>
                    <Link to={`/projects/${projectId}/issues/${issue.id}`}>{issue.key}</Link>
                    <span className="muted">{typeLabel[issue.type]}</span>
                  </div>
                  <Link to={`/projects/${projectId}/issues/${issue.id}`} className="issue-title">
                    {issue.title}
                  </Link>
                  <LabelChips labels={issue.labels} />
                  <div className="issue-card-foot">
                    <span>{priorityLabel[issue.priority]}</span>
                    <span>{issue.dueOn ? formatDay(issue.dueOn) : issue.assignee?.name ?? "Не назначен"}</span>
                  </div>
                  {issue.parentKey && <span className="muted">в {issue.parentKey}</span>}
                  {canWrite && (
                    <MenuSelect
                      compact
                      ariaLabel={`Статус ${issue.key}`}
                      value={issue.statusId}
                      onChange={(next) => void move(issue, next)}
                      options={[
                        { value: issue.statusId, label: status.name },
                        ...board.transitions
                          .filter((item) => item.fromStatusId === issue.statusId)
                          .map((item) => ({
                            value: item.toStatusId,
                            label: board.statuses.find((candidate) => candidate.id === item.toStatusId)?.name ?? "",
                          })),
                      ]}
                    />
                  )}
                </article>
              ))}
              {column.length === 0 && <p className="muted column-empty">Пусто</p>}
            </div>
          );
        })}
      </div>
      {board.project.role === "owner" && (
        <div className="project-foot">
          <button type="button" className="btn danger" onClick={() => void removeProject()}>
            Удалить проект
          </button>
        </div>
      )}
      {workflowOpen && (
        <WorkflowDialog
          projectId={projectId}
          statuses={board.statuses}
          transitions={board.transitions}
          onClose={() => setWorkflowOpen(false)}
          onChanged={async () => {
            await load();
          }}
        />
      )}
      {peopleOpen && (
        <PeopleDialog
          projectName={board.project.name}
          members={board.members}
          isOwner={board.project.role === "owner"}
          onClose={() => setPeopleOpen(false)}
          onAdd={inviteMany}
          onRole={(email, role) => inviteRole(email, role)}
          onRemove={removeMember}
        />
      )}
    </section>
  );
}
