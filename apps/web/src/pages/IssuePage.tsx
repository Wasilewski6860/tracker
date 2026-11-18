import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Banner, useAuth } from "../App";
import { api, downloadFile, isAbort, type IssueDetails, type IssueType, type LinkType, type Priority } from "../api";
import { DateField } from "../DateField";
import { Field, MenuSelect, UserPicker } from "../fields";
import { LabelField } from "../LabelField";
import { RichText } from "../RichText";
import { formatWhen, linkPhrase, placementError, priorityLabel, typeLabel, typeMark } from "../labels";

export function IssuePage() {
  const { projectId = "", issueId = "" } = useParams();
  const navigate = useNavigate();
  const { refreshProjects, user } = useAuth();
  const [data, setData] = useState<IssueDetails | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<IssueType>("task");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [parentId, setParentId] = useState("");
  const [comment, setComment] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [linkId, setLinkId] = useState("");
  const [linkType, setLinkType] = useState<LinkType>("relates");
  const [editingDescription, setEditingDescription] = useState(false);

  function applyIssue(next: IssueDetails) {
    setData(next);
    setTitle(next.issue.title);
    setDescription(next.issue.description);
    setType(next.issue.type);
    setPriority(next.issue.priority);
    setAssigneeId(next.issue.assignee?.id ?? "");
    setDueOn(next.issue.dueOn ?? "");
    setParentId(next.issue.parent?.id ?? "");
    setEditingDescription(false);
  }

  async function load(resetForm = true) {
    const next = await api<IssueDetails>(`/api/issues/${issueId}`);
    setData(next);
    if (!resetForm) return;
    setTitle(next.issue.title);
    setDescription(next.issue.description);
    setType(next.issue.type);
    setPriority(next.issue.priority);
    setAssigneeId(next.issue.assignee?.id ?? "");
    setDueOn(next.issue.dueOn ?? "");
    setParentId(next.issue.parent?.id ?? "");
    setEditingDescription(false);
  }

  useEffect(() => {
    if (!data) return;
    if (type === "epic" || type === "bug") {
      if (parentId) setParentId("");
      return;
    }
    if (!parentId) return;
    const parent = data.candidates.find((item) => item.id === parentId);
    if (!parent || placementError(type, parent.type)) setParentId("");
  }, [type, parentId, data]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setData(null);
    api<IssueDetails>(`/api/issues/${issueId}`, { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) applyIssue(next);
      })
      .catch((err: unknown) => {
        if (isAbort(err) || controller.signal.aborted) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Не удалось открыть задачу");
      });
    return () => controller.abort();
  }, [issueId]);

  if (!data && !error) return <p className="muted">Загрузка задачи…</p>;
  if (!data) return <Banner>{error}</Banner>;

  const canWrite = data.issue.role !== "viewer";
  const statusName = data.statuses.find((status) => status.id === data.issue.statusId)?.name ?? "";
  const dirty =
    title !== data.issue.title ||
    description !== data.issue.description ||
    type !== data.issue.type ||
    priority !== data.issue.priority ||
    assigneeId !== (data.issue.assignee?.id ?? "") ||
    dueOn !== (data.issue.dueOn ?? "") ||
    parentId !== (data.issue.parent?.id ?? "");

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/issues/${issueId}`, {
        method: "PATCH",
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    }
  }

  async function transit(toStatusId: string) {
    setError("");
    try {
      await api(`/api/issues/${issueId}/transitions`, {
        method: "POST",
        body: JSON.stringify({ toStatusId }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Переход не выполнен");
    }
  }

  async function sendComment() {
    setError("");
    try {
      await api(`/api/issues/${issueId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: comment }),
      });
      setComment("");
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Комментарий не отправлен");
    }
  }

  async function saveComment(commentId: string) {
    setError("");
    try {
      await api(`/api/issues/${issueId}/comments/${commentId}`, {
        method: "PATCH",
        body: JSON.stringify({ body: commentDraft }),
      });
      setEditingCommentId(null);
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Комментарий не сохранён");
    }
  }

  async function removeComment(commentId: string) {
    if (!confirm("Удалить комментарий?")) return;
    setError("");
    try {
      await api(`/api/issues/${issueId}/comments/${commentId}`, { method: "DELETE" });
      if (editingCommentId === commentId) setEditingCommentId(null);
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Комментарий не удалён");
    }
  }

  async function addLabel(name: string) {
    setError("");
    try {
      await api(`/api/issues/${issueId}/labels`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Метка не добавлена");
    }
  }

  async function removeLabel(labelId: string) {
    setError("");
    try {
      await api(`/api/issues/${issueId}/labels/${labelId}`, { method: "DELETE" });
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Метка не снята");
    }
  }

  async function uploadFile(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      await api(`/api/issues/${issueId}/attachments`, { method: "POST", body });
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Файл не приложен");
    }
  }

  async function removeFile(attachmentId: string) {
    if (!confirm("Удалить файл?")) return;
    setError("");
    try {
      await api(`/api/issues/${issueId}/attachments/${attachmentId}`, { method: "DELETE" });
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Файл не удалён");
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  }

  async function addLink() {
    if (!linkId) return;
    setError("");
    try {
      await api(`/api/issues/${issueId}/links`, {
        method: "POST",
        body: JSON.stringify({ targetId: linkId, type: linkType }),
      });
      setLinkId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить связь");
    }
  }

  async function removeLink(id: string) {
    setError("");
    try {
      await api(`/api/issues/${issueId}/links/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось убрать связь");
    }
  }

  async function remove() {
    if (data!.children.length > 0) {
      setError("Нельзя удалить задачу, пока у неё есть вложенные. Сначала перенесите или удалите их.");
      return;
    }
    if (!confirm(`Удалить ${data!.issue.key}?`)) return;
    try {
      await api(`/api/issues/${issueId}`, { method: "DELETE" });
      await refreshProjects();
      navigate(`/projects/${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить задачу");
    }
  }

  return (
    <section>
      <p className="crumbs">
        <Link to={`/projects/${projectId}`}>К доске</Link>
      </p>
      <form className="issue-layout" onSubmit={(event) => void save(event)}>
        <div className="issue-main">
          <p className="issue-kicker">
            <span className={`type-mark type-${data.issue.type}`}>{typeMark[data.issue.type]}</span>
            <span className="key">{data.issue.key}</span>
            <span className="muted">{typeLabel[data.issue.type]}</span>
          </p>
          <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canWrite} required />
          <p className="muted">Сейчас «{statusName}»</p>
          {error && <Banner>{error}</Banner>}
          <div className="transition-row">
            {data.transitions.map((item) => (
              <button
                key={item.toStatusId}
                type="button"
                className="btn"
                disabled={!canWrite}
                onClick={() => void transit(item.toStatusId)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <section className="description-block">
            <div className="row-actions">
              <h2>Описание</h2>
              {canWrite && !editingDescription && (
                <button type="button" className="btn" onClick={() => setEditingDescription(true)}>
                  Изменить
                </button>
              )}
            </div>
            {editingDescription ? (
              <>
                <textarea rows={8} value={description} onChange={(event) => setDescription(event.target.value)} />
                <p className="hint">**жирный**, *курсив*, `код`, списки и ссылки. HTML показывается как текст.</p>
                {description.trim() && <RichText text={description} />}
              </>
            ) : description.trim() ? (
              <RichText text={description} />
            ) : (
              <p className="muted">Описания пока нет.</p>
            )}
          </section>
          {data.children.length > 0 && (
            <>
              <h2>Вложенные задачи</h2>
              <ul className="child-list">
                {data.children.map((item) => (
                  <li key={item.id}>
                    <span className={`type-mark type-${item.type}`}>{typeMark[item.type]}</span>
                    <Link to={`/projects/${projectId}/issues/${item.id}`}>
                      {item.key} {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h2>Связи</h2>
          {data.links.length === 0 && <p className="muted">Связей пока нет.</p>}
          <ul className="child-list">
            {data.links.map((item) => (
              <li key={item.id}>
                <span className="muted">{linkPhrase(item.type, item.outward)}</span>
                <Link to={`/projects/${projectId}/issues/${item.issue.id}`}>
                  {item.issue.key} {item.issue.title}
                </Link>
                {canWrite && (
                  <button type="button" className="btn ghost" onClick={() => void removeLink(item.id)}>
                    Убрать
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canWrite && (
            <div className="link-add">
              <MenuSelect
                searchable
                ariaLabel="Связанная задача"
                value={linkId}
                placeholder="Задача"
                onChange={setLinkId}
                options={data.candidates.map((item) => ({
                  value: item.id,
                  label: `${item.key} ${item.title}`,
                  hint: typeLabel[item.type],
                }))}
              />
              <MenuSelect
                ariaLabel="Тип связи"
                value={linkType}
                onChange={(next) => setLinkType(next as LinkType)}
                options={[
                  { value: "relates", label: "Связана с" },
                  { value: "blocks", label: "Блокирует" },
                  { value: "duplicates", label: "Дублирует" },
                ]}
              />
              <button type="button" className="btn" disabled={!linkId} onClick={() => void addLink()}>
                Связать
              </button>
            </div>
          )}
          <h2>Вложения</h2>
          {data.attachments.length === 0 && <p className="muted">Файлов пока нет.</p>}
          <ul className="child-list">
            {data.attachments.map((file) => (
              <li key={file.id}>
                <button type="button" className="btn ghost" onClick={() => void downloadFile(`/api/issues/${issueId}/attachments/${file.id}`, file.name)}>
                  {file.name}
                </button>
                <span className="muted">
                  {formatSize(file.sizeBytes)} · {file.author.name}
                </span>
                {file.canDelete && (
                  <button type="button" className="btn danger" onClick={() => void removeFile(file.id)}>
                    Удалить
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canWrite && (
            <label className="btn file-pick">
              Приложить файл
              <input
                type="file"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  void uploadFile(file);
                }}
              />
            </label>
          )}
          <p className="hint">До 10 МБ. Программы, скрипты и страницы не принимаются.</p>
          <h2>Комментарии</h2>
          <ul className="feed">
            {data.comments.map((item) => (
              <li key={item.id}>
                <strong>{item.author.name}</strong>
                <span className="muted">
                  {formatWhen(item.createdAt)}
                  {item.editedAt ? " · изменён" : ""}
                </span>
                {editingCommentId === item.id ? (
                  <div className="comment-box">
                    <textarea
                      rows={3}
                      value={commentDraft}
                      aria-label="Текст комментария"
                      onChange={(event) => setCommentDraft(event.target.value)}
                    />
                    {commentDraft.trim() && <RichText text={commentDraft} />}
                    <div className="row-actions">
                      <button className="btn primary" type="button" onClick={() => void saveComment(item.id)}>
                        Сохранить
                      </button>
                      <button className="btn" type="button" onClick={() => setEditingCommentId(null)}>
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <RichText text={item.body} />
                )}
                {editingCommentId !== item.id && (item.canEdit || item.canDelete) && (
                  <div className="row-actions">
                    {item.canEdit && (
                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          setEditingCommentId(item.id);
                          setCommentDraft(item.body);
                        }}
                      >
                        Изменить
                      </button>
                    )}
                    {item.canDelete && (
                      <button className="btn danger" type="button" onClick={() => void removeComment(item.id)}>
                        Удалить
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {data.comments.length === 0 && <p className="muted">Комментариев пока нет.</p>}
          {canWrite && (
            <div className="comment-box">
              <textarea
                rows={3}
                value={comment}
                placeholder="Комментарий"
                onChange={(event) => setComment(event.target.value)}
              />
              <p className="hint">**жирный**, *курсив*, `код`, списки и ссылки. HTML показывается как текст.</p>
              {comment.trim() && <RichText text={comment} />}
              <button className="btn" type="button" onClick={() => void sendComment()}>
                Отправить
              </button>
            </div>
          )}
        </div>
        <aside className="panel details">
          <h2>Сведения</h2>
          <Field label="Тип">
            <MenuSelect
              ariaLabel="Тип"
              value={type}
              disabled={!canWrite}
              onChange={(next) => setType(next as IssueType)}
              options={(Object.keys(typeLabel) as IssueType[]).map((item) => ({ value: item, label: typeLabel[item] }))}
            />
          </Field>
          <Field label="Приоритет">
            <MenuSelect
              ariaLabel="Приоритет"
              value={priority}
              disabled={!canWrite}
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
              disabled={!canWrite}
              meId={user.id}
              people={data.members}
              onChange={setAssigneeId}
            />
          </Field>
          <Field label="Срок">
            <DateField ariaLabel="Срок" value={dueOn} disabled={!canWrite} onChange={setDueOn} />
          </Field>
          <Field label="Родитель">
            <MenuSelect
              searchable
              ariaLabel="Родитель"
              value={parentId}
              disabled={!canWrite || type === "epic" || type === "bug"}
              onChange={setParentId}
              options={[
                ...(type === "subtask" ? [] : [{ value: "", label: "Нет" }]),
                ...data.candidates
                  .filter((item) => !placementError(type, item.type))
                  .map((item) => ({
                    value: item.id,
                    label: `${item.key} ${item.title}`,
                    hint: typeLabel[item.type],
                  })),
              ]}
            />
          </Field>
          <Field label="Метки">
            <LabelField
              labels={data.labels}
              catalog={data.projectLabels}
              disabled={!canWrite}
              onAdd={addLabel}
              onRemove={removeLabel}
            />
          </Field>
          <p className="muted">Автор {data.issue.reporter.name}</p>
          {canWrite && (
            <div className="row-actions">
              <button className="btn primary" type="submit" disabled={!dirty}>
                Сохранить
              </button>
              {data.canDelete && (
                <button className="btn danger" type="button" onClick={() => void remove()}>
                  Удалить
                </button>
              )}
            </div>
          )}
          {dirty && <p className="dirty">Есть несохранённые изменения</p>}
          <h2>Журнал</h2>
          <ul className="feed">
            {data.activities.map((item) => (
              <li key={item.id}>
                <p>{item.text}</p>
                <span className="muted">{formatWhen(item.createdAt)}</span>
              </li>
            ))}
          </ul>
        </aside>
      </form>
    </section>
  );
}
