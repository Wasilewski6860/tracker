import bcrypt from "bcryptjs";
import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { query } from "./db";
import { env } from "./env";
import { HttpError } from "./http";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

const COOKIE = "tracker_session";
const MAX_AGE = 60 * 60 * 24 * 14;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: "14d" });
}

export function setSessionCookie(reply: FastifyReply, userId: string): void {
  reply.setCookie(COOKIE, signSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: env.cookieSecure,
    maxAge: MAX_AGE,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: "/" });
}

export async function readUser(request: FastifyRequest): Promise<AuthUser | null> {
  const token = request.cookies[COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub?: string };
    if (!payload.sub) return null;
    const rows = await query<AuthUser>(
      "SELECT id, email, name FROM users WHERE id = $1 AND email_verified_at IS NOT NULL",
      [payload.sub],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) {
    throw new HttpError(401, "Нужно войти");
  }
  return request.user;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}
