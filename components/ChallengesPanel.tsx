"use client";

import { useEffect, useMemo, useState } from "react";

type ChallengeFrequency = "daily" | "weekly" | "monthly";
type ChallengeRule = "minimum" | "maximum";

type Challenge = {
  id: string;
  title: string;
  frequency: ChallengeFrequency;
  target: number;
  rule?: ChallengeRule;
  unit: string;
  color: string;
  updatedAt?: string;
};

type ChallengeCompletion = {
  id: string;
  challengeId: string;
  periodKey: string;
  value: number;
  completed: boolean;
  updatedAt?: string;
};

const CHALLENGES_KEY = "facturas_challenges_v1";
const COMPLETIONS_KEY = "facturas_challenge_completions_v1";
const DELETED_KEY = "facturas_deleted_challenges_v1";
const COLORS = ["#8ecae6", "#b8b5ff", "#a8ddb5", "#f7c59f", "#f4a6a6", "#d7b5f5"];

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

function monthKey(value: string) {
  return value.slice(0, 7);
}

function periodKey(frequency: ChallengeFrequency, date = localDateISO()) {
  if (frequency === "daily") return date;
  if (frequency === "weekly") return `week:${mondayOf(date)}`;
  return monthKey(date);
}

function uid() {
  return crypto.randomUUID();
}

function timestamp(value?: string) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeById<T extends { id: string; updatedAt?: string }>(remote: T[], local: T[]) {
  const map = new Map<string, T>();
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

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function monthLabel(year: number, monthIndex: number) {
  return new Date(year, monthIndex, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

function shortMonth(monthIndex: number) {
  return new Date(2026, monthIndex, 1).toLocaleDateString("es-ES", { month: "short" }).replace(".", "");
}

function completionClass(rate: number | null) {
  if (rate === null) return "neutral";
  if (rate < 50) return "low";
  if (rate <= 95) return "mid";
  return "high";
}

function blankChallenge(frequency: ChallengeFrequency): Challenge {
  return {
    id: "",
    title: "",
    frequency,
    target: 1,
    rule: "minimum",
    unit: "",
    color: COLORS[0]
  };
}

export default function ChallengesPanel() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [completions, setCompletions] = useState<ChallengeCompletion[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"local" | "saving" | "saved" | "error">("local");
  const [frequency, setFrequency] = useState<ChallengeFrequency>("daily");
  const [editor, setEditor] = useState<Challenge>(() => blankChallenge("daily"));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statsRange, setStatsRange] = useState<30 | 60 | 90>(30);
  const [calendarAnchor, setCalendarAnchor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [year, setYear] = useState(() => new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let localChallenges: Challenge[] = [];
      let localCompletions: ChallengeCompletion[] = [];
      let localDeleted: string[] = [];

      try {
        localChallenges = JSON.parse(localStorage.getItem(CHALLENGES_KEY) || "[]");
        localCompletions = JSON.parse(localStorage.getItem(COMPLETIONS_KEY) || "[]");
        localDeleted = JSON.parse(localStorage.getItem(DELETED_KEY) || "[]");
      } catch {
        // Seguimos con la copia remota.
      }

      try {
        const response = await fetch("/api/personal", { cache: "no-store" });
        const result = await response.json();
        if (response.ok && result.configured && result.data) {
          const remoteDeleted = Array.isArray(result.data.deletedChallengeIds)
            ? result.data.deletedChallengeIds.map(String)
            : [];
          const allDeleted = mergeIds(localDeleted, remoteDeleted);
          const deletedSet = new Set(allDeleted);

          localChallenges = mergeById(
            Array.isArray(result.data.challenges) ? result.data.challenges : [],
            localChallenges
          ).filter((item) => !deletedSet.has(item.id));

          localCompletions = mergeById(
            Array.isArray(result.data.challengeCompletions) ? result.data.challengeCompletions : [],
            localCompletions
          ).filter((item) => !deletedSet.has(item.challengeId));

          localDeleted = allDeleted;
          setSyncStatus("saved");
        }
      } catch {
        setSyncStatus("error");
      }

      if (!cancelled) {
        setChallenges(localChallenges);
        setCompletions(localCompletions);
        setDeletedIds(localDeleted);
        setReady(true);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(CHALLENGES_KEY, JSON.stringify(challenges));
    localStorage.setItem(COMPLETIONS_KEY, JSON.stringify(completions));
    localStorage.setItem(DELETED_KEY, JSON.stringify(deletedIds));

    const timer = window.setTimeout(async () => {
      try {
        setSyncStatus("saving");
        const response = await fetch("/api/personal", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challenges,
            challengeCompletions: completions,
            deletedChallengeIds: deletedIds
          })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.data) return setSyncStatus("error");

        const remoteDeleted = Array.isArray(result.data.deletedChallengeIds)
          ? result.data.deletedChallengeIds.map(String)
          : [];
        const allDeleted = mergeIds(deletedIds, remoteDeleted);
        const deletedSet = new Set(allDeleted);

        const mergedChallenges = mergeById(
          Array.isArray(result.data.challenges) ? result.data.challenges : [],
          challenges
        ).filter((item) => !deletedSet.has(item.id));

        const mergedCompletions = mergeById(
          Array.isArray(result.data.challengeCompletions) ? result.data.challengeCompletions : [],
          completions
        ).filter((item) => !deletedSet.has(item.challengeId));

        if (JSON.stringify(mergedChallenges) !== JSON.stringify(challenges)) setChallenges(mergedChallenges);
        if (JSON.stringify(mergedCompletions) !== JSON.stringify(completions)) setCompletions(mergedCompletions);
        if (JSON.stringify(allDeleted) !== JSON.stringify(deletedIds)) setDeletedIds(allDeleted);
        setSyncStatus("saved");
      } catch {
        setSyncStatus("error");
      }
    }, 650);

    return () => window.clearTimeout(timer);
  }, [challenges, completions, deletedIds, ready]);

  const currentChallenges = challenges.filter((item) => item.frequency === frequency);
  const today = localDateISO();
  const completionMap = useMemo(
    () => new Map(completions.map((item) => [item.id, item])),
    [completions]
  );

  function completionFor(challenge: Challenge, key = periodKey(challenge.frequency)) {
    return completionMap.get(`${challenge.id}:${key}`);
  }

  function challengeIsCompleted(challenge: Challenge, value: number) {
    const target = Math.max(0, Number(challenge.target || 0));
    return (challenge.rule || "minimum") === "maximum"
      ? value <= target
      : value >= target;
  }

  function setProgress(challenge: Challenge, value: number) {
    const key = periodKey(challenge.frequency);
    const id = `${challenge.id}:${key}`;
    const cleanValue = Math.max(0, Number(value || 0));
    const next: ChallengeCompletion = {
      id,
      challengeId: challenge.id,
      periodKey: key,
      value: cleanValue,
      completed: challengeIsCompleted(challenge, cleanValue),
      updatedAt: nowISO()
    };

    setCompletions((current) => [
      ...current.filter((item) => item.id !== id),
      next
    ]);
  }

  function toggleCompleted(challenge: Challenge) {
    const current = completionFor(challenge);
    const target = Math.max(0, Number(challenge.target || 0));

    if ((challenge.rule || "minimum") === "maximum") {
      setProgress(challenge, current?.completed ? target + 1 : target);
      return;
    }

    setProgress(challenge, current?.completed ? 0 : Math.max(1, target));
  }

  function saveChallenge(event: React.FormEvent) {
    event.preventDefault();
    const title = editor.title.trim();
    if (!title) return;
    const next: Challenge = {
      ...editor,
      id: editingId || uid(),
      title,
      target: Math.max(0, Number(editor.target || 0)),
      rule: editor.rule || "minimum",
      updatedAt: nowISO()
    };
    setChallenges((current) => [...current.filter((item) => item.id !== next.id), next]);
    setDeletedIds((current) => current.filter((id) => id !== next.id));
    setEditingId(null);
    setFrequency(next.frequency);
    setEditor(blankChallenge(next.frequency));
  }

  function editChallenge(challenge: Challenge) {
    setEditingId(challenge.id);
    setFrequency(challenge.frequency);
    setEditor({ ...challenge });
  }

  function deleteChallenge(id: string) {
    setChallenges((current) => current.filter((item) => item.id !== id));
    setCompletions((current) => current.filter((item) => item.challengeId !== id));
    setDeletedIds((current) => mergeIds(current, [id]));
    if (editingId === id) {
      setEditingId(null);
      setEditor(blankChallenge(frequency));
    }
  }

  function selectFrequency(next: ChallengeFrequency) {
    setFrequency(next);
    setEditingId(null);
    setEditor(blankChallenge(next));
  }

  function dailyRate(date: string) {
    const daily = challenges.filter((item) => item.frequency === "daily");
    if (!daily.length) return null;
    if (date > today) return null;
    const completed = daily.filter((challenge) => completionFor(challenge, date)?.completed).length;
    return Math.round((completed / daily.length) * 100);
  }

  function monthRate(targetYear: number, monthIndex: number) {
    const month = `${targetYear}-${String(monthIndex + 1).padStart(2, "0")}`;
    const first = `${month}-01`;
    if (first > today.slice(0, 7) + "-01") return null;

    const daily = challenges.filter((item) => item.frequency === "daily");
    const monthly = challenges.filter((item) => item.frequency === "monthly");
    let done = 0;
    let possible = 0;

    const totalDays = daysInMonth(targetYear, monthIndex);
    const isCurrentMonth = month === today.slice(0, 7);
    const lastDay = isCurrentMonth ? Number(today.slice(8, 10)) : totalDays;

    for (let day = 1; day <= lastDay; day += 1) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      for (const challenge of daily) {
        possible += 1;
        if (completionFor(challenge, date)?.completed) done += 1;
      }
    }

    for (const challenge of monthly) {
      possible += 1;
      if (completionFor(challenge, month)?.completed) done += 1;
    }

    return possible ? Math.round((done / possible) * 100) : null;
  }

  function challengeRate(challenge: Challenge) {
    const relevant: boolean[] = [];
    if (challenge.frequency === "daily") {
      for (let i = statsRange - 1; i >= 0; i -= 1) {
        const date = addDays(today, -i);
        relevant.push(Boolean(completionFor(challenge, date)?.completed));
      }
    } else if (challenge.frequency === "weekly") {
      const currentMonday = mondayOf(today);
      const weeks = Math.max(4, Math.round(statsRange / 7));
      for (let i = weeks - 1; i >= 0; i -= 1) {
        const monday = addDays(currentMonday, -7 * i);
        relevant.push(Boolean(completionFor(challenge, `week:${monday}`)?.completed));
      }
    } else {
      const now = new Date();
      const months = Math.max(3, Math.round(statsRange / 30));
      for (let i = months - 1; i >= 0; i -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        relevant.push(Boolean(completionFor(challenge, key)?.completed));
      }
    }

    return relevant.length ? Math.round((relevant.filter(Boolean).length / relevant.length) * 100) : 0;
  }

  const challengeStats = challenges
    .map((challenge) => ({ challenge, rate: challengeRate(challenge) }))
    .sort((a, b) => b.rate - a.rate);

  const strongest = challengeStats[0];
  const weakest = challengeStats.length ? challengeStats[challengeStats.length - 1] : undefined;
  const globalRate = challengeStats.length
    ? Math.round(challengeStats.reduce((sum, item) => sum + item.rate, 0) / challengeStats.length)
    : 0;

  const bestStreak = useMemo(() => {
    let best = 0;
    for (const challenge of challenges.filter((item) => item.frequency === "daily")) {
      let current = 0;
      for (let i = 90; i >= 0; i -= 1) {
        const date = addDays(today, -i);
        if (completionMap.get(`${challenge.id}:${date}`)?.completed) {
          current += 1;
          best = Math.max(best, current);
        } else {
          current = 0;
        }
      }
    }
    return best;
  }, [challenges, completionMap, today]);

  const previousMonthDate = new Date(calendarAnchor.year, calendarAnchor.month - 1, 1);
  const currentMonthDate = new Date(calendarAnchor.year, calendarAnchor.month, 1);
  const calendarMonths = [
    { year: previousMonthDate.getFullYear(), month: previousMonthDate.getMonth() },
    { year: currentMonthDate.getFullYear(), month: currentMonthDate.getMonth() }
  ];

  function renderMonthCalendar(targetYear: number, monthIndex: number) {
    const count = daysInMonth(targetYear, monthIndex);
    const firstJsDay = new Date(targetYear, monthIndex, 1).getDay();
    const firstMondayIndex = firstJsDay === 0 ? 6 : firstJsDay - 1;
    const cells: React.ReactNode[] = [];

    for (let i = 0; i < firstMondayIndex; i += 1) {
      cells.push(<span className="challenge-day-square empty" key={`empty-${i}`} />);
    }

    for (let day = 1; day <= count; day += 1) {
      const date = `${targetYear}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const rate = dailyRate(date);
      cells.push(
        <span
          key={date}
          className={`challenge-day-square ${completionClass(rate)}`}
          title={rate === null ? `${date} · sin datos` : `${date} · ${rate}%`}
        >
          {day}
        </span>
      );
    }

    return cells;
  }

  if (!ready) return <section className="challenges-page"><div className="panel">Cargando retos…</div></section>;

  return (
    <section className="challenges-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Hábitos y objetivos</p>
          <h1>Retos</h1>
          <p className="muted">Control diario, semanal y mensual con historial de cumplimiento.</p>
        </div>
        <span className={`challenge-sync ${syncStatus}`}>
          {syncStatus === "saving" ? "Guardando…" : syncStatus === "saved" ? "Sincronizado" : syncStatus === "error" ? "Error de sincronización" : "Local"}
        </span>
      </header>

      <div className="challenges-layout">
        <div className="challenges-main">
          <div className="challenges-manager panel">
            <div className="challenge-tabs">
              <button className={frequency === "daily" ? "active" : ""} onClick={() => selectFrequency("daily")}>Diarios</button>
              <button className={frequency === "weekly" ? "active" : ""} onClick={() => selectFrequency("weekly")}>Semanales</button>
              <button className={frequency === "monthly" ? "active" : ""} onClick={() => selectFrequency("monthly")}>Mensuales</button>
            </div>

            <div className="challenge-list-head">
              <div>
                <h2>Mis retos {frequency === "daily" ? "diarios" : frequency === "weekly" ? "semanales" : "mensuales"}</h2>
                <small>{currentChallenges.length} activos</small>
              </div>
            </div>

            <div className="challenge-table">
              <div className="challenge-table-head">
                <span>Repte</span>
                <span>Progreso actual</span>
                <span>Estado</span>
                <span>Consecución</span>
                <span />
              </div>

              {currentChallenges.length === 0 && (
                <div className="challenge-empty">Añade tu primer reto {frequency === "daily" ? "diario" : frequency === "weekly" ? "semanal" : "mensual"}.</div>
              )}

              {currentChallenges.map((challenge) => {
                const current = completionFor(challenge);
                const value = current?.value || 0;
                const rate = challengeRate(challenge);
                return (
                  <div className="challenge-row" key={challenge.id}>
                    <div className="challenge-title-cell">
                      <i style={{ background: challenge.color }} />
                      <div>
                        <strong>{challenge.title}</strong>
                        <small className={`challenge-rule-badge ${(challenge.rule || "minimum") === "maximum" ? "maximum" : "minimum"}`}>
                          {(challenge.rule || "minimum") === "maximum" ? `Máx. ${challenge.target}${challenge.unit ? ` ${challenge.unit}` : ""}` : `Mín. ${challenge.target}${challenge.unit ? ` ${challenge.unit}` : ""}`}
                        </small>
                      </div>
                    </div>

                    <div className="challenge-progress-input">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={value || ""}
                        placeholder="0"
                        onChange={(e) => setProgress(challenge, Number(e.target.value || 0))}
                      />
                      <span>
                        {(challenge.rule || "minimum") === "maximum" ? "máx." : "mín."} {challenge.target}{challenge.unit ? ` ${challenge.unit}` : ""}
                      </span>
                    </div>

                    <button
                      className={`challenge-status ${current?.completed ? "done" : "pending"}`}
                      onClick={() => toggleCompleted(challenge)}
                    >
                      {current ? (current.completed ? "✓ Cumplido" : "× No cumplido") : "○ Sin registrar"}
                    </button>

                    <div className="challenge-rate">
                      <span><i style={{ width: `${rate}%` }} /></span>
                      <b>{rate}%</b>
                    </div>

                    <div className="challenge-row-actions">
                      <button onClick={() => editChallenge(challenge)} title="Editar">✎</button>
                      <button onClick={() => deleteChallenge(challenge.id)} title="Eliminar">×</button>
                    </div>
                  </div>
                );
              })}
            </div>

            <form className="challenge-editor" onSubmit={saveChallenge}>
              <div className="challenge-editor-title">
                <strong>{editingId ? "Editar reto" : "Añadir reto"}</strong>
                {editingId && <button type="button" onClick={() => { setEditingId(null); setEditor(blankChallenge(frequency)); }}>Cancelar edición</button>}
              </div>
              <div className="challenge-editor-grid">
                <label>Nombre
                  <input value={editor.title} onChange={(e) => setEditor((current) => ({ ...current, title: e.target.value }))} placeholder="Beber 2L, gym, estudiar…" />
                </label>
                <label>Frecuencia
                  <select value={editor.frequency} onChange={(e) => setEditor((current) => ({ ...current, frequency: e.target.value as ChallengeFrequency }))}>
                    <option value="daily">Diario</option>
                    <option value="weekly">Semanal</option>
                    <option value="monthly">Mensual</option>
                  </select>
                </label>
                <label>Regla
                  <select value={editor.rule || "minimum"} onChange={(e) => setEditor((current) => ({ ...current, rule: e.target.value as ChallengeRule }))}>
                    <option value="minimum">Objetivo mínimo</option>
                    <option value="maximum">Limitador máximo</option>
                  </select>
                </label>
                <label>{(editor.rule || "minimum") === "maximum" ? "Límite máximo" : "Objetivo mínimo"}
                  <input type="number" min="0" step="0.1" value={editor.target} onChange={(e) => setEditor((current) => ({ ...current, target: Number(e.target.value || 0) }))} />
                </label>
                <label>Unidad
                  <input value={editor.unit} onChange={(e) => setEditor((current) => ({ ...current, unit: e.target.value }))} placeholder="L, h, €, veces…" />
                </label>
                <label className="challenge-color-label">Color
                  <div className="challenge-colors">
                    {COLORS.map((color) => (
                      <button type="button" key={color} className={editor.color === color ? "active" : ""} style={{ background: color }} onClick={() => setEditor((current) => ({ ...current, color }))} aria-label={color} />
                    ))}
                    <input type="color" value={editor.color} onChange={(e) => setEditor((current) => ({ ...current, color: e.target.value }))} aria-label="Color personalizado" />
                  </div>
                </label>
                <button className="button primary challenge-save" type="submit">{editingId ? "Guardar reto" : "+ Añadir reto"}</button>
              </div>
            </form>
          </div>

          <section className="challenge-stats panel">
            <div className="challenge-section-title">
              <div><p className="eyebrow">Estadísticas</p><h2>Rendimiento</h2></div>
              <select value={statsRange} onChange={(e) => setStatsRange(Number(e.target.value) as 30 | 60 | 90)}>
                <option value={30}>Últimos 30 días</option>
                <option value={60}>Últimos 60 días</option>
                <option value={90}>Últimos 90 días</option>
              </select>
            </div>

            <div className="challenge-kpis">
              <article><small>Cumplimiento global</small><strong>{globalRate}%</strong></article>
              <article><small>Mejor racha</small><strong>{bestStreak} días</strong></article>
              <article className="weak"><small>Reto más débil</small><strong>{weakest?.challenge.title || "—"}</strong><span>{weakest ? `${weakest.rate}%` : ""}</span></article>
              <article className="strong"><small>Reto más fuerte</small><strong>{strongest?.challenge.title || "—"}</strong><span>{strongest ? `${strongest.rate}%` : ""}</span></article>
            </div>

            <div className="challenge-rate-list">
              <h3>Cumplimiento por reto</h3>
              {challengeStats.map(({ challenge, rate }) => (
                <div key={challenge.id}>
                  <span><i style={{ background: challenge.color }} />{challenge.title}</span>
                  <div><i style={{ width: `${rate}%` }} /></div>
                  <b>{rate}%</b>
                </div>
              ))}
              {!challengeStats.length && <p className="muted">Todavía no hay retos para analizar.</p>}
            </div>
          </section>
        </div>

        <aside className="challenge-side">
          <section className="challenge-calendar panel">
            <div className="challenge-section-title">
              <div><p className="eyebrow">Vista 1</p><h2>Cumplimiento diario</h2></div>
              <div className="challenge-calendar-nav">
                <button onClick={() => {
                  const date = new Date(calendarAnchor.year, calendarAnchor.month - 1, 1);
                  setCalendarAnchor({ year: date.getFullYear(), month: date.getMonth() });
                }}>‹</button>
                <button onClick={() => {
                  const now = new Date();
                  setCalendarAnchor({ year: now.getFullYear(), month: now.getMonth() });
                }}>Hoy</button>
                <button onClick={() => {
                  const date = new Date(calendarAnchor.year, calendarAnchor.month + 1, 1);
                  setCalendarAnchor({ year: date.getFullYear(), month: date.getMonth() });
                }}>›</button>
              </div>
            </div>

            <div className="challenge-legend">
              <span><i className="high" />&gt;95%</span>
              <span><i className="mid" />50–95%</span>
              <span><i className="low" />0–50%</span>
            </div>

            <div className="challenge-months-grid">
              {calendarMonths.map((month) => (
                <div className="challenge-mini-month" key={`${month.year}-${month.month}`}>
                  <strong>{monthLabel(month.year, month.month)}</strong>
                  <div className="challenge-week-labels">
                    {["L", "M", "X", "J", "V", "S", "D"].map((day) => <span key={day}>{day}</span>)}
                  </div>
                  <div className="challenge-days-grid">
                    {renderMonthCalendar(month.year, month.month)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="challenge-monthly panel">
            <div className="challenge-section-title">
              <div><p className="eyebrow">Vista 2</p><h2>Cumplimiento mensual</h2></div>
              <div className="challenge-year-nav">
                <button onClick={() => setYear((value) => value - 1)}>‹</button>
                <strong>{year}</strong>
                <button onClick={() => setYear((value) => value + 1)}>›</button>
              </div>
            </div>

            <div className="challenge-month-squares">
              {Array.from({ length: 12 }, (_, monthIndex) => {
                const rate = monthRate(year, monthIndex);
                return (
                  <div key={monthIndex}>
                    <span>{shortMonth(monthIndex)}</span>
                    <i className={completionClass(rate)} title={rate === null ? "Sin datos" : `${rate}%`} />
                    <small>{rate === null ? "—" : `${rate}%`}</small>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="challenge-assistant panel">
            <div className="challenge-assistant-head">
              <div><p className="eyebrow">Asistente</p><h2>Resumen y sugerencias</h2></div>
              <span>IA</span>
            </div>

            {weakest ? (
              <>
                <div className="challenge-insight warning">
                  <strong>Reto con más dificultad</strong>
                  <p>“{weakest.challenge.title}” tiene un {weakest.rate}% de cumplimiento. Prueba a reducir el objetivo o reservarle un bloque concreto en la Agenda.</p>
                </div>
                <div className="challenge-insight good">
                  <strong>Hábito más estable</strong>
                  <p>“{strongest?.challenge.title}” es tu reto más constante ({strongest?.rate}%). Mantén la misma estructura.</p>
                </div>
                <div className="challenge-insight idea">
                  <strong>Siguiente foco</strong>
                  <p>Tu media global es del {globalRate}%. Prioriza un solo reto débil esta semana antes de añadir más objetivos.</p>
                </div>
              </>
            ) : (
              <p className="muted">Añade retos y marca su progreso para recibir un resumen útil.</p>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
