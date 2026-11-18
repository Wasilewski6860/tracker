import type { IssueType, Priority, Role } from "./api";

export const typeLabel: Record<IssueType, string> = {
  epic: "Эпик",
  story: "История",
  task: "Задача",
  bug: "Ошибка",
  subtask: "Подзадача",
};

export const typeMark: Record<IssueType, string> = {
  epic: "Эп",
  story: "Ис",
  task: "Зд",
  bug: "Ош",
  subtask: "Пд",
};

export const priorityLabel: Record<Priority, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
  urgent: "Срочный",
};

export function placementError(child: IssueType, parent: IssueType | null): string | null {
  if (parent === "subtask") return "У подзадачи не бывает вложенных задач";
  if (child === "epic" && parent) return "Эпик не может быть вложен в другую задачу";
  if (child === "bug" && parent) return "Ошибка остаётся самостоятельной задачей";
  if (child === "story" && parent && parent !== "epic") return "История может быть только внутри эпика";
  if (child === "task" && parent && parent !== "epic" && parent !== "story") {
    return "Задача может быть внутри эпика или истории";
  }
  if (child === "subtask" && parent !== "task" && parent !== "bug") {
    return "Подзадача может быть только у задачи или ошибки";
  }
  return null;
}

export function linkPhrase(type: "relates" | "blocks" | "duplicates", outward: boolean): string {
  if (type === "blocks") return outward ? "блокирует" : "заблокирована";
  if (type === "duplicates") return outward ? "дублирует" : "дублируется";
  return "связана с";
}

export const roleLabel: Record<Role, string> = {
  owner: "Владелец",
  member: "Участник",
  viewer: "Наблюдатель",
};

const monthShort = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];

export const monthName = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

export const weekdayShort = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

export function isoToDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatIso(value: string): string {
  const date = isoToDate(value);
  if (!date) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

export function parseRuDate(text: string): string | null {
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (year < 1970 || year > 2100) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return toIso(date);
}

export function formatDay(value: string): string {
  const date = isoToDate(value);
  if (!date) return value;
  const text = `${date.getDate()} ${monthShort[date.getMonth()]}`;
  return date.getFullYear() === new Date().getFullYear() ? text : `${text} ${date.getFullYear()}`;
}

export function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const day = `${date.getDate()} ${monthShort[date.getMonth()]}`;
  const withYear = date.getFullYear() === new Date().getFullYear() ? day : `${day} ${date.getFullYear()}`;
  return `${withYear}, ${hours}:${minutes}`;
}
