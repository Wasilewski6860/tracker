import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, type Member, type Role } from "./api";
import { roleLabel } from "./labels";

const avatarPalette = ["#1d7afc", "#22a06b", "#bf63c7", "#e56910", "#c9372c", "#8270db", "#206a83", "#206b74"];

export function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return avatarPalette[hash % avatarPalette.length];
}

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size <= 20 ? 11 : 12, background: avatarColor(name) }}
      aria-hidden
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export type MenuOption = {
  value: string;
  label: string;
  hint?: string;
  avatarName?: string;
  disabled?: boolean;
};

export function MenuSelect({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  searchable = false,
  compact = false,
  placeholder = "Выберите",
}: {
  value: string;
  options: MenuOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  searchable?: boolean;
  compact?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const shownRef = useRef<MenuOption[]>([]);
  const activeRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [box, setBox] = useState({ top: 0, left: 0, width: 220, maxHeight: 280 });
  const listId = useId();
  const selected = options.find((item) => item.value === value);
  const shown = options.filter((item) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${item.label} ${item.hint ?? ""}`.toLowerCase().includes(needle);
  });
  shownRef.current = shown;
  activeRef.current = active;

  function place() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, searchable ? 260 : 200);
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const openUp = below < 180 && above > below;
    const maxHeight = Math.max(140, Math.min(320, openUp ? above : below));
    setBox({
      top: openUp ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      width,
      maxHeight,
    });
  }

  useEffect(() => {
    if (!open) return;
    place();
    searchRef.current?.focus();
    const onScroll = () => place();
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    };
    const onKey = (event: KeyboardEvent) => {
      const list = shownRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setQuery("");
        triggerRef.current?.focus();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((index) => Math.min(Math.max(list.length - 1, 0), index + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = list[activeRef.current];
        if (item && !item.disabled) {
          onChangeRef.current(item.value);
          setOpen(false);
          setQuery("");
          triggerRef.current?.focus();
        }
      }
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  return (
    <div className={`menu-select ${compact ? "compact" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="field-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        disabled={disabled}
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
        }}
      >
        <span className={`field-value ${selected ? "" : "placeholder"}`}>
          {selected?.avatarName && <Avatar name={selected.avatarName} size={20} />}
          <span>{selected?.label ?? placeholder}</span>
        </span>
        <Chevron />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={listId}
          className="field-menu"
          role="listbox"
          style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight }}
        >
          {searchable && (
            <div className="menu-search-wrap">
              <input
                ref={searchRef}
                className="menu-search"
                placeholder="Поиск"
                value={query}
                aria-label={`${ariaLabel}: поиск`}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          )}
          <div className="menu-options">
            {shown.length === 0 && <p className="menu-empty">Ничего не найдено</p>}
            {shown.map((item, index) => (
              <button
                key={`${item.value}-${item.label}`}
                type="button"
                role="option"
                aria-selected={item.value === value}
                disabled={item.disabled}
                className={`field-option ${item.value === value ? "selected" : ""} ${index === active ? "active" : ""}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(item.value)}
              >
                {item.avatarName && <Avatar name={item.avatarName} size={24} />}
                <span className="option-text">
                  <span>{item.label}</span>
                  {item.hint && <span className="option-hint">{item.hint}</span>}
                </span>
                {item.value === value && <Check />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function UserPicker({
  value,
  people,
  onChange,
  disabled,
  ariaLabel,
  meId,
}: {
  value: string;
  people: { id: string; name: string }[];
  onChange: (id: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  meId?: string;
}) {
  const me = people.find((person) => person.id === meId);
  return (
    <div className="user-picker">
      <MenuSelect
        searchable
        ariaLabel={ariaLabel}
        value={value}
        disabled={disabled}
        placeholder="Не назначен"
        onChange={onChange}
        options={[
          { value: "", label: "Не назначен" },
          ...people.map((person) => ({
            value: person.id,
            label: person.id === meId ? `${person.name} (я)` : person.name,
            avatarName: person.name,
          })),
        ]}
      />
      {me && !disabled && value !== me.id && (
        <button type="button" className="assign-me" onClick={() => onChange(me.id)}>
          Назначить мне
        </button>
      )}
    </div>
  );
}

type DirectoryUser = { id: string; name: string; email: string };

export function PeopleDialog({
  projectName,
  members,
  isOwner,
  onClose,
  onAdd,
  onRole,
  onRemove,
}: {
  projectName: string;
  members: Member[];
  isOwner: boolean;
  onClose: () => void;
  onAdd: (emails: string[], role: Exclude<Role, "owner">) => Promise<void>;
  onRole: (email: string, role: Exclude<Role, "owner">) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DirectoryUser[]>([]);
  const [picked, setPicked] = useState<DirectoryUser[]>([]);
  const [role, setRole] = useState<Exclude<Role, "owner">>("member");
  const [openHits, setOpenHits] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const memberIds = new Set(members.map((member) => member.id));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 1) {
      setHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api<DirectoryUser[]>(`/api/users?q=${encodeURIComponent(needle)}`)
        .then((rows) => {
          setHits(rows);
          setOpenHits(true);
        })
        .catch(() => setHits([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  function addChip(person: DirectoryUser) {
    if (memberIds.has(person.id) || picked.some((item) => item.id === person.id)) return;
    setPicked((current) => [...current, person]);
    setQuery("");
    setHits([]);
    setOpenHits(false);
  }

  async function submit() {
    if (picked.length === 0) return;
    setBusy(true);
    setError("");
    try {
      await onAdd(
        picked.map((person) => person.email),
        role,
      );
      setPicked([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить людей");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-blanket" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="people-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="people-title">Добавить людей</h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="modal-body">
          <p className="modal-lead">Проект «{projectName}». Человека можно добавить, если он уже зарегистрирован.</p>
          {isOwner && (
            <div className="people-add">
              <div className="people-combo">
                <div className="combo-box">
                  {picked.map((person) => (
                    <span key={person.id} className="person-chip">
                      <Avatar name={person.name} size={20} />
                      <span>{person.name}</span>
                      <button
                        type="button"
                        aria-label={`Убрать ${person.name}`}
                        onClick={() => setPicked((current) => current.filter((item) => item.id !== person.id))}
                      >
                        <CloseIcon />
                      </button>
                    </span>
                  ))}
                  <input
                    value={query}
                    placeholder={picked.length ? "" : "Имена или почта"}
                    aria-label="Имена или почта"
                    onChange={(event) => setQuery(event.target.value)}
                    onFocus={() => {
                      if (query.trim()) setOpenHits(true);
                    }}
                    onBlur={() => setOpenHits(false)}
                    onKeyDown={(event) => {
                      if (event.key === "Backspace" && query === "") {
                        setPicked((current) => current.slice(0, -1));
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const first = hits.find((person) => !memberIds.has(person.id) && !picked.some((item) => item.id === person.id));
                        if (first) addChip(first);
                      }
                    }}
                  />
                </div>
                {openHits && query.trim() && (
                  <div className="combo-menu" role="listbox">
                    {hits.length === 0 && <p className="menu-empty">Никого не найдено</p>}
                    {hits.map((person) => {
                      const taken = memberIds.has(person.id) || picked.some((item) => item.id === person.id);
                      return (
                        <button
                          key={person.id}
                          type="button"
                          className="field-option"
                          disabled={taken}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => addChip(person)}
                        >
                          <Avatar name={person.name} />
                          <span className="option-text">
                            <span>{person.name}</span>
                            <span className="option-hint">{taken ? "Уже в проекте" : person.email}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <MenuSelect
                ariaLabel="Роль новых людей"
                value={role}
                onChange={(next) => setRole(next as Exclude<Role, "owner">)}
                options={[
                  { value: "member", label: "Участник", hint: "Создаёт и меняет задачи" },
                  { value: "viewer", label: "Наблюдатель", hint: "Только смотрит доску" },
                ]}
              />
              <button type="button" className="btn primary" disabled={busy || picked.length === 0} onClick={() => void submit()}>
                Добавить
              </button>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <h3>У кого есть доступ</h3>
          <ul className="access-list">
            {members.map((member) => (
              <li key={member.id}>
                <Avatar name={member.name} size={32} />
                <span className="access-id">
                  <strong>{member.name}</strong>
                  {member.email && <span>{member.email}</span>}
                </span>
                {isOwner && member.role !== "owner" && member.email ? (
                  <span className="access-actions">
                    <MenuSelect
                      compact
                      ariaLabel={`Роль ${member.name}`}
                      value={member.role}
                      onChange={(next) => {
                        void onRole(member.email!, next as Exclude<Role, "owner">).catch((err: unknown) => {
                          setError(err instanceof Error ? err.message : "Не удалось сменить роль");
                        });
                      }}
                      options={[
                        { value: "member", label: "Участник" },
                        { value: "viewer", label: "Наблюдатель" },
                      ]}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Исключить ${member.name}`}
                      onClick={() => {
                        void onRemove(member.id).catch((err: unknown) => {
                          setError(err instanceof Error ? err.message : "Не удалось исключить");
                        });
                      }}
                    >
                      <CloseIcon />
                    </button>
                  </span>
                ) : (
                  <span className="role-lock">{roleLabel[member.role]}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function PeopleButton({ members, isOwner, onClick }: { members: Member[]; isOwner: boolean; onClick: () => void }) {
  const shown = members.slice(0, 3);
  const extra = members.length - shown.length;
  return (
    <button type="button" className="people-trigger" onClick={onClick}>
      <span className="avatar-stack">
        {shown.map((member) => (
          <Avatar key={member.id} name={member.name} size={28} />
        ))}
        {extra > 0 && <span className="avatar more">+{extra}</span>}
      </span>
      <span>{isOwner ? "Добавить людей" : "Люди"}</span>
    </button>
  );
}

function Chevron() {
  return (
    <svg className="chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function Check() {
  return (
    <svg className="option-check" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
