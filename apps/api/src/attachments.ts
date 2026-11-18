import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { loadMembership } from "./access";
import { HttpError } from "./http";

type Db = Pick<PoolClient, "query">;

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const BLOCKED = /\.(exe|bat|cmd|com|msi|dll|scr|ps1|vbs|hta|html?|svg|xhtml|js|mjs)$/i;

export function safeFileName(raw: string): string | null {
  const normalized = raw.replace(/\\/g, "/");
  const base = path.basename(normalized).replace(/[\u0000-\u001f]/g, "").trim();
  if (!base || base === "." || base === "..") return null;
  if (base.length > 180) return null;
  if (BLOCKED.test(base)) return null;
  return base;
}

export function parseMultipartFile(
  body: Buffer,
  contentType: string,
): { filename: string; mime: string; bytes: Buffer } | null {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const token = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!token) return null;
  const boundary = Buffer.from(`--${token.trim()}`);
  let cursor = 0;
  while (cursor < body.length) {
    const found = body.indexOf(boundary, cursor);
    if (found < 0) return null;
    let start = found + boundary.length;
    if (body.subarray(start, start + 2).toString() === "--") return null;
    if (body.subarray(start, start + 2).toString() === "\r\n") start += 2;
    const next = body.indexOf(boundary, start);
    if (next < 0) return null;
    let part = body.subarray(start, next);
    if (part.subarray(-2).toString() === "\r\n") part = part.subarray(0, -2);
    const separator = part.indexOf("\r\n\r\n");
    if (separator >= 0) {
      const header = part.subarray(0, separator).toString("utf8");
      const filename = filenameFrom(header);
      if (filename) {
        const mime = /content-type:\s*([^\r\n]+)/i.exec(header)?.[1]?.trim() || "application/octet-stream";
        return { filename, mime, bytes: part.subarray(separator + 4) };
      }
    }
    cursor = next;
  }
  return null;
}

function filenameFrom(header: string): string | null {
  const encoded = /filename\*=UTF-8''([^;\r\n]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return null;
    }
  }
  const quoted = /filename="([^"]*)"/i.exec(header);
  if (quoted) return quoted[1];
  const plain = /filename=([^;\r\n]+)/i.exec(header);
  return plain ? plain[1].trim() : null;
}

export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function storagePath(dir: string, key: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(key)) throw new HttpError(404, "Файл не найден");
  const root = path.resolve(dir);
  const full = path.resolve(root, key);
  if (full !== path.join(root, key)) throw new HttpError(404, "Файл не найден");
  return full;
}

export async function storeAttachment(
  client: Db,
  dir: string,
  issueId: string,
  userId: string,
  file: { name: string; mime: string; bytes: Buffer },
): Promise<{ id: string; storageKey: string }> {
  const name = safeFileName(file.name);
  if (!name) throw new HttpError(400, "Такой файл приложить нельзя");
  if (file.bytes.length === 0) throw new HttpError(400, "Пустой файл");
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) throw new HttpError(400, "Файл больше 10 МБ");
  const issue = await client.query<{ project_id: string }>(
    "SELECT project_id FROM issues WHERE id = $1 FOR UPDATE",
    [issueId],
  );
  const projectId = issue.rows[0]?.project_id;
  if (!projectId) throw new HttpError(404, "Задача не найдена");
  await loadMembership(client, projectId, userId, true);
  const id = crypto.randomUUID();
  const storageKey = crypto.randomUUID();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(storagePath(dir, storageKey), file.bytes, { flag: "wx" });
  try {
    await client.query(
      `INSERT INTO attachments (id, issue_id, author_id, name, mime, size_bytes, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, issueId, userId, name, file.mime.slice(0, 120) || "application/octet-stream", file.bytes.length, storageKey],
    );
    await client.query(
      `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
       VALUES ($1, $2, $3, 'attachment_added', $4::jsonb)`,
      [crypto.randomUUID(), issueId, userId, JSON.stringify({ name })],
    );
  } catch (error) {
    await fs.unlink(storagePath(dir, storageKey)).catch(() => undefined);
    throw error;
  }
  return { id, storageKey };
}

export async function removeAttachment(client: Db, issueId: string, userId: string, attachmentId: string): Promise<string> {
  const issue = await client.query<{ project_id: string }>(
    "SELECT project_id FROM issues WHERE id = $1 FOR UPDATE",
    [issueId],
  );
  const projectId = issue.rows[0]?.project_id;
  if (!projectId) throw new HttpError(404, "Задача не найдена");
  const membership = await loadMembership(client, projectId, userId, true);
  const found = await client.query<{ storage_key: string; author_id: string; name: string }>(
    `SELECT storage_key, author_id, name FROM attachments
     WHERE id = $1 AND issue_id = $2 FOR UPDATE`,
    [attachmentId, issueId],
  );
  const row = found.rows[0];
  if (!row) throw new HttpError(404, "Файл не найден");
  if (membership.role !== "owner" && row.author_id !== userId) {
    throw new HttpError(403, "Файл может удалить автор или владелец проекта");
  }
  await client.query("DELETE FROM attachments WHERE id = $1", [attachmentId]);
  await client.query(
    `INSERT INTO activities (id, issue_id, actor_id, kind, payload)
     VALUES ($1, $2, $3, 'attachment_removed', $4::jsonb)`,
    [crypto.randomUUID(), issueId, userId, JSON.stringify({ name: row.name })],
  );
  return row.storage_key;
}

export async function unlinkStored(dir: string, key: string): Promise<void> {
  await fs.unlink(storagePath(dir, key)).catch(() => undefined);
}
