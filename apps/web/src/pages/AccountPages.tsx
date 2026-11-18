import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type User } from "../api";

export function VerifyEmail({ onUser }: { onUser: (user: User) => void }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const token = params.get("token") ?? "";

  async function confirm() {
    setError("");
    setPending(true);
    try {
      const user = await api<User>("/api/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      onUser(user);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось подтвердить почту");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <p className="brand">Трекер</p>
        <h1>Подтверждение почты</h1>
        {token ? (
          <>
            <p className="muted">Нажмите кнопку, чтобы закончить регистрацию и войти.</p>
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" type="button" disabled={pending} onClick={() => void confirm()}>
              {pending ? "Секунду…" : "Подтвердить и войти"}
            </button>
          </>
        ) : (
          <p className="form-error">В ссылке нет кода подтверждения.</p>
        )}
        <Link to="/login">Ко входу</Link>
      </div>
    </div>
  );
}

export function ForgotPassword() {
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [mailbox, setMailbox] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    try {
      const result = await api<{ devMailbox: string | null }>("/api/auth/forgot", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMailbox(result.devMailbox);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Письмо не отправлено");
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={(event) => void onSubmit(event)}>
        <p className="brand">Трекер</p>
        <h1>Новый пароль</h1>
        {sent ? (
          <>
            <p>Если этот адрес зарегистрирован, на него ушло письмо со ссылкой.</p>
            {mailbox && (
              <p>
                Локальные письма открываются в <a href={mailbox}>почтовом ящике</a>.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="muted">Укажите почту аккаунта. Ссылка для смены пароля придёт письмом.</p>
            <label>
              Почта
              <input name="email" type="email" required autoComplete="email" />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" type="submit">
              Отправить ссылку
            </button>
          </>
        )}
        <Link to="/login">Ко входу</Link>
      </form>
    </div>
  );
}

export function ResetPassword({ onUser }: { onUser: (user: User) => void }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const token = params.get("token") ?? "";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const again = String(form.get("again") ?? "");
    if (password !== again) {
      setError("Пароли не совпадают");
      return;
    }
    try {
      const user = await api<User>("/api/auth/reset", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      onUser(user);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сменить пароль");
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={(event) => void onSubmit(event)}>
        <p className="brand">Трекер</p>
        <h1>Новый пароль</h1>
        {token ? (
          <>
            <label>
              Пароль
              <input name="password" type="password" required minLength={8} autoComplete="new-password" />
            </label>
            <label>
              Ещё раз
              <input name="again" type="password" required minLength={8} autoComplete="new-password" />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" type="submit">
              Сохранить
            </button>
          </>
        ) : (
          <p className="form-error">В ссылке нет кода сброса.</p>
        )}
        <Link to="/login">Ко входу</Link>
      </form>
    </div>
  );
}
