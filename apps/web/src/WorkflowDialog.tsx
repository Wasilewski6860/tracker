import { useEffect, useRef, useState } from "react";
import { Banner } from "./App";
import { api, type Category, type Status } from "./api";
import { Field, MenuSelect } from "./fields";

const categoryLabel: Record<Category, string> = {
  backlog: "Бэклог",
  todo: "К выполнению",
  in_progress: "В работе",
  review: "На проверке",
  done: "Готово",
};

const categories = Object.keys(categoryLabel) as Category[];

export function WorkflowDialog({
  projectId,
  statuses,
  transitions,
  onClose,
  onChanged,
}: {
  projectId: string;
  statuses: Status[];
  transitions: { id: string; fromStatusId: string; toStatusId: string }[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { name: string; category: Category }>>({});
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [fromId, setFromId] = useState(statuses[0]?.id ?? "");
  const [toId, setToId] = useState(statuses[1]?.id ?? statuses[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<Category>("todo");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function nameOf(id: string): string {
    return statuses.find((status) => status.id === id)?.name ?? "Статус";
  }

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      setDrafts({});
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить процесс");
    }
  }

  return (
    <div className="modal-blanket" onMouseDown={onClose}>
      <div className="modal workflow-modal" role="dialog" aria-labelledby="workflow-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2 id="workflow-title">Процесс</h2>
          <button type="button" className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="modal-body">
          {error && <Banner>{error}</Banner>}
          <h3>Статусы</h3>
          <ul className="workflow-list">
            {statuses.map((status, index) => {
              const draft = drafts[status.id] ?? { name: status.name, category: status.category };
              const dirty = draft.name !== status.name || draft.category !== status.category;
              return (
                <li key={status.id}>
                  <input
                    aria-label={`Название статуса ${status.name}`}
                    value={draft.name}
                    maxLength={40}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [status.id]: { ...draft, name: event.target.value } }))
                    }
                  />
                  <MenuSelect
                    ariaLabel={`Категория ${status.name}`}
                    value={draft.category}
                    onChange={(next) =>
                      setDrafts((current) => ({
                        ...current,
                        [status.id]: { ...draft, category: next as Category },
                      }))
                    }
                    options={categories.map((item) => ({ value: item, label: categoryLabel[item] }))}
                  />
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={!dirty}
                      onClick={() =>
                        void run(() =>
                          api(`/api/projects/${projectId}/statuses/${status.id}`, {
                            method: "PATCH",
                            body: JSON.stringify(draft),
                          }),
                        )
                      }
                    >
                      Сохранить
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={index === 0}
                      onClick={() =>
                        void run(() =>
                          api(`/api/projects/${projectId}/statuses/${status.id}/shift`, {
                            method: "POST",
                            body: JSON.stringify({ direction: "left" }),
                          }),
                        )
                      }
                    >
                      Левее
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={index === statuses.length - 1}
                      onClick={() =>
                        void run(() =>
                          api(`/api/projects/${projectId}/statuses/${status.id}/shift`, {
                            method: "POST",
                            body: JSON.stringify({ direction: "right" }),
                          }),
                        )
                      }
                    >
                      Правее
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      onClick={() => {
                        if ((status.issueCount ?? 0) > 0) {
                          setMovingId(status.id);
                          setMoveTo(statuses.find((item) => item.id !== status.id)?.id ?? "");
                          return;
                        }
                        if (!confirm(`Удалить статус «${status.name}»?`)) return;
                        void run(() => api(`/api/projects/${projectId}/statuses/${status.id}`, { method: "DELETE", body: "{}" }));
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                  {movingId === status.id && (
                    <div className="row-actions">
                      <Field label="Куда перенести задачи">
                        <MenuSelect
                          ariaLabel="Куда перенести задачи"
                          value={moveTo}
                          onChange={setMoveTo}
                          options={statuses
                            .filter((item) => item.id !== status.id)
                            .map((item) => ({ value: item.id, label: item.name }))}
                        />
                      </Field>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() =>
                          void run(async () => {
                            await api(`/api/projects/${projectId}/statuses/${status.id}`, {
                              method: "DELETE",
                              body: JSON.stringify({ moveToStatusId: moveTo }),
                            });
                            setMovingId(null);
                          })
                        }
                      >
                        Перенести и удалить
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="row-actions">
            <input
              aria-label="Новый статус"
              placeholder="Новый статус"
              value={newName}
              maxLength={40}
              onChange={(event) => setNewName(event.target.value)}
            />
            <MenuSelect
              ariaLabel="Категория нового статуса"
              value={newCategory}
              onChange={(next) => setNewCategory(next as Category)}
              options={categories.map((item) => ({ value: item, label: categoryLabel[item] }))}
            />
            <button
              type="button"
              className="btn primary"
              disabled={!newName.trim()}
              onClick={() =>
                void run(async () => {
                  await api(`/api/projects/${projectId}/statuses`, {
                    method: "POST",
                    body: JSON.stringify({ name: newName, category: newCategory }),
                  });
                  setNewName("");
                })
              }
            >
              Добавить
            </button>
          </div>
          <h3>Переходы</h3>
          <ul className="workflow-list">
            {transitions.map((item) => (
              <li key={item.id}>
                <span>
                  {nameOf(item.fromStatusId)} → {nameOf(item.toStatusId)}
                </span>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() =>
                    void run(() =>
                      api(`/api/projects/${projectId}/transitions/${item.fromStatusId}/${item.toStatusId}`, {
                        method: "DELETE",
                      }),
                    )
                  }
                >
                  Убрать
                </button>
              </li>
            ))}
          </ul>
          <div className="row-actions">
            <MenuSelect
              ariaLabel="Откуда"
              value={fromId}
              onChange={setFromId}
              options={statuses.map((status) => ({ value: status.id, label: status.name }))}
            />
            <MenuSelect
              ariaLabel="Куда"
              value={toId}
              onChange={setToId}
              options={statuses.map((status) => ({ value: status.id, label: status.name }))}
            />
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                void run(() =>
                  api(`/api/projects/${projectId}/transitions`, {
                    method: "POST",
                    body: JSON.stringify({ fromStatusId: fromId, toStatusId: toId }),
                  }),
                )
              }
            >
              Добавить переход
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
