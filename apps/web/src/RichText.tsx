import { Fragment } from "react";
import { parseMarkdown, type Inline } from "./markdown";

function renderInline(node: Inline, key: string) {
  if (node.type === "text") return <Fragment key={key}>{node.text}</Fragment>;
  if (node.type === "strong") {
    return <strong key={key}>{node.children.map((child, index) => renderInline(child, `${key}-${index}`))}</strong>;
  }
  if (node.type === "em") {
    return <em key={key}>{node.children.map((child, index) => renderInline(child, `${key}-${index}`))}</em>;
  }
  if (node.type === "code") return <code key={key}>{node.text}</code>;
  return (
    <a key={key} href={node.href} target="_blank" rel="noopener noreferrer">
      {node.children.map((child, index) => renderInline(child, `${key}-${index}`))}
    </a>
  );
}

export function RichText({ text }: { text: string }) {
  return (
    <div className="rich">
      {parseMarkdown(text).map((block, index) => {
        const key = String(index);
        if (block.type === "code") {
          return (
            <pre key={key}>
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === "heading") {
          const Tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
          return <Tag key={key}>{block.children.map((child, childIndex) => renderInline(child, `${key}-${childIndex}`))}</Tag>;
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item.map((child, childIndex) => renderInline(child, `${key}-${itemIndex}-${childIndex}`))}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={key}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {line.map((child, childIndex) => renderInline(child, `${key}-${lineIndex}-${childIndex}`))}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
