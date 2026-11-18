export type Role = "owner" | "member" | "viewer";
export type IssueType = "epic" | "story" | "task" | "bug" | "subtask";
export type Priority = "low" | "medium" | "high" | "urgent";
export type Category = "backlog" | "todo" | "in_progress" | "review" | "done";

export type User = { id: string; email: string; name: string };

export type ProjectSummary = {
  id: string;
  key: string;
  name: string;
  description: string;
  role: Role;
  issueCount: number;
};

export type Member = { id: string; name: string; email?: string; role: Role };

export type Status = {
  id: string;
  name: string;
  category: Category;
  position: number;
  issueCount?: number;
};

export type Label = { id: string; name: string; color: string };

export type Issue = {
  id: string;
  number: number;
  key: string;
  title: string;
  description: string;
  type: IssueType;
  priority: Priority;
  statusId: string;
  dueOn: string | null;
  parentKey: string | null;
  createdAt: string;
  updatedAt: string;
  reporter: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  labels: Label[];
};

export type Board = {
  project: {
    id: string;
    key: string;
    name: string;
    description: string;
    role: Role;
  };
  members: Member[];
  statuses: Status[];
  transitions: { id: string; fromStatusId: string; toStatusId: string }[];
  issues: Issue[];
  labels: Label[];
};

export type LinkType = "relates" | "blocks" | "duplicates";

export type IssueDetails = {
  issue: Omit<Issue, "parentKey" | "labels"> & {
    projectId: string;
    role: Role;
    parent: { id: string; key: string } | null;
  };
  comments: {
    id: string;
    body: string;
    createdAt: string;
    editedAt: string | null;
    author: { id: string; name: string };
    canEdit: boolean;
    canDelete: boolean;
  }[];
  activities: { id: string; text: string; createdAt: string }[];
  transitions: { toStatusId: string; name: string }[];
  statuses: { id: string; name: string; category: string }[];
  members: { id: string; name: string; role: Role }[];
  children: { id: string; key: string; title: string; type: IssueType }[];
  candidates: { id: string; key: string; title: string; type: IssueType }[];
  links: {
    id: string;
    type: LinkType;
    outward: boolean;
    issue: { id: string; key: string; title: string; type: IssueType };
  }[];
  labels: Label[];
  projectLabels: Label[];
  attachments: {
    id: string;
    name: string;
    sizeBytes: number;
    createdAt: string;
    author: { id: string; name: string };
    canDelete: boolean;
  }[];
  canDelete: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code?: string,
  ) {
    super(message);
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      credentials: "include",
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError("Нет соединения с сервером", 0, "network");
  }
  const text = await res.text();
  let data: { error?: string; code?: string } = {};
  if (text) {
    try {
      data = JSON.parse(text) as { error?: string; code?: string };
    } catch {
      throw new ApiError("Сервер вернул непонятный ответ", res.status || 500, "bad_response");
    }
  }
  if (!res.ok) {
    const quiet = [
      "/api/auth/login",
      "/api/auth/me",
      "/api/auth/register",
      "/api/auth/forgot",
      "/api/auth/reset",
      "/api/auth/verify-email",
      "/api/auth/resend",
    ];
    if (res.status === 401 && !quiet.includes(path)) {
      window.location.assign("/login");
    }
    const fallback = res.status >= 500 ? "Сервер временно недоступен" : "Запрос не выполнен";
    throw new ApiError(data.error || fallback, res.status, data.code);
  }
  return data as T;
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "include" });
  } catch {
    throw new ApiError("Нет соединения с сервером", 0, "network");
  }
  if (!res.ok) {
    if (res.status === 401) window.location.assign("/login");
    throw new ApiError(res.status >= 500 ? "Сервер временно недоступен" : "Файл не скачан", res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
