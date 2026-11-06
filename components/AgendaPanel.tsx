"use client";

import { useEffect, useMemo, useState } from "react";

type AgendaEventType = "punctual" | "routine";

type AgendaEvent = {
  id: string;
  title: string;
  type: AgendaEventType;
  date?: string;
  weekdays?: number[];
  startTime: string;
  endTime: string;
  color: string;
  notes?: string;
  updatedAt?: string;
};

type AgendaOccurrence = {
  event: AgendaEvent;
  date: string;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
};

type Props = {
  amountsVisible?: boolean;
};

const EVENTS_KEY = "facturas_agenda_events_v1";
const DELETED_KEY = "facturas_deleted_agenda_events_v1";
const DEFAULT_COLORS = ["#f8b4b4", "#f7d794", "#b8e0b2", "#a7e6cf", "#a9d5f2", "#cbb8f3", "#e6a8e8"];
const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const SHORT_DAY_NAMES = ["L", "M", "X", "J", "V", "S", "D"];

function nowISO() {
  return new Date().toISOString();
}

function localDateISO(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function parseDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

function addDays(value: string, days: number) {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return localDateISO(date);
}

function mondayOf(value: string) {
  const date = parseDate(value);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return localDateISO(date);
}

function formatShortDate(value: string) {
  return parseDate(value).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function durationHours(start: number, end: number) {
  return Math.max(0, end - start) / 60;
}

function uid() {
  return crypto.randomUUID();
}

function timestamp(value?: string) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeById(remote: AgendaEvent[], local: AgendaEvent[]) {
  const map = new Map<string, AgendaEvent>();
  for (const item of remote) if (item?.id) map.set(item.id, item);
  for (const item of local) {
    if (!item?.id) continue;
    const existing = map.get(item.id);
    if (!existing || timestamp(item.updatedAt) > timestamp(existing.updatedAt)) map.set(item.id, item);
  }
  return [...map.values()];
}

function mergeIds(a: string[], b: string[]) {
  return [...new Set([...a, ...b])];
}

function blankEvent(weekStart: string): AgendaEvent {
  return {
    id: "",
    title: "",
    type: "punctual",
    date: weekStart,
    weekdays: [0],
    startTime: "18:00",
    endTime: "19:00",
    color: DEFAULT_COLORS[0],
    notes: ""
  };
}

function contrastText(hex: string) {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#172033";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 165 ? "#172033" : "#ffffff";
}

function occurrenceForDate(event: AgendaEvent, date: string, dayIndex: number): AgendaOccurrence | null {
  const matches = event.type === "punctual"
    ? event.date === date
    : (event.weekdays || []).includes(dayIndex);
  if (!matches) return null;
  const startMinutes = timeToMinutes(event.startTime);
  const endMinutes = Math.max(startMinutes + 30, timeToMinutes(event.endTime));
  return { event, date, dayIndex, startMinutes, endMinutes };
}

function firstFreeWindow(dayOccurrences: AgendaOccurrence[]) {
  const dayStart = 7 * 60;
  const dayEnd = 23 * 60;
  const ordered = [...dayOccurrences]
    .filter((item) => item.endMinutes > dayStart && item.startMinutes < dayEnd)
    .sort((a, b) => a.startMinutes - b.startMinutes);
  let cursor = dayStart;
  for (const item of ordered) {
    if (item.startMinutes - cursor >= 60) return [cursor, item.startMinutes] as const;
    cursor = Math.max(cursor, item.endMinutes);
  }
  if (dayEnd - cursor >= 60) return [cursor, dayEnd] as const;
  return null;
}

function minutesLabel(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export default function AgendaPanel(_: Props) {
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"local" | "saving" | "saved" | "error">("local");
  const [weekStart, setWeekStart] = useState(() => mondayOf(localDateISO()));
  const [view, setView] = useState<"compact" | "expanded">("compact");
  const [editor, setEditor] = useState<AgendaEvent>(() => blankEvent(mondayOf(localDateISO())));
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let localEvents: AgendaEvent[] = [];
      let localDeleted: string[] = [];
      try {
        localEvents = JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]");
        localDeleted = JSON.parse(localStorage.getItem(DELETED_KEY) || "[]");
      } catch {
        // La copia remota sigue pudiendo recuperar los datos.
      }

      try {
        const response = await fetch("/api/personal", { cache: "no-store" });
        const result = await response.json();
        if (response.ok && result.configured && result.data) {
          const remoteDeleted = Array.isArray(result.data.deletedAgendaEventIds)
            ? result.data.deletedAgendaEventIds.map(String)
            : [];
          const allDeleted = mergeIds(localDeleted, remoteDeleted);
          const deletedSet = new Set(allDeleted);
          const remoteEvents = Array.isArray(result.data.agendaEvents) ? result.data.agendaEvents : [];
          localEvents = mergeById(remoteEvents, localEvents).filter((item) => !deletedSet.has(item.id));
          localDeleted = allDeleted;
          setSyncStatus("saved");
        }
      } catch {
        setSyncStatus("error");
      }

      if (!cancelled) {
        setEvents(localEvents);
        setDeletedIds(localDeleted);
        setReady(true);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
    localStorage.setItem(DELETED_KEY, JSON.stringify(deletedIds));

    const timer = window.setTimeout(async () => {
      try {
        setSyncStatus("saving");
        const response = await fetch("/api/personal", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agendaEvents: events, deletedAgendaEventIds: deletedIds })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.data) return setSyncStatus("error");

        const remoteDeleted = Array.isArray(result.data.deletedAgendaEventIds)
          ? result.data.deletedAgendaEventIds.map(String)
          : [];
        const allDeleted = mergeIds(deletedIds, remoteDeleted);
        const deletedSet = new Set(allDeleted);
        const merged = mergeById(
          Array.isArray(result.data.agendaEvents) ? result.data.agendaEvents : [],
          events
        ).filter((item) => !deletedSet.has(item.id));

        if (JSON.stringify(merged) !== JSON.stringify(events)) setEvents(merged);
        if (JSON.stringify(allDeleted) !== JSON.stringify(deletedIds)) setDeletedIds(allDeleted);
        setSyncStatus("saved");
      } catch {
        setSyncStatus("error");
      }
    }, 650);

    return () => window.clearTimeout(timer);
  }, [events, deletedIds, ready]);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart]
  );

  const occurrences = useMemo(() => {
    const items: AgendaOccurrence[] = [];
    events.forEach((event) => {
      weekDates.forEach((date, dayIndex) => {
        const occurrence = occurrenceForDate(event, date, dayIndex);
        if (occurrence) items.push(occurrence);
      });
    });
    return items;
  }, [events, weekDates]);

  const punctualOccurrences = occurrences.filter((item) => item.event.type === "punctual");
  const routineOccurrences = occurrences.filter((item) => item.event.type === "routine");
  const today = localDateISO();
  const selectedSummaryDate = weekDates.includes(today) ? today : weekDates[0];
  const selectedDayOccurrences = occurrences
    .filter((item) => item.date === selectedSummaryDate)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  const weeklyHours = occurrences.reduce(
    (sum, item) => sum + durationHours(item.startMinutes, item.endMinutes),
    0
  );

  const dayLoads = weekDates.map((date) => {
    const items = occurrences.filter((item) => item.date === date);
    return {
      date,
      hours: items.reduce((sum, item) => sum + durationHours(item.startMinutes, item.endMinutes), 0),
      items
    };
  });

  const overloaded = [...dayLoads].sort((a, b) => b.hours - a.hours)[0];
  const freeWindows = dayLoads
    .map((day, index) => ({ ...day, index, free: firstFreeWindow(day.items) }))
    .filter((day) => day.free)
    .sort((a, b) => (b.free![1] - b.free![0]) - (a.free![1] - a.free![0]))
    .slice(0, 3);

  function resetEditor(type: AgendaEventType = "punctual") {
    setEditingId(null);
    setEditor({ ...blankEvent(weekStart), type, weekdays: type === "routine" ? [0, 2, 4] : [0] });
  }

  function editEvent(event: AgendaEvent) {
    setEditingId(event.id);
    setEditor({ ...event, weekdays: [...(event.weekdays || [])] });
  }

  function saveEvent(event: React.FormEvent) {
    event.preventDefault();
    const title = editor.title.trim();
    if (!title) return;
    if (timeToMinutes(editor.endTime) <= timeToMinutes(editor.startTime)) return;
    if (editor.type === "punctual" && !editor.date) return;
    if (editor.type === "routine" && !(editor.weekdays || []).length) return;

    const next: AgendaEvent = {
      ...editor,
      id: editingId || uid(),
      title,
      date: editor.type === "punctual" ? editor.date : "",
      weekdays: editor.type === "routine" ? [...(editor.weekdays || [])] : [],
      updatedAt: nowISO()
    };

    setEvents((current) => {
      const filtered = current.filter((item) => item.id !== next.id);
      return [...filtered, next];
    });
    setDeletedIds((current) => current.filter((id) => id !== next.id));
    resetEditor(editor.type);
  }

  function deleteEvent(id: string) {
    setEvents((current) => current.filter((item) => item.id !== id));
    setDeletedIds((current) => mergeIds(current, [id]));
    if (editingId === id) resetEditor();
  }

  function toggleRoutineDay(index: number) {
    setEditor((current) => {
      const days = new Set(current.weekdays || []);
      if (days.has(index)) days.delete(index);
      else days.add(index);
      return { ...current, weekdays: [...days].sort((a, b) => a - b) };
    });
  }

  if (!ready) return <section className="agenda-page"><div className="panel">Cargando agenda…</div></section>;

  return (
    <section className="agenda-page">
      <header className="page-header agenda-page-header">
        <div>
          <p className="eyebrow">Organización personal</p>
          <h1>Agenda</h1>
          <p className="muted">Eventos puntuales, rutinas y bloques de tiempo en una sola semana.</p>
        </div>
        <span className={`agenda-sync ${syncStatus}`}>
          {syncStatus === "saving" ? "Guardando…" : syncStatus === "saved" ? "Sincronizado" : syncStatus === "error" ? "Error de sincronización" : "Local"}
        </span>
      </header>

      <div className="agenda-toolbar panel">
        <button className="agenda-nav-arrow" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Semana anterior">‹</button>
        <button className="agenda-week-label" onClick={() => setWeekStart(mondayOf(localDateISO()))}>
          <span>Semana</span>
          <strong>{formatShortDate(weekStart)} – {formatShortDate(addDays(weekStart, 6))}</strong>
        </button>
        <button className="agenda-nav-arrow" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Semana siguiente">›</button>
        <div className="agenda-view-toggle">
          <button className={view === "compact" ? "active" : ""} onClick={() => setView("compact")}>☷ Vista reducida</button>
          <button className={view === "expanded" ? "active" : ""} onClick={() => setView("expanded")}>▦ Vista ampliada</button>
        </div>
      </div>

      <div className="agenda-layout">
        <div className="agenda-main">
          {view === "compact" ? (
            <div className="agenda-compact panel">
              <div className="agenda-compact-head">
                <span />
                {weekDates.map((date, index) => (
                  <div key={date} className={date === today ? "today" : ""}>
                    <strong>{DAY_NAMES[index]}</strong>
                    <small>{formatShortDate(date)}</small>
                  </div>
                ))}
              </div>

              <div className="agenda-compact-row">
                <div className="agenda-row-label"><strong>Puntuales</strong><small>{punctualOccurrences.length} esta semana</small></div>
                {weekDates.map((date, dayIndex) => (
                  <div className="agenda-day-cell" key={`p-${date}`}>
                    {punctualOccurrences.filter((item) => item.dayIndex === dayIndex).map((item) => (
                      <button
                        key={item.event.id}
                        className="agenda-chip"
                        style={{ background: item.event.color, color: contrastText(item.event.color) }}
                        onClick={() => editEvent(item.event)}
                        title={`${item.event.title} · ${item.event.startTime}–${item.event.endTime}`}
                      >
                        <strong>{item.event.title}</strong>
                        <small>{item.event.startTime}</small>
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              <div className="agenda-compact-row routines">
                <div className="agenda-row-label"><strong>Rutinas</strong><small>{routineOccurrences.length} bloques</small></div>
                {weekDates.map((date, dayIndex) => (
                  <div className="agenda-day-cell" key={`r-${date}`}>
                    {routineOccurrences.filter((item) => item.dayIndex === dayIndex).map((item) => (
                      <button
                        key={item.event.id}
                        className="agenda-chip routine"
                        style={{ background: item.event.color, color: contrastText(item.event.color) }}
                        onClick={() => editEvent(item.event)}
                      >
                        <strong>{item.event.title}</strong>
                        <small>{item.event.startTime}</small>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="agenda-expanded panel">
              <div className="agenda-time-grid">
                <div className="agenda-grid-corner" />
                {weekDates.map((date, index) => (
                  <div className={`agenda-grid-day ${date === today ? "today" : ""}`} key={date} style={{ gridColumn: index + 2, gridRow: 1 }}>
                    <strong>{DAY_NAMES[index]}</strong>
                    <small>{formatShortDate(date)}</small>
                  </div>
                ))}

                {Array.from({ length: 17 }, (_, hourIndex) => {
                  const hour = 7 + hourIndex;
                  const row = 2 + hourIndex * 2;
                  return (
                    <div className="agenda-time-label" key={hour} style={{ gridColumn: 1, gridRow: `${row} / span 2` }}>
                      {hour}:00
                    </div>
                  );
                })}

                {weekDates.flatMap((date, dayIndex) =>
                  Array.from({ length: 32 }, (_, slot) => (
                    <div
                      key={`${date}-${slot}`}
                      className={`agenda-grid-slot ${slot % 2 ? "half" : ""}`}
                      style={{ gridColumn: dayIndex + 2, gridRow: slot + 2 }}
                    />
                  ))
                )}

                {occurrences.map((item) => {
                  const clampedStart = Math.max(7 * 60, Math.min(23 * 60 - 30, item.startMinutes));
                  const clampedEnd = Math.max(clampedStart + 30, Math.min(23 * 60, item.endMinutes));
                  const rowStart = 2 + Math.floor((clampedStart - 7 * 60) / 30);
                  const rowSpan = Math.max(1, Math.ceil((clampedEnd - clampedStart) / 30));
                  return (
                    <button
                      key={`${item.event.id}-${item.date}`}
                      className={`agenda-time-block ${item.event.type}`}
                      style={{
                        gridColumn: item.dayIndex + 2,
                        gridRow: `${rowStart} / span ${rowSpan}`,
                        background: item.event.color,
                        color: contrastText(item.event.color)
                      }}
                      onClick={() => editEvent(item.event)}
                    >
                      <strong>{item.event.title}</strong>
                      <small>{item.event.startTime}–{item.event.endTime}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <form className="agenda-editor panel" onSubmit={saveEvent}>
            <div className="agenda-editor-head">
              <div>
                <p className="eyebrow">{editingId ? "Editar" : "Añadir"}</p>
                <h2>{editingId ? "Editar evento" : "Nuevo evento"}</h2>
              </div>
              {editingId && (
                <button type="button" className="danger-link" onClick={() => deleteEvent(editingId)}>Eliminar</button>
              )}
            </div>

            <div className="agenda-type-toggle">
              <button type="button" className={editor.type === "punctual" ? "active" : ""} onClick={() => setEditor((current) => ({ ...current, type: "punctual", date: current.date || weekStart }))}>Puntual</button>
              <button type="button" className={editor.type === "routine" ? "active" : ""} onClick={() => setEditor((current) => ({ ...current, type: "routine", weekdays: current.weekdays?.length ? current.weekdays : [0, 2, 4] }))}>Rutina</button>
            </div>

            <div className="agenda-form-grid">
              <label className="agenda-title-field">Título
                <input value={editor.title} onChange={(e) => setEditor((current) => ({ ...current, title: e.target.value }))} placeholder="Dentista, trabajo, entreno…" />
              </label>

              {editor.type === "punctual" ? (
                <label>Fecha
                  <input type="date" value={editor.date || ""} onChange={(e) => setEditor((current) => ({ ...current, date: e.target.value }))} />
                </label>
              ) : (
                <div className="agenda-weekdays">
                  <span>Días</span>
                  <div>
                    {SHORT_DAY_NAMES.map((day, index) => (
                      <button type="button" key={day} className={(editor.weekdays || []).includes(index) ? "active" : ""} onClick={() => toggleRoutineDay(index)}>{day}</button>
                    ))}
                  </div>
                </div>
              )}

              <label>Inicio
                <input type="time" value={editor.startTime} onChange={(e) => setEditor((current) => ({ ...current, startTime: e.target.value }))} />
              </label>
              <label>Fin
                <input type="time" value={editor.endTime} onChange={(e) => setEditor((current) => ({ ...current, endTime: e.target.value }))} />
              </label>
              <label className="agenda-notes-field">Nota
                <input value={editor.notes || ""} onChange={(e) => setEditor((current) => ({ ...current, notes: e.target.value }))} placeholder="Opcional" />
              </label>
            </div>

            <div className="agenda-editor-footer">
              <div className="agenda-color-picker">
                <span>Color</span>
                {DEFAULT_COLORS.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={editor.color === color ? "active" : ""}
                    style={{ background: color }}
                    onClick={() => setEditor((current) => ({ ...current, color }))}
                    aria-label={`Color ${color}`}
                  />
                ))}
                <input type="color" value={editor.color} onChange={(e) => setEditor((current) => ({ ...current, color: e.target.value }))} aria-label="Color personalizado" />
              </div>
              <div className="agenda-editor-actions">
                <button type="button" className="button secondary" onClick={() => resetEditor(editor.type)}>Limpiar</button>
                <button className="button primary" type="submit">{editingId ? "Guardar cambios" : "Añadir evento"}</button>
              </div>
            </div>
          </form>
        </div>

        <aside className="agenda-assistant panel">
          <div className="agenda-assistant-title">
            <div>
              <p className="eyebrow">Asistente</p>
              <h2>Resumen de agenda</h2>
            </div>
            <span>IA</span>
          </div>

          <section>
            <h3>Resumen del día</h3>
            <small>{formatShortDate(selectedSummaryDate)}</small>
            {selectedDayOccurrences.length ? (
              <ul>
                {selectedDayOccurrences.map((item) => (
                  <li key={`${item.event.id}-summary`}>
                    <i style={{ background: item.event.color }} />
                    <span><strong>{item.event.title}</strong> {item.event.startTime}–{item.event.endTime}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Día libre en la agenda.</p>}
          </section>

          <section className="agenda-week-summary">
            <h3>Resumen semanal</h3>
            <div>
              <span><strong>{punctualOccurrences.length}</strong><small>Puntuales</small></span>
              <span><strong>{routineOccurrences.length}</strong><small>Rutinas</small></span>
              <span><strong>{weeklyHours.toFixed(1)} h</strong><small>Ocupadas</small></span>
            </div>
          </section>

          {overloaded && overloaded.hours >= 9 && (
            <section className="agenda-assistant-card warning">
              <h3>Posible sobrecarga</h3>
              <p>{DAY_NAMES[weekDates.indexOf(overloaded.date)]} acumula {overloaded.hours.toFixed(1)} h planificadas. Deja un margen entre bloques si puedes.</p>
            </section>
          )}

          <section className="agenda-assistant-card good">
            <h3>Mejores franjas libres</h3>
            {freeWindows.length ? (
              <ul>
                {freeWindows.map((day) => (
                  <li key={day.date}>
                    <strong>{DAY_NAMES[day.index]}</strong>: {minutesLabel(day.free![0])}–{minutesLabel(day.free![1])}
                  </li>
                ))}
              </ul>
            ) : <p>No hay franjas libres largas esta semana.</p>}
          </section>

          <section className="agenda-assistant-card idea">
            <h3>Sugerencias de organización</h3>
            <ul>
              <li>Deja al menos 30–60 min libres alrededor de citas importantes.</li>
              <li>Concentra rutinas parecidas en horarios fijos para reducir decisiones.</li>
              <li>{freeWindows[0] ? `Reserva ${DAY_NAMES[freeWindows[0].index]} para tareas que necesiten concentración.` : "Busca un bloque semanal sin interrupciones para tareas pendientes."}</li>
            </ul>
          </section>
        </aside>
      </div>
    </section>
  );
}
