import type { FastifyInstance } from "fastify";
import {
  checkPassword,
  clearSessionCookie,
  hashPassword,
  requireUser,
  setSessionCookie,
} from "../auth";
import { query } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { consumeEmailToken, devMailbox, issueEmailToken, sendAuthMail } from "../mail";
import {
  emailSchema,
  loginSchema,
  parseBody,
  registerSchema,
  resetSchema,
  tokenSchema,
} from "../schemas";

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  email_verified_at: Date | null;
};

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", async (request) => {
    const body = parseBody(registerSchema, request.body);
    const email = body.email.toLowerCase();
    const existing = await query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (existing.length) {
      throw new HttpError(409, "Такая почта уже зарегистрирована");
    }
    const id = crypto.randomUUID();
    await query(
      "INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)",
      [id, email, body.name, await hashPassword(body.password)],
    );
    try {
      await sendVerification(id, email);
    } catch (error) {
      await query("DELETE FROM users WHERE id = $1", [id]);
      app.log.error(error);
      throw new HttpError(503, "Не удалось отправить письмо. Почтовый сервер сейчас недоступен.");
    }
    return { email, devMailbox: devMailbox() };
  });

  app.post("/auth/verify-email", async (request, reply) => {
    const body = parseBody(tokenSchema, request.body);
    const userId = await consumeEmailToken(body.token, "verify");
    if (!userId) {
      throw new HttpError(400, "Ссылка недействительна или устарела");
    }
    await query("UPDATE users SET email_verified_at = now() WHERE id = $1", [userId]);
    const user = await publicUser(userId);
    setSessionCookie(reply, userId);
    return user;
  });

  app.post("/auth/resend", async (request) => {
    const body = parseBody(emailSchema, request.body);
    const email = body.email.toLowerCase();
    const rows = await query<{ id: string; email_verified_at: Date | null }>(
      "SELECT id, email_verified_at FROM users WHERE email = $1",
      [email],
    );
    const user = rows[0];
    if (user && !user.email_verified_at) {
      try {
        await sendVerification(user.id, email);
      } catch (error) {
        app.log.error(error);
        throw new HttpError(503, "Не удалось отправить письмо. Почтовый сервер сейчас недоступен.");
      }
    }
    return { ok: true, devMailbox: devMailbox() };
  });

  app.post("/auth/login", async (request, reply) => {
    const body = parseBody(loginSchema, request.body);
    const email = body.email.toLowerCase();
    const rows = await query<UserRow>(
      "SELECT id, email, name, password_hash, email_verified_at FROM users WHERE email = $1",
      [email],
    );
    const user = rows[0];
    if (!user || !(await checkPassword(body.password, user.password_hash))) {
      throw new HttpError(401, "Неверная почта или пароль");
    }
    if (!user.email_verified_at) {
      throw new HttpError(
        403,
        "Сначала подтвердите почту. Письмо можно отправить ещё раз.",
        "email_not_verified",
      );
    }
    setSessionCookie(reply, user.id);
    return { id: user.id, email: user.email, name: user.name };
  });

  app.post("/auth/forgot", async (request) => {
    const body = parseBody(emailSchema, request.body);
    const email = body.email.toLowerCase();
    const rows = await query<{ id: string; email_verified_at: Date | null }>(
      "SELECT id, email_verified_at FROM users WHERE email = $1",
      [email],
    );
    const user = rows[0];
    try {
      if (user?.email_verified_at) {
        const token = await issueEmailToken(user.id, "reset");
        const link = `${env.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
        await sendAuthMail({
          to: email,
          subject: "Сброс пароля в Трекере",
          text: `Чтобы задать новый пароль, откройте ссылку в течение часа:\n${link}\n\nЕсли вы не запрашивали сброс, это письмо можно проигнорировать.`,
        });
      } else if (user) {
        await sendVerification(user.id, email);
      }
    } catch (error) {
      app.log.error(error);
      throw new HttpError(503, "Не удалось отправить письмо. Почтовый сервер сейчас недоступен.");
    }
    return { ok: true, devMailbox: devMailbox() };
  });

  app.post("/auth/reset", async (request, reply) => {
    const body = parseBody(resetSchema, request.body);
    const userId = await consumeEmailToken(body.token, "reset");
    if (!userId) {
      throw new HttpError(400, "Ссылка недействительна или устарела");
    }
    await query(
      "UPDATE users SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1",
      [userId, await hashPassword(body.password)],
    );
    const user = await publicUser(userId);
    setSessionCookie(reply, userId);
    return user;
  });

  app.post("/auth/logout", async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/auth/me", async (request) => {
    const user = requireUser(request);
    return user;
  });

  app.get("/users", async (request) => {
    requireUser(request);
    const q = String((request.query as { q?: string }).q ?? "").trim();
    if (q.length < 1 || q.length > 80) return [];
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    return query<{ id: string; name: string; email: string }>(
      `SELECT id, name, email
       FROM users
       WHERE email_verified_at IS NOT NULL
         AND (name ILIKE $1 ESCAPE '\\' OR email ILIKE $1 ESCAPE '\\')
       ORDER BY name
       LIMIT 8`,
      [like],
    );
  });
}

async function sendVerification(userId: string, email: string): Promise<void> {
  const token = await issueEmailToken(userId, "verify");
  const link = `${env.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  await sendAuthMail({
    to: email,
    subject: "Подтвердите почту в Трекере",
    text: `Подтвердите адрес, открыв ссылку в течение 24 часов:\n${link}`,
  });
}

async function publicUser(userId: string): Promise<{ id: string; email: string; name: string }> {
  const rows = await query<{ id: string; email: string; name: string }>(
    "SELECT id, email, name FROM users WHERE id = $1",
    [userId],
  );
  const user = rows[0];
  if (!user) throw new HttpError(404, "Пользователь не найден");
  return user;
}
