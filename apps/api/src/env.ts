import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../../../.env"),
];

for (const file of envCandidates) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file });
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name}`);
  }
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  port: Number(process.env.PORT ?? 3000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  cookieSecure: process.env.COOKIE_SECURE === "true",
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
  smtpHost: required("SMTP_HOST"),
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPassword: process.env.SMTP_PASSWORD ?? "",
  mailFrom: process.env.MAIL_FROM ?? "Трекер <tracker@localhost>",
  production: process.env.NODE_ENV === "production",
  attachmentDir: path.resolve(process.env.ATTACHMENT_DIR ?? path.resolve(__dirname, "../../../data/attachments")),
};

if (env.production) {
  const placeholder = env.jwtSecret === "change-me-before-a-real-server" || env.jwtSecret.length < 32;
  if (placeholder) {
    throw new Error("В production нужен собственный JWT_SECRET не короче 32 символов");
  }
  if (!env.cookieSecure) {
    throw new Error("В production включите COOKIE_SECURE=true и откройте сайт по HTTPS");
  }
  if (env.databaseUrl.includes("tracker:tracker@")) {
    throw new Error("В production нельзя оставлять пароль базы tracker");
  }
}
