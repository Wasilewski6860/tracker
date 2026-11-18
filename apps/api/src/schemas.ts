import { z } from "zod";
import { HttpError } from "./http";

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Проверьте поля формы";
    throw new HttpError(400, message);
  }
  return result.data;
}

const projectKey = z
  .string()
  .trim()
  .min(2, "Ключ проекта: от 2 до 10 символов")
  .max(10, "Ключ проекта: от 2 до 10 символов")
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z][A-Z0-9]{1,9}$/.test(value), {
    message: "Ключ: 2–10 латинских букв и цифр, начинается с буквы",
  });

export const registerSchema = z.object({
  email: z.string().trim().email("Нужна корректная почта").max(200),
  name: z.string().trim().min(1, "Нужно имя").max(80),
  password: z.string().min(8, "Пароль должен быть не короче 8 символов").max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().email("Нужна корректная почта"),
  password: z.string().min(1, "Нужен пароль"),
});

export const emailSchema = z.object({
  email: z.string().trim().email("Нужна корректная почта"),
});

export const tokenSchema = z.object({
  token: z.string().trim().min(20, "Ссылка недействительна"),
});

export const resetSchema = z.object({
  token: z.string().trim().min(20, "Ссылка недействительна"),
  password: z.string().min(8, "Пароль должен быть не короче 8 символов").max(200),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Нужно название проекта").max(120),
  key: projectKey,
  description: z.string().max(4000).optional().default(""),
});

export const memberSchema = z.object({
  email: z.string().trim().email("Нужна корректная почта"),
  role: z.enum(["member", "viewer"]),
});

export const issueTypes = ["epic", "story", "task", "bug", "subtask"] as const;

const dayField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД")
  .nullable();

export const createIssueSchema = z
  .object({
    title: z.string().trim().min(1, "Нужно название задачи").max(200),
    description: z.string().max(20000).optional().default(""),
    type: z.enum(issueTypes).optional().default("task"),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional().default("medium"),
    assigneeId: z.string().uuid().nullable().optional(),
    dueOn: dayField.optional(),
    parentId: z.string().uuid().nullable().optional(),
  })
  .refine((value) => value.type !== "subtask" || Boolean(value.parentId), {
    message: "У подзадачи должен быть родитель",
  });

export const updateIssueSchema = z
  .object({
    title: z.string().trim().min(1, "Нужно название задачи").max(200).optional(),
    description: z.string().max(20000).optional(),
    type: z.enum(issueTypes).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    dueOn: dayField.optional(),
    parentId: z.string().uuid().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Нет полей для сохранения",
  });

export const transitionSchema = z.object({
  toStatusId: z.string().uuid("Не выбран статус"),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1, "Пустой комментарий").max(5000),
});

export const labelSchema = z.object({
  name: z.string().trim().min(1, "Нужно название метки").max(40),
});

export const linkTypes = ["relates", "blocks", "duplicates"] as const;

export const linkSchema = z.object({
  targetId: z.string().uuid("Не выбрана задача"),
  type: z.enum(linkTypes),
});

export const statusCategories = ["backlog", "todo", "in_progress", "review", "done"] as const;

export const createStatusSchema = z.object({
  name: z.string().trim().min(1, "Нужно название статуса").max(40),
  category: z.enum(statusCategories),
});

export const updateStatusSchema = z
  .object({
    name: z.string().trim().min(1, "Нужно название статуса").max(40).optional(),
    category: z.enum(statusCategories).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Нет полей для сохранения" });

export const shiftStatusSchema = z.object({
  direction: z.enum(["left", "right"]),
});

export const deleteStatusSchema = z.object({
  moveToStatusId: z.string().uuid().optional(),
});

export const createTransitionSchema = z.object({
  fromStatusId: z.string().uuid("Не выбран статус"),
  toStatusId: z.string().uuid("Не выбран статус"),
});
