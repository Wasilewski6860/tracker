import { useState } from "react";
import type { Label } from "./api";

export function LabelField({
  labels,
  catalog,
  disabled,
  onAdd,
  onRemove,
}: {
  labels: Label[];
  catalog: Label[];
  disabled: boolean;
  onAdd: (name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const needle = text.trim().toLowerCase();
  const taken = new Set(labels.map((label) => label.name.toLowerCase()));
  const hits = catalog
    .filter((label) => !taken.has(label.name.toLowerCase()) && label.name.toLowerCase().includes(needle))
    .slice(0, 8);
  const canCreate = needle.length > 0 && !catalog.some((label) => label.name.toLowerCase() === needle) && !taken.has(needle);

  async function add(name: string) {
    const next = name.trim();
    if (!next) return;
    await onAdd(next);
    setText("");
    setOpen(false);
  }

  return (
    <div className="label-field">
      {labels.length > 0 && (
        <div className="label-row">
          {labels.map((label) => (
            <span key={label.id} className="label-chip" style={{ background: label.color }}>
              {label.name}
              {!disabled && (
                <button type="button" aria-label={`Убрать метку ${label.name}`} onClick={() => void onRemove(label.id)}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <input
          value={text}
          placeholder="Добавить метку"
          aria-label="Добавить метку"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void add(text);
            }
            if (event.key === "Escape") setOpen(false);
          }}
        />
      )}
      {open && !disabled && (hits.length > 0 || canCreate) && (
        <div className="label-menu">
          {hits.map((label) => (
            <button key={label.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void add(label.name)}>
              {label.name}
            </button>
          ))}
          {canCreate && (
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void add(text)}>
              Создать «{text.trim()}»
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function LabelChips({ labels }: { labels: Label[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="label-row">
      {labels.map((label) => (
        <span key={label.id} className="label-chip" style={{ background: label.color }}>
          {label.name}
        </span>
      ))}
    </div>
  );
}
