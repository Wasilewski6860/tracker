export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "code"; text: string };

const SAFE_PROTOCOL = new Set(["http:", "https:"]);

export function safeHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u0020<>]/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (!SAFE_PROTOCOL.has(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parseInline(input: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  let index = 0;

  function flush(): void {
    if (!text) return;
    out.push({ type: "text", text });
    text = "";
  }

  while (index < input.length) {
    if (input[index] === "\\" && index + 1 < input.length) {
      text += input[index + 1];
      index += 2;
      continue;
    }
    if (input.startsWith("**", index)) {
      const end = input.indexOf("**", index + 2);
      if (end !== -1) {
        flush();
        out.push({ type: "strong", children: parseInline(input.slice(index + 2, end)) });
        index = end + 2;
        continue;
      }
    }
    if (input[index] === "*" && input[index + 1] !== "*") {
      const end = input.indexOf("*", index + 1);
      if (end > index + 1) {
        flush();
        out.push({ type: "em", children: parseInline(input.slice(index + 1, end)) });
        index = end + 1;
        continue;
      }
    }
    if (input[index] === "`") {
      const end = input.indexOf("`", index + 1);
      if (end !== -1) {
        flush();
        out.push({ type: "code", text: input.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    if (input[index] === "[") {
      const labelEnd = input.indexOf("]", index + 1);
      if (labelEnd !== -1 && input[labelEnd + 1] === "(") {
        const hrefEnd = input.indexOf(")", labelEnd + 2);
        if (hrefEnd !== -1) {
          const href = safeHref(input.slice(labelEnd + 2, hrefEnd));
          if (href) {
            flush();
            out.push({
              type: "link",
              href,
              children: parseInline(input.slice(index + 1, labelEnd)),
            });
            index = hrefEnd + 1;
            continue;
          }
        }
      }
    }
    if (input.startsWith("http://", index) || input.startsWith("https://", index)) {
      const rest = input.slice(index);
      const found = /^https?:\/\/[^\s<>]+/.exec(rest);
      if (found) {
        let raw = found[0];
        let extra = "";
        const trail = /[.,;:!?)]+$/.exec(raw);
        if (trail) {
          raw = raw.slice(0, -trail[0].length);
          extra = trail[0];
        }
        const href = safeHref(raw);
        if (href) {
          flush();
          out.push({ type: "link", href, children: [{ type: "text", text: raw }] });
          text += extra;
          index += raw.length + extra.length;
          continue;
        }
      }
    }
    text += input[index];
    index += 1;
  }
  flush();
  return out;
}

function isFence(line: string): boolean {
  return line.startsWith("```");
}

function heading(line: string): { level: 1 | 2 | 3; text: string } | null {
  const match = /^(#{1,3}) (.+)$/.exec(line);
  if (!match) return null;
  return { level: match[1].length as 1 | 2 | 3, text: match[2] };
}

function listItem(line: string, ordered: boolean): string | null {
  const match = ordered ? /^\d+\. (.*)$/.exec(line) : /^[-*] (.*)$/.exec(line);
  return match ? match[1] : null;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (isFence(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !isFence(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const title = heading(line);
    if (title) {
      blocks.push({ type: "heading", level: title.level, children: parseInline(title.text) });
      index += 1;
      continue;
    }
    const ordered = /^\d+\. /.test(line);
    if (ordered || /^[-*] /.test(line)) {
      const items: Inline[][] = [];
      while (index < lines.length) {
        const item = listItem(lines[index], ordered);
        if (item === null) break;
        items.push(parseInline(item));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !isFence(lines[index]) &&
      !heading(lines[index]) &&
      !/^[-*] /.test(lines[index]) &&
      !/^\d+\. /.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "paragraph", lines: paragraph.map(parseInline) });
  }
  return blocks;
}
