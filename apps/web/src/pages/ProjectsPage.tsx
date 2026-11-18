import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Banner, useAuth } from "../App";
import { api } from "../api";
import { roleLabel } from "../labels";

export function ProjectsPage() {
  const { projects, refreshProjects } = useAuth();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
    const form = new FormData(formElement);
    try {
      await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          key: String(form.get("key") ?? ""),
          description: String(form.get("description") ?? ""),
        }),
      });
      formElement.reset();
      setOpen(false);
      await refreshProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать проект");
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Проекты</h1>
          <p className="muted">Каждый проект получает свой ключ задач, например WEB-12.</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setOpen((value) => !value)}>
          Новый проект
        </button>
      </div>
      {open && (
        <form className="panel form-grid" onSubmit={(event) => void onSubmit(event)}>
          <label>
            Название
            <input name="name" required maxLength={120} placeholder="Сайт" />
          </label>
          <label>
            Ключ
            <input name="key" required minLength={2} maxLength={10} placeholder="WEB" />
          </label>
          <label className="span-2">
            Описание
            <textarea name="description" rows={3} maxLength={4000} />
          </label>
          {error && (
            <div className="span-2">
              <Banner>{error}</Banner>
            </div>
          )}
          <div className="span-2">
            <button className="btn primary" type="submit">
              Создать
            </button>
          </div>
        </form>
      )}
      <div className="project-grid">
        {projects.map((project) => (
          <Link key={project.id} to={`/projects/${project.id}`} className="project-card">
            <span className="key">{project.key}</span>
            <strong>{project.name}</strong>
            <span className="muted">
              {project.issueCount} задач · {roleLabel[project.role]}
            </span>
          </Link>
        ))}
      </div>
      {projects.length === 0 && <p className="empty">Создайте первый проект, чтобы завести задачи.</p>}
    </section>
  );
}
