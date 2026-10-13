"use client";

import { useEffect, useMemo, useState } from "react";

type MovementType = "income" | "expense";
type PeriodMode = "month" | "year" | "all";

type InvoiceLine = {
  quantity: number;
  unitPrice: number;
  vat: number;
  withholding: number;
};

type Invoice = {
  id: string;
  number: string;
  issueDate: string;
  collectionDate?: string;
  status: "Borrador" | "Emitida" | "Cobrada" | "Anulada";
  lines: InvoiceLine[];
};

type PersonalMovement = {
  id: string;
  date: string;
  type: MovementType;
  category: string;
  concept: string;
  amount: number;
  notes: string;
  recurringId?: string;
  recurringMonth?: string;
  updatedAt?: string;
};

type RecurringMovement = {
  id: string;
  type: MovementType;
  category: string;
  concept: string;
  amount: number;
  notes: string;
  startMonth: string;
  endMonth: string;
  dayOfMonth: number;
  active: boolean;
  updatedAt?: string;
};

type Props = {
  invoices: Invoice[];
  amountsVisible: boolean;
  onToggleAmounts: () => void;
};

const MOVEMENTS_KEY = "facturas_personal_movements_v1";
const RECURRING_KEY = "facturas_personal_recurring_v1";
const DELETED_MOVEMENTS_KEY = "facturas_personal_deleted_movements_v1";
const DELETED_RECURRING_KEY = "facturas_personal_deleted_recurring_v1";

const incomeCategories = ["Nómina", "Otros ingresos", "Reembolso", "Venta"];
const expenseCategories = [
  "Vivienda",
  "Suministros",
  "Alimentación",
  "Transporte",
  "Ocio",
  "Suscripciones",
  "Compras",
  "Salud",
  "Formación",
  "Viajes",
  "Otros gastos"
];

function uid() {
  return crypto.randomUUID();
}

function nowISO() {
  return new Date().toISOString();
}

function todayISO() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
}

function timestamp(value?: string) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function currency(value: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR"
  }).format(money(value));
}

function invoiceCash(invoice: Invoice) {
  return money(invoice.lines.reduce((sum, line) => {
    const base = Number(line.quantity || 0) * Number(line.unitPrice || 0);
    return sum +
      base +
      base * (Number(line.vat || 0) / 100) -
      base * (Number(line.withholding || 0) / 100);
  }, 0));
}

function mergeById<T extends { id: string; updatedAt?: string }>(
  remote: T[],
  local: T[],
  deletedIds: string[]
) {
  const deleted = new Set(deletedIds);
  const map = new Map<string, T>();

  for (const item of remote) {
    if (item?.id && !deleted.has(item.id)) map.set(item.id, item);
  }

  for (const item of local) {
    if (!item?.id || deleted.has(item.id)) continue;
    const existing = map.get(item.id);
    if (!existing || timestamp(item.updatedAt) > timestamp(existing.updatedAt)) {
      map.set(item.id, item);
    }
  }

  return [...map.values()];
}

function mergeIds(a: string[] = [], b: string[] = []) {
  return [...new Set([...a, ...b])];
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function monthKeysFrom(startMonth: string, endMonth: string) {
  if (!startMonth || !endMonth || startMonth > endMonth) return [];
  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const [endYear, endMonthNumber] = endMonth.split("-").map(Number);
  const keys: string[] = [];

  let year = startYear;
  let month = startMonthNumber;

  while (year < endYear || (year === endYear && month <= endMonthNumber)) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return keys;
}

function recurringMovementId(templateId: string, monthKey: string) {
  return `personal-recurring-${templateId}-${monthKey}`;
}

function recurringDate(monthKey: string, dayOfMonth: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthKey}-${String(Math.min(Math.max(dayOfMonth, 1), lastDay)).padStart(2, "0")}`;
}

function materializeRecurring(
  movements: PersonalMovement[],
  recurring: RecurringMovement[],
  deletedMovementIds: string[]
) {
  const today = todayISO();
  const currentMonth = today.slice(0, 7);
  const existing = new Set(movements.map((item) => item.id));
  const deleted = new Set(deletedMovementIds);
  const additions: PersonalMovement[] = [];

  for (const template of recurring) {
    if (!template.active || !template.startMonth) continue;
    const effectiveEnd = template.endMonth && template.endMonth < currentMonth
      ? template.endMonth
      : currentMonth;

    for (const monthKey of monthKeysFrom(template.startMonth, effectiveEnd)) {
      const id = recurringMovementId(template.id, monthKey);
      if (existing.has(id) || deleted.has(id)) continue;

      const date = recurringDate(monthKey, template.dayOfMonth);
      if (date > today) continue;

      additions.push({
        id,
        date,
        type: template.type,
        category: template.category,
        concept: template.concept,
        amount: Number(template.amount || 0),
        notes: template.notes || "",
        recurringId: template.id,
        recurringMonth: monthKey,
        updatedAt: nowISO()
      });
      existing.add(id);
    }
  }

  return additions.length ? [...movements, ...additions] : movements;
}

function blankDraft() {
  const date = todayISO();
  return {
    id: "",
    date,
    type: "expense" as MovementType,
    category: "Alimentación",
    concept: "",
    amount: 0,
    notes: "",
    monthly: false
  };
}

export default function PersonalFinancePanel({ invoices, amountsVisible, onToggleAmounts }: Props) {
  const today = todayISO();
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(today.slice(0, 4));
  const [movements, setMovements] = useState<PersonalMovement[]>([]);
  const [recurring, setRecurring] = useState<RecurringMovement[]>([]);
  const [deletedMovementIds, setDeletedMovementIds] = useState<string[]>([]);
  const [deletedRecurringIds, setDeletedRecurringIds] = useState<string[]>([]);
  const [draft, setDraft] = useState(blankDraft());
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [syncStatus, setSyncStatus] = useState<"local" | "saving" | "saved" | "error">("local");

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let loadedMovements: PersonalMovement[] = [];
      let loadedRecurring: RecurringMovement[] = [];
      let loadedDeletedMovements: string[] = [];
      let loadedDeletedRecurring: string[] = [];

      try {
        loadedMovements = JSON.parse(localStorage.getItem(MOVEMENTS_KEY) || "[]");
        loadedRecurring = JSON.parse(localStorage.getItem(RECURRING_KEY) || "[]");
        loadedDeletedMovements = JSON.parse(localStorage.getItem(DELETED_MOVEMENTS_KEY) || "[]");
        loadedDeletedRecurring = JSON.parse(localStorage.getItem(DELETED_RECURRING_KEY) || "[]");
      } catch {
        // Si el almacenamiento local falla, intentamos recuperar la copia remota.
      }

      try {
        const response = await fetch("/api/personal", { cache: "no-store" });
        const result = await response.json();

        if (response.ok && result.configured && result.data) {
          loadedDeletedMovements = mergeIds(
            result.data.deletedMovementIds || [],
            loadedDeletedMovements
          );
          loadedDeletedRecurring = mergeIds(
            result.data.deletedRecurringIds || [],
            loadedDeletedRecurring
          );

          loadedMovements = mergeById<PersonalMovement>(
            result.data.movements || [],
            loadedMovements,
            loadedDeletedMovements
          );
          loadedRecurring = mergeById<RecurringMovement>(
            result.data.recurring || [],
            loadedRecurring,
            loadedDeletedRecurring
          );
          setSyncStatus("saved");
        }
      } catch {
        setSyncStatus("error");
      }

      loadedMovements = materializeRecurring(
        loadedMovements,
        loadedRecurring,
        loadedDeletedMovements
      );

      if (!cancelled) {
        setMovements(loadedMovements);
        setRecurring(loadedRecurring);
        setDeletedMovementIds(loadedDeletedMovements);
        setDeletedRecurringIds(loadedDeletedRecurring);
        setReady(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    localStorage.setItem(MOVEMENTS_KEY, JSON.stringify(movements));
    localStorage.setItem(RECURRING_KEY, JSON.stringify(recurring));
    localStorage.setItem(DELETED_MOVEMENTS_KEY, JSON.stringify(deletedMovementIds));
    localStorage.setItem(DELETED_RECURRING_KEY, JSON.stringify(deletedRecurringIds));

    const timer = window.setTimeout(async () => {
      try {
        setSyncStatus("saving");
        const response = await fetch("/api/personal", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            movements,
            recurring,
            deletedMovementIds,
            deletedRecurringIds
          })
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.data) {
          setSyncStatus("error");
          return;
        }

        const nextDeletedMovements = mergeIds(
          result.data.deletedMovementIds || [],
          deletedMovementIds
        );
        const nextDeletedRecurring = mergeIds(
          result.data.deletedRecurringIds || [],
          deletedRecurringIds
        );
        const nextMovements = materializeRecurring(
          mergeById<PersonalMovement>(
            result.data.movements || [],
            movements,
            nextDeletedMovements
          ),
          mergeById<RecurringMovement>(
            result.data.recurring || [],
            recurring,
            nextDeletedRecurring
          ),
          nextDeletedMovements
        );
        const nextRecurring = mergeById<RecurringMovement>(
          result.data.recurring || [],
          recurring,
          nextDeletedRecurring
        );

        if (!sameJson(nextMovements, movements)) setMovements(nextMovements);
        if (!sameJson(nextRecurring, recurring)) setRecurring(nextRecurring);
        if (!sameJson(nextDeletedMovements, deletedMovementIds)) {
          setDeletedMovementIds(nextDeletedMovements);
        }
        if (!sameJson(nextDeletedRecurring, deletedRecurringIds)) {
          setDeletedRecurringIds(nextDeletedRecurring);
        }
        setSyncStatus("saved");
      } catch {
        setSyncStatus("error");
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [movements, recurring, deletedMovementIds, deletedRecurringIds, ready]);

  useEffect(() => {
    if (!ready) return;

    const timer = window.setInterval(() => {
      setMovements((current) =>
        materializeRecurring(current, recurring, deletedMovementIds)
      );
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [ready, recurring, deletedMovementIds]);

  const autoFreelanceIncome = useMemo(
    () => invoices
      .filter((invoice) => invoice.status === "Cobrada")
      .map((invoice) => ({
        id: `invoice-${invoice.id}`,
        date: invoice.collectionDate || invoice.issueDate,
        type: "income" as const,
        category: "Autónomo",
        concept: invoice.number ? `Factura ${invoice.number}` : "Factura cobrada",
        amount: invoiceCash(invoice),
        notes: "Importado automáticamente desde Facturas",
        automatic: true
      })),
    [invoices]
  );

  const periodMatches = (date: string) => {
    if (periodMode === "month") return date.startsWith(month);
    if (periodMode === "year") return date.startsWith(year);
    return true;
  };

  const visibleManualMovements = useMemo(
    () => movements
      .filter((item) => periodMatches(item.date))
      .sort((a, b) => b.date.localeCompare(a.date)),
    [movements, periodMode, month, year]
  );

  const visibleAutoIncome = useMemo(
    () => autoFreelanceIncome
      .filter((item) => periodMatches(item.date))
      .sort((a, b) => b.date.localeCompare(a.date)),
    [autoFreelanceIncome, periodMode, month, year]
  );

  const allVisible = useMemo(
    () => [
      ...visibleManualMovements.map((item) => ({ ...item, automatic: false })),
      ...visibleAutoIncome
    ].sort((a, b) => b.date.localeCompare(a.date)),
    [visibleManualMovements, visibleAutoIncome]
  );

  const stats = useMemo(() => {
    let income = 0;
    let expense = 0;
    let salary = 0;
    let freelance = 0;
    let recurringExpense = 0;
    let leisure = 0;

    for (const item of allVisible) {
      const amount = Number(item.amount || 0);
      if (item.type === "income") {
        income += amount;
        if (item.category === "Nómina") salary += amount;
        if (item.category === "Autónomo") freelance += amount;
      } else {
        expense += amount;
        if ("recurringId" in item && item.recurringId) recurringExpense += amount;
        if (item.category === "Ocio") leisure += amount;
      }
    }

    const balance = money(income - expense);
    return {
      income: money(income),
      expense: money(expense),
      balance,
      savingsRate: income > 0 ? balance / income : 0,
      salary: money(salary),
      freelance: money(freelance),
      recurringExpense: money(recurringExpense),
      leisure: money(leisure)
    };
  }, [allVisible]);

  const categorySummary = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();

    for (const item of allVisible) {
      const current = map.get(item.category) || { income: 0, expense: 0 };
      current[item.type] += Number(item.amount || 0);
      map.set(item.category, current);
    }

    const incomes = [...map.entries()]
      .filter(([, values]) => values.income > 0)
      .map(([category, values]) => ({ category, amount: money(values.income) }))
      .sort((a, b) => b.amount - a.amount);

    const expenses = [...map.entries()]
      .filter(([, values]) => values.expense > 0)
      .map(([category, values]) => ({ category, amount: money(values.expense) }))
      .sort((a, b) => b.amount - a.amount);

    return { incomes, expenses };
  }, [allVisible]);

  const periodLabel = useMemo(() => {
    if (periodMode === "all") return "Todo";
    if (periodMode === "year") return year;

    return new Date(`${month}-01T12:00:00`).toLocaleDateString("es-ES", {
      month: "long",
      year: "numeric"
    });
  }, [periodMode, month, year]);

  function shown(value: number) {
    return amountsVisible ? currency(value) : "•••• €";
  }

  function updateDraftType(type: MovementType) {
    const categories = type === "income" ? incomeCategories : expenseCategories;
    setDraft((current) => ({
      ...current,
      type,
      category: categories.includes(current.category) ? current.category : categories[0]
    }));
  }

  function saveMovement() {
    if (!draft.date) return flash("Indica una fecha.");
    if (!draft.concept.trim()) return flash("Escribe un concepto.");
    if (Number(draft.amount) <= 0) return flash("El importe debe ser mayor que 0.");

    const stamp = nowISO();

    if (draft.monthly) {
      const template: RecurringMovement = {
        id: uid(),
        type: draft.type,
        category: draft.category,
        concept: draft.concept.trim(),
        amount: Number(draft.amount),
        notes: draft.notes.trim(),
        startMonth: draft.date.slice(0, 7),
        endMonth: "",
        dayOfMonth: Number(draft.date.slice(8, 10)) || 1,
        active: true,
        updatedAt: stamp
      };

      setRecurring((current) => [...current, template]);
      setMovements((current) =>
        materializeRecurring(current, [...recurring, template], deletedMovementIds)
      );
      setDraft(blankDraft());
      flash("Movimiento mensual guardado.");
      return;
    }

    const movement: PersonalMovement = {
      id: uid(),
      date: draft.date,
      type: draft.type,
      category: draft.category,
      concept: draft.concept.trim(),
      amount: Number(draft.amount),
      notes: draft.notes.trim(),
      updatedAt: stamp
    };

    setMovements((current) => [...current, movement]);
    setDraft(blankDraft());
    flash("Movimiento guardado.");
  }

  function deleteMovement(item: PersonalMovement) {
    if (!window.confirm(`¿Eliminar “${item.concept}”?`)) return;
    setMovements((current) => current.filter((movement) => movement.id !== item.id));
    setDeletedMovementIds((current) =>
      current.includes(item.id) ? current : [...current, item.id]
    );
  }

  function toggleRecurring(item: RecurringMovement) {
    setRecurring((current) =>
      current.map((movement) =>
        movement.id === item.id
          ? { ...movement, active: !movement.active, updatedAt: nowISO() }
          : movement
      )
    );
  }

  function deleteRecurring(item: RecurringMovement) {
    if (!window.confirm(
      `¿Eliminar el movimiento mensual “${item.concept}”? Los meses ya registrados se conservarán.`
    )) return;

    setRecurring((current) => current.filter((movement) => movement.id !== item.id));
    setDeletedRecurringIds((current) =>
      current.includes(item.id) ? current : [...current, item.id]
    );
  }

  if (!ready) return <div className="panel">Cargando tus cuentas…</div>;

  const maxIncomeCategory = Math.max(1, ...categorySummary.incomes.map((item) => item.amount));
  const maxExpenseCategory = Math.max(1, ...categorySummary.expenses.map((item) => item.amount));

  return (
    <section className="personal-finance">
      {notice && <div className="toast">{notice}</div>}

      <header className="page-header personal-finance-header">
        <div>
          <p className="eyebrow">Finanzas personales</p>
          <h1>Cuentas</h1>
          <p className="muted">
            Nómina, ingresos de autónomo, gastos fijos, ocio y el resto de tus movimientos.
          </p>
        </div>
        <div className="personal-header-actions">
          <span className={`personal-sync-status ${syncStatus}`}>
            {syncStatus === "saving"
              ? "Guardando…"
              : syncStatus === "saved"
                ? "Sincronizado"
                : syncStatus === "error"
                  ? "Copia local"
                  : "Local"}
          </span>
          <button className="button secondary" onClick={onToggleAmounts}>
            {amountsVisible ? "Ocultar importes" : "Mostrar importes"}
          </button>
        </div>
      </header>

      <div className="personal-period panel">
        <div className="finance-period-switch" aria-label="Periodo de cuentas">
          <button className={periodMode === "month" ? "active" : ""} onClick={() => setPeriodMode("month")}>Mes</button>
          <button className={periodMode === "year" ? "active" : ""} onClick={() => setPeriodMode("year")}>Año</button>
          <button className={periodMode === "all" ? "active" : ""} onClick={() => setPeriodMode("all")}>Todo</button>
        </div>
        {periodMode === "month" && (
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        )}
        {periodMode === "year" && (
          <input
            type="number"
            min="2000"
            max="2100"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        )}
        <strong>{periodLabel}</strong>
      </div>

      <div className="personal-kpis">
        <article>
          <span>Ingresos</span>
          <strong>{shown(stats.income)}</strong>
          <small>Nómina + autónomo + otros ingresos</small>
        </article>
        <article>
          <span>Gastos</span>
          <strong>{shown(stats.expense)}</strong>
          <small>Todos los gastos personales</small>
        </article>
        <article className={`personal-balance ${stats.balance < 0 ? "negative" : ""}`}>
          <span>Balance / ahorro</span>
          <strong>{shown(stats.balance)}</strong>
          <small>Ingresos − gastos</small>
        </article>
        <article>
          <span>Tasa de ahorro</span>
          <strong>{amountsVisible ? `${Math.round(stats.savingsRate * 100)}%` : "••%"}</strong>
          <small>Parte de tus ingresos que no has gastado</small>
        </article>
      </div>

      <div className="personal-quick-stats">
        <article><span>Nómina</span><strong>{shown(stats.salary)}</strong></article>
        <article><span>Autónomo cobrado</span><strong>{shown(stats.freelance)}</strong></article>
        <article><span>Gastos mensuales</span><strong>{shown(stats.recurringExpense)}</strong></article>
        <article><span>Ocio</span><strong>{shown(stats.leisure)}</strong></article>
      </div>

      <div className="personal-grid">
        <section className="panel personal-entry-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">Nuevo</p>
              <h2>Añadir movimiento</h2>
            </div>
          </div>

          <div className="personal-type-switch">
            <button
              className={draft.type === "expense" ? "active" : ""}
              onClick={() => updateDraftType("expense")}
            >
              Gasto
            </button>
            <button
              className={draft.type === "income" ? "active" : ""}
              onClick={() => updateDraftType("income")}
            >
              Ingreso
            </button>
          </div>

          <div className="form-grid two compact personal-entry-form">
            <label>
              Fecha
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft((current) => ({ ...current, date: e.target.value }))}
              />
            </label>
            <label>
              Categoría
              <select
                value={draft.category}
                onChange={(e) => setDraft((current) => ({ ...current, category: e.target.value }))}
              >
                {(draft.type === "income" ? incomeCategories : expenseCategories).map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>
            <label>
              Concepto
              <input
                value={draft.concept}
                placeholder={draft.type === "income" ? "Ej. Nómina octubre" : "Ej. Alquiler"}
                onChange={(e) => setDraft((current) => ({ ...current, concept: e.target.value }))}
              />
            </label>
            <label>
              Importe
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.amount || ""}
                onChange={(e) => setDraft((current) => ({ ...current, amount: Number(e.target.value) }))}
              />
            </label>
            <label className="full-width">
              Nota
              <input
                value={draft.notes}
                placeholder="Opcional"
                onChange={(e) => setDraft((current) => ({ ...current, notes: e.target.value }))}
              />
            </label>
          </div>

          <label className="personal-monthly-toggle">
            <input
              type="checkbox"
              checked={draft.monthly}
              onChange={(e) => setDraft((current) => ({ ...current, monthly: e.target.checked }))}
            />
            <span>
              <strong>Repetir cada mes</strong>
              <small>Ideal para nómina, alquiler, gimnasio, suscripciones, etc.</small>
            </span>
          </label>

          <button className="button primary personal-save" onClick={saveMovement}>
            {draft.monthly ? "Guardar mensual" : "Guardar movimiento"}
          </button>
        </section>

        <section className="panel personal-category-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">Distribución</p>
              <h2>Por categorías</h2>
            </div>
          </div>

          <div className="personal-category-columns">
            <div>
              <h3>Ingresos</h3>
              {categorySummary.incomes.length === 0 && <p className="muted">Sin ingresos.</p>}
              {categorySummary.incomes.map((item) => (
                <div className="personal-category-row" key={item.category}>
                  <div><span>{item.category}</span><strong>{shown(item.amount)}</strong></div>
                  <div className="personal-category-bar">
                    <i style={{ width: `${Math.max(4, item.amount / maxIncomeCategory * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <h3>Gastos</h3>
              {categorySummary.expenses.length === 0 && <p className="muted">Sin gastos.</p>}
              {categorySummary.expenses.map((item) => (
                <div className="personal-category-row expense" key={item.category}>
                  <div><span>{item.category}</span><strong>{shown(item.amount)}</strong></div>
                  <div className="personal-category-bar">
                    <i style={{ width: `${Math.max(4, item.amount / maxExpenseCategory * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="panel personal-movements-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Detalle</p>
            <h2>Movimientos</h2>
          </div>
          <span className="muted">{allVisible.length} movimientos</span>
        </div>

        {allVisible.length === 0 ? (
          <p className="personal-empty">No hay movimientos en este periodo.</p>
        ) : (
          <div className="personal-movement-list">
            {allVisible.map((item) => {
              const automatic = "automatic" in item && item.automatic;
              return (
                <article key={item.id}>
                  <span className={`personal-movement-icon ${item.type}`}>
                    {item.type === "income" ? "＋" : "−"}
                  </span>
                  <div className="personal-movement-main">
                    <strong>{item.concept}</strong>
                    <span>
                      {item.category} · {new Date(`${item.date}T12:00:00`).toLocaleDateString("es-ES")}
                      {automatic ? " · automático" : ""}
                      {"recurringId" in item && item.recurringId ? " · mensual" : ""}
                    </span>
                  </div>
                  <strong className={`personal-movement-amount ${item.type}`}>
                    {amountsVisible
                      ? `${item.type === "income" ? "+" : "−"} ${currency(Number(item.amount || 0))}`
                      : "•••• €"}
                  </strong>
                  {!automatic && (
                    <button
                      className="personal-delete"
                      onClick={() => deleteMovement(item as PersonalMovement)}
                      aria-label={`Eliminar ${item.concept}`}
                    >
                      ×
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel personal-recurring-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Automático</p>
            <h2>Movimientos mensuales</h2>
          </div>
          <span className="muted">{recurring.filter((item) => item.active).length} activos</span>
        </div>

        {recurring.length === 0 ? (
          <p className="personal-empty">
            Marca “Repetir cada mes” al añadir un movimiento para crear aquí tus gastos fijos o ingresos recurrentes.
          </p>
        ) : (
          <div className="personal-recurring-list">
            {recurring
              .slice()
              .sort((a, b) => a.type.localeCompare(b.type) || a.concept.localeCompare(b.concept))
              .map((item) => (
                <article key={item.id}>
                  <div className="personal-movement-main">
                    <strong>{item.concept}</strong>
                    <span>
                      {item.category} · día {item.dayOfMonth} · desde {item.startMonth}
                    </span>
                  </div>
                  <strong className={item.type}>
                    {shown(Number(item.amount || 0))}
                  </strong>
                  <button
                    className={`personal-recurring-toggle ${item.active ? "active" : ""}`}
                    onClick={() => toggleRecurring(item)}
                  >
                    {item.active ? "Activo" : "Pausado"}
                  </button>
                  <button className="personal-delete" onClick={() => deleteRecurring(item)}>×</button>
                </article>
              ))}
          </div>
        )}
      </section>

      <p className="personal-footnote">
        Las facturas cobradas se importan como ingreso de autónomo automáticamente. No las añadas otra vez a mano para evitar duplicarlas.
      </p>
    </section>
  );
}
