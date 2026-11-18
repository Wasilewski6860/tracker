import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, ApiError, isAbort, type ProjectSummary, type User } from "./api";
import { ForgotPassword, ResetPassword, VerifyEmail } from "./pages/AccountPages";
import { IssuePage } from "./pages/IssuePage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";

type AuthContextValue = {
  user: User;
  refreshProjects: () => Promise<void>;
  projects: ProjectSummary[];
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Нет контекста авторизации");
  return value;
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [bootError, setBootError] = useState("");

  function loadMe() {
    setBootError("");
    setUser(undefined);
    api<User>("/api/auth/me")
      .then(setUser)
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        if (error instanceof ApiError && error.status !== 401) {
          setBootError(error.message);
          return;
        }
        setUser(null);
      });
  }

  useEffect(() => {
    loadMe();
  }, []);

  if (bootError) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="brand">Трекер</p>
          <h1>Сервер не отвечает</h1>
          <p>{bootError}</p>
          <button type="button" className="btn primary" onClick={loadMe}>
            Повторить
          </button>
        </div>
      </div>
    );
  }

  if (user === undefined) {
    return <p className="boot">Загрузка…</p>;
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <AuthScreen mode="login" onUser={setUser} />} />
      <Route
        path="/register"
        element={user ? <Navigate to="/" replace /> : <AuthScreen mode="register" onUser={setUser} />}
      />
      <Route path="/forgot" element={user ? <Navigate to="/" replace /> : <ForgotPassword />} />
      <Route path="/verify-email" element={<VerifyEmail onUser={setUser} />} />
      <Route path="/reset-password" element={<ResetPassword onUser={setUser} />} />
      <Route path="/*" element={user ? <Shell user={user} onLogout={() => setUser(null)} /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  async function refreshProjects() {
    setProjects(await api<ProjectSummary[]>("/api/projects"));
  }

  useEffect(() => {
    void refreshProjects().catch(() => setProjects([]));
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  return (
    <AuthContext.Provider value={{ user, projects, refreshProjects, logout }}>
      <div className="shell">
        <header className="topbar">
          <Link to="/" className="brand">
            Трекер
          </Link>
          <div className="topbar-user">
            <span className="avatar" aria-hidden>
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span>{user.name}</span>
            <button type="button" className="btn ghost" onClick={() => void logout()}>
              Выйти
            </button>
          </div>
        </header>
        <div className="body">
          <aside className="sidebar">
            <p className="sidebar-label">Проекты</p>
            {projects.map((project) => (
              <NavLink
                key={project.id}
                to={`/projects/${project.id}`}
                className={({ isActive }) => (isActive ? "side-link active" : "side-link")}
              >
                <span className="key">{project.key}</span>
                <span>{project.name}</span>
              </NavLink>
            ))}
            {projects.length === 0 && <p className="muted side-empty">Пока нет проектов</p>}
          </aside>
          <main className="main">
            <Routes>
              <Route path="/" element={<ProjectsPage />} />
              <Route path="/projects/:projectId" element={<ProjectPage />} />
              <Route path="/projects/:projectId/issues/:issueId" element={<IssuePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </AuthContext.Provider>
  );
}

function AuthScreen({ mode, onUser }: { mode: "login" | "register"; onUser: (user: User) => void }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [email, setEmail] = useState("");
  const isRegister = mode === "register";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      name: String(form.get("name") ?? ""),
    };
    setEmail(payload.email);
    try {
      if (isRegister) {
        const result = await api<{ email: string; devMailbox: string | null }>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setSentTo(result.email);
        setMailbox(result.devMailbox);
        return;
      }
      const user = await api<User>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: payload.email, password: payload.password }),
      });
      onUser(user);
      navigate("/");
    } catch (err) {
      setNeedsVerify(err instanceof ApiError && err.code === "email_not_verified");
      setError(err instanceof Error ? err.message : "Не удалось войти");
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setError("");
    try {
      const result = await api<{ devMailbox: string | null }>("/api/auth/resend", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSentTo(email);
      setMailbox(result.devMailbox);
      setNeedsVerify(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Письмо не отправлено");
    }
  }

  if (sentTo) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="brand">Трекер</p>
          <h1>Проверьте почту</h1>
          <p>Письмо со ссылкой отправлено на {sentTo}.</p>
          {mailbox && (
            <p>
              Локальные письма открываются в <a href={mailbox}>почтовом ящике</a>.
            </p>
          )}
          <Link to="/login">Ко входу</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={(event) => void onSubmit(event)}>
        <p className="brand">Трекер</p>
        <h1>{isRegister ? "Регистрация" : "Вход"}</h1>
        <p className="muted">Упрощённый трекер задач для своей команды.</p>
        {isRegister && (
          <label>
            Имя
            <input name="name" required maxLength={80} autoComplete="name" />
          </label>
        )}
        <label>
          Почта
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Пароль
          <input
            name="password"
            type="password"
            required
            minLength={isRegister ? 8 : 1}
            autoComplete={isRegister ? "new-password" : "current-password"}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        {needsVerify && (
          <button className="btn" type="button" onClick={() => void resend()}>
            Отправить письмо ещё раз
          </button>
        )}
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Секунду…" : isRegister ? "Создать аккаунт" : "Войти"}
        </button>
        {isRegister ? (
          <Link to="/login">Уже есть аккаунт</Link>
        ) : (
          <>
            <Link to="/forgot">Забыли пароль</Link>
            <Link to="/register">Создать аккаунт</Link>
          </>
        )}
      </form>
    </div>
  );
}

export function Banner({ children }: { children: ReactNode }) {
  return <p className="form-error">{children}</p>;
}
