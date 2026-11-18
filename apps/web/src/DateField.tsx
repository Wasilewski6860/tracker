import { useEffect, useRef, useState } from "react";
import { formatIso, isoToDate, monthName, parseRuDate, toIso, weekdayShort } from "./labels";

export function DateField({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [text, setText] = useState(formatIso(value));
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => isoToDate(value) ?? new Date());
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ top: 0, left: 0 });

  useEffect(() => {
    setText(formatIso(value));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 288;
      const height = 320;
      const below = window.innerHeight - rect.bottom;
      const top = below < height && rect.top > below ? Math.max(8, rect.top - height - 4) : rect.bottom + 4;
      setBox({ top, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) });
    }
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  function commit(next: string) {
    onChange(next);
    setText(formatIso(next));
    if (next) setCursor(isoToDate(next) ?? new Date());
    setOpen(false);
  }

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => new Date(year, month, index - lead + 1));
  const selected = isoToDate(value);
  const today = new Date();

  return (
    <div className="date-field" ref={rootRef}>
      <input
        value={text}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="off"
        placeholder="дд.мм.гггг"
        aria-label={ariaLabel}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (!next.trim()) onChange("");
          const parsed = parseRuDate(next);
          if (parsed) onChange(parsed);
        }}
        onBlur={() => {
          if (!text.trim()) {
            onChange("");
            setText("");
            return;
          }
          const parsed = parseRuDate(text);
          if (parsed) {
            onChange(parsed);
            setText(formatIso(parsed));
            setCursor(isoToDate(parsed) ?? cursor);
            return;
          }
          setText(formatIso(value));
        }}
      />
      <button
        type="button"
        className="date-open"
        aria-label="Открыть календарь"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setCursor(isoToDate(value) ?? new Date());
          setOpen((current) => !current);
        }}
      >
        <CalendarIcon />
      </button>
      {open && (
        <div ref={popRef} className="calendar" role="dialog" aria-label="Календарь" style={{ top: box.top, left: box.left }}>
          <div className="calendar-head">
            <button type="button" className="calendar-nav" aria-label="Предыдущий месяц" onClick={() => setCursor(new Date(year, month - 1, 1))}>
              ‹
            </button>
            <strong>
              {monthName[month]} {year}
            </strong>
            <button type="button" className="calendar-nav" aria-label="Следующий месяц" onClick={() => setCursor(new Date(year, month + 1, 1))}>
              ›
            </button>
          </div>
          <div className="calendar-week">
            {weekdayShort.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {days.map((day) => {
              const outside = day.getMonth() !== month;
              const iso = toIso(day);
              const isSelected = selected ? toIso(selected) === iso : false;
              const isToday = toIso(today) === iso;
              const weekend = day.getDay() === 0 || day.getDay() === 6;
              return (
                <button
                  key={iso}
                  type="button"
                  className={`calendar-day ${outside ? "outside" : ""} ${weekend ? "weekend" : ""} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
                  onClick={() => commit(iso)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          <div className="calendar-foot">
            <button type="button" onClick={() => commit("")}>
              Очистить
            </button>
            <button type="button" onClick={() => commit(toIso(today))}>
              Сегодня
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 6.5h12M5 2v3M11 2v3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
