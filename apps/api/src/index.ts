import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { readUser } from "./auth";
import { migrate, pool } from "./db";
import { env } from "./env";
import { HttpError } from "./http";
import { MAX_ATTACHMENT_BYTES } from "./attachments";
import { authRoutes } from "./routes/auth";
import { issueRoutes } from "./routes/issues";
import { projectRoutes } from "./routes/projects";

async function main(): Promise<void> {
  await migrate();

  const app = Fastify({ logger: true });
  await app.register(cors, {
    origin: env.clientOrigin.split(",").map((item) => item.trim()),
    credentials: true,
  });
  await app.register(cookie);
  app.addContentTypeParser(
    /^multipart\/form-data/i,
    { parseAs: "buffer", bodyLimit: MAX_ATTACHMENT_BYTES + 64 * 1024 },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.addHook("onRequest", async (request) => {
    request.user = await readUser(request);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.code(error.status).send({ error: error.message, code: error.code });
      return;
    }
    if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 413) {
      reply.code(400).send({ error: "Файл больше 10 МБ" });
      return;
    }
    app.log.error(error);
    reply.code(500).send({ error: "Внутренняя ошибка сервера" });
  });

  app.get("/api/health", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { ok: true };
    } catch {
      reply.code(503);
      return { ok: false };
    }
  });
  await app.register(authRoutes, { prefix: "/api" });
  await app.register(projectRoutes, { prefix: "/api" });
  await app.register(issueRoutes, { prefix: "/api" });

  const close = async () => {
    await app.close();
    await pool.end();
  };
  process.on("SIGINT", () => {
    void close().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void close().then(() => process.exit(0));
  });

  await app.listen({ port: env.port, host: "0.0.0.0" });
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
