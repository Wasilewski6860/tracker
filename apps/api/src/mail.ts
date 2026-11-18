import { createHash, randomBytes } from "crypto";
import nodemailer from "nodemailer";
import { query } from "./db";
import { env } from "./env";

const transport = nodemailer.createTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: env.smtpPort === 465,
  auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPassword } : undefined,
});

export function devMailbox(): string | null {
  const local = env.smtpHost === "127.0.0.1" || env.smtpHost === "localhost";
  return local ? "http://localhost:8025" : null;
}

export async function issueEmailToken(
  userId: string,
  purpose: "verify" | "reset",
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const hours = purpose === "verify" ? 24 : 1;
  await query(
    `DELETE FROM email_tokens
     WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
    [userId, purpose],
  );
  await query(
    `INSERT INTO email_tokens (id, user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval)`,
    [crypto.randomUUID(), userId, purpose, tokenHash, String(hours)],
  );
  return token;
}

export async function consumeEmailToken(
  token: string,
  purpose: "verify" | "reset",
): Promise<string | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await query<{ id: string; user_id: string }>(
    `UPDATE email_tokens
     SET used_at = now()
     WHERE token_hash = $1
       AND purpose = $2
       AND used_at IS NULL
       AND expires_at > now()
     RETURNING id, user_id`,
    [tokenHash, purpose],
  );
  return rows[0]?.user_id ?? null;
}

export async function sendAuthMail(options: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  await transport.sendMail({
    from: env.mailFrom,
    to: options.to,
    subject: options.subject,
    text: options.text,
  });
}
