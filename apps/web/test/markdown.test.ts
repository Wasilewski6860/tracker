import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, safeHref, type Inline } from "../src/markdown";

function textOf(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "code") return node.text;
      if (node.type === "link") return textOf(node.children);
      return textOf(node.children);
    })
    .join("");
}

test("обычный текст и перенос строки сохраняются", () => {
  const blocks = parseMarkdown("первая\nвторая");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "paragraph");
  if (blocks[0].type !== "paragraph") return;
  assert.equal(blocks[0].lines.length, 2);
  assert.equal(textOf(blocks[0].lines[0]), "первая");
  assert.equal(textOf(blocks[0].lines[1]), "вторая");
});

test("жирный, курсив, код и список разбираются", () => {
  const blocks = parseMarkdown("**жирный** и *курсив*\n\n- один\n- `два`");
  assert.equal(blocks[0].type, "paragraph");
  if (blocks[0].type === "paragraph") {
    assert.equal(blocks[0].lines[0][0].type, "strong");
    assert.equal(blocks[0].lines[0][2].type, "em");
  }
  assert.equal(blocks[1].type, "list");
  if (blocks[1].type === "list") {
    assert.equal(blocks[1].ordered, false);
    assert.equal(textOf(blocks[1].items[1]), "два");
    assert.equal(blocks[1].items[1][0].type, "code");
  }
});

test("код в кавычках не исполняет разметку", () => {
  const blocks = parseMarkdown("```\n**нет** <script>\n```");
  assert.deepEqual(blocks, [{ type: "code", text: "**нет** <script>" }]);
});

test("html остаётся текстом, а опасная ссылка не становится ссылкой", () => {
  const blocks = parseMarkdown('<img src=x onerror=alert(1)> [нажми](javascript:alert(1))');
  assert.equal(blocks[0].type, "paragraph");
  if (blocks[0].type !== "paragraph") return;
  const line = blocks[0].lines[0];
  assert.equal(line.some((node) => node.type === "link"), false);
  assert.match(textOf(line), /<img/);
  assert.match(textOf(line), /javascript:alert/);
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,hi"), null);
  assert.equal(safeHref("https://tracker.example/a b"), null);
});

test("обычная ссылка остаётся https", () => {
  const blocks = parseMarkdown("смотри [сайт](https://example.com/path) и https://example.com.");
  assert.equal(blocks[0].type, "paragraph");
  if (blocks[0].type !== "paragraph") return;
  const links = blocks[0].lines[0].filter((node) => node.type === "link");
  assert.equal(links.length, 2);
  assert.equal(links[0].type === "link" && links[0].href, "https://example.com/path");
  assert.equal(links[1].type === "link" && links[1].href, "https://example.com/");
});
