export const DEFAULT_FLOW = [
  { key: "backlog", name: "Бэклог", category: "backlog", position: 0 },
  { key: "todo", name: "К выполнению", category: "todo", position: 1 },
  { key: "progress", name: "В работе", category: "in_progress", position: 2 },
  { key: "review", name: "На проверке", category: "review", position: 3 },
  { key: "done", name: "Готово", category: "done", position: 4 },
] as const;

export const FLOW_EDGES = [
  ["backlog", "todo"],
  ["todo", "backlog"],
  ["todo", "progress"],
  ["progress", "todo"],
  ["progress", "review"],
  ["review", "progress"],
  ["review", "done"],
  ["done", "review"],
] as const;
