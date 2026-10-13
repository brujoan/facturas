"use client";

import { useEffect, useMemo, useState } from "react";

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

type ExpenseField =
  | "monthlyPayments"
  | "insurance"
  | "leisure"
  | "sport"
  | "freelanceExpense"
  | "extraExpense";

type BreakdownItem = {
  id: string;
  concept: string;
  amount: number;
};

type AccountMonth = {
  id: string;
  salary: number;
  extraIncome: number;
  extraIncomeReason: string;
  monthlyPayments: number;
  insurance: number;
  leisure: number;
  sport: number;
  freelanceExpense: number;
  extraExpense: number;
  extraExpenseReason: string;
  breakdowns?: Partial<Record<ExpenseField, BreakdownItem[]>>;
  updatedAt?: string;
};

type LegacyMovement = {
  id?: string;
  date?: string;
  type?: "income" | "expense";
  category?: string;
  concept?: string;
  amount?: number;
};

type Props = {
  invoices: Invoice[];
  amountsVisible: boolean;
  onToggleAmounts: () => void;
};

type BreakdownEditor = {
  monthId: string;
  monthName: string;
  field: ExpenseField;
  title: string;
  items: BreakdownItem[];
};

const MONTHS_KEY = "facturas_personal_account_months_v2";
const LEGACY_MOVEMENTS_KEY = "facturas_personal_movements_v1";

const monthNames = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
];

function nowISO() {
  return new Date().toISOString();
}

function currentYear() {
  return new Date().getFullYear();
}

function uid() {
  return crypto.randomUUID();
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

function timestamp(value?: string) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function blankMonth(id: string): AccountMonth {
  return {
    id,
    salary: 0,
    extraIncome: 0,
    extraIncomeReason: "",
    monthlyPayments: 0,
    insurance: 0,
    leisure: 0,
    sport: 0,
    freelanceExpense: 0,
    extraExpense: 0,
    extraExpenseReason: "",
    breakdowns: {}
  };
}

function mergeById(remote: AccountMonth[], local: AccountMonth[]) {
  const map = new Map<string, AccountMonth>();

  for (const item of remote) {
    if (item?.id) map.set(item.id, { ...blankMonth(item.id), ...item });
  }

  for (const item of local) {
    if (!item?.id) continue;
    const existing = map.get(item.id);
    if (!existing || timestamp(item.updatedAt) > timestamp(existing.updatedAt)) {
      map.set(item.id, { ...blankMonth(item.id), ...item });
    }
  }

  return [...map.values()];
}

function invoiceFreelanceIncomeWithoutVat(invoice: Invoice) {
  return money(invoice.lines.reduce((sum, line) => {
    const base = Number(line.quantity || 0) * Number(line.unitPrice || 0);
    const withholding = base * (Number(line.withholding || 0) / 100);
    return sum + base - withholding;
  }, 0));
}

function appendReason(current: string, next: string) {
  const clean = next.trim();
  if (!clean) return current;
  if (!current) return clean;
  if (current.includes(clean)) return current;
  return `${current}; ${clean}`;
}

function migrateLegacy(movements: LegacyMovement[]): AccountMonth[] {
  const map = new Map<string, AccountMonth>();

  for (const movement of movements) {
    const monthId = String(movement.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthId)) continue;

    const row = map.get(monthId) || blankMonth(monthId);
    const amount = Number(movement.amount || 0);
    const category = String(movement.category || "");
    const concept = String(movement.concept || "");

    if (movement.type === "income") {
      if (category === "Nómina") {
        row.salary = money(row.salary + amount);
      } else if (category !== "Autónomo") {
        row.extraIncome = money(row.extraIncome + amount);
        row.extraIncomeReason = appendReason(row.extraIncomeReason, concept || category);
      }
    } else if (movement.type === "expense") {
      if (category === "Ocio") {
        row.leisure = money(row.leisure + amount);
      } else if (category === "Autónomo") {
        row.freelanceExpense = money(row.freelanceExpense + amount);
      } else {
        row.extraExpense = money(row.extraExpense + amount);
        row.extraExpenseReason = appendReason(row.extraExpenseReason, concept || category);
      }
    }

    row.updatedAt = nowISO();
    map.set(monthId, row);
  }

  return [...map.values()];
}

export default function PersonalFinancePanel({ invoices, amountsVisible, onToggleAmounts }: Props) {
  const [year, setYear] = useState(currentYear());
  const [months, setMonths] = useState<AccountMonth[]>([]);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"local" | "saving" | "saved" | "error">("local");
  const [breakdownEditor, setBreakdownEditor] = useState<BreakdownEditor | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let loadedMonths: AccountMonth[] = [];
      let legacyMovements: LegacyMovement[] = [];

      try {
        loadedMonths = JSON.parse(localStorage.getItem(MONTHS_KEY) || "[]");
        legacyMovements = JSON.parse(localStorage.getItem(LEGACY_MOVEMENTS_KEY) || "[]");
      } catch {
        // Si falla la copia local, intentamos recuperar la remota.
      }

      try {
        const response = await fetch("/api/personal", { cache: "no-store" });
        const result = await response.json();

        if (response.ok && result.configured && result.data) {
          loadedMonths = mergeById(result.data.accountMonths || [], loadedMonths);
          legacyMovements = [
            ...(Array.isArray(result.data.movements) ? result.data.movements : []),
            ...legacyMovements
          ];
          setSyncStatus("saved");
        }
      } catch {
        setSyncStatus("error");
      }

      if (loadedMonths.length === 0 && legacyMovements.length > 0) {
        loadedMonths = migrateLegacy(legacyMovements);
      }

      if (!cancelled) {
        setMonths(loadedMonths);
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

    localStorage.setItem(MONTHS_KEY, JSON.stringify(months));

    const timer = window.setTimeout(async () => {
      try {
        setSyncStatus("saving");
        const response = await fetch("/api/personal", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountMonths: months })
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.data) {
          setSyncStatus("error");
          return;
        }

        const merged = mergeById(result.data.accountMonths || [], months);
        if (JSON.stringify(merged) !== JSON.stringify(months)) {
          setMonths(merged);
        }
        setSyncStatus("saved");
      } catch {
        setSyncStatus("error");
      }
    }, 650);

    return () => window.clearTimeout(timer);
  }, [months, ready]);

  const freelanceByMonth = useMemo(() => {
    const totals = new Map<string, number>();

    for (const invoice of invoices) {
      if (invoice.status !== "Cobrada") continue;
      const date = invoice.collectionDate || invoice.issueDate;
      const monthId = date.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(monthId)) continue;
      totals.set(
        monthId,
        money((totals.get(monthId) || 0) + invoiceFreelanceIncomeWithoutVat(invoice))
      );
    }

    return totals;
  }, [invoices]);

  const rows = useMemo(() => {
    return monthNames.map((name, index) => {
      const id = `${year}-${String(index + 1).padStart(2, "0")}`;
      const stored = months.find((item) => item.id === id) || blankMonth(id);
      const freelance = freelanceByMonth.get(id) || 0;
      const totalIncome = money(stored.salary + freelance + stored.extraIncome);
      const totalExpense = money(
        stored.monthlyPayments +
        stored.insurance +
        stored.leisure +
        stored.sport +
        stored.freelanceExpense +
        stored.extraExpense
      );
      const savings = money(totalIncome - totalExpense);

      return {
        ...stored,
        name,
        freelance,
        totalIncome,
        totalExpense,
        savings
      };
    });
  }, [year, months, freelanceByMonth]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => ({
        salary: money(acc.salary + row.salary),
        freelance: money(acc.freelance + row.freelance),
        extraIncome: money(acc.extraIncome + row.extraIncome),
        totalIncome: money(acc.totalIncome + row.totalIncome),
        monthlyPayments: money(acc.monthlyPayments + row.monthlyPayments),
        insurance: money(acc.insurance + row.insurance),
        leisure: money(acc.leisure + row.leisure),
        sport: money(acc.sport + row.sport),
        freelanceExpense: money(acc.freelanceExpense + row.freelanceExpense),
        extraExpense: money(acc.extraExpense + row.extraExpense),
        totalExpense: money(acc.totalExpense + row.totalExpense),
        savings: money(acc.savings + row.savings)
      }),
      {
        salary: 0,
        freelance: 0,
        extraIncome: 0,
        totalIncome: 0,
        monthlyPayments: 0,
        insurance: 0,
        leisure: 0,
        sport: 0,
        freelanceExpense: 0,
        extraExpense: 0,
        totalExpense: 0,
        savings: 0
      }
    );
  }, [rows]);

  function setField<K extends keyof AccountMonth>(
    monthId: string,
    field: K,
    value: AccountMonth[K]
  ) {
    setMonths((current) => {
      const index = current.findIndex((item) => item.id === monthId);
      const base = index >= 0 ? current[index] : blankMonth(monthId);
      const next = {
        ...base,
        [field]: value,
        updatedAt: nowISO()
      };

      if (index < 0) return [...current, next];
      return current.map((item, itemIndex) => itemIndex === index ? next : item);
    });
  }

  function setExpenseAmount(monthId: string, field: ExpenseField, value: number) {
    setMonths((current) => {
      const index = current.findIndex((item) => item.id === monthId);
      const base = index >= 0 ? current[index] : blankMonth(monthId);
      const nextBreakdowns = { ...(base.breakdowns || {}) };
      delete nextBreakdowns[field];

      const next: AccountMonth = {
        ...base,
        [field]: value,
        breakdowns: nextBreakdowns,
        updatedAt: nowISO()
      };

      if (index < 0) return [...current, next];
      return current.map((item, itemIndex) => itemIndex === index ? next : item);
    });
  }

  function amountCell(
    monthId: string,
    field: "salary" | "extraIncome",
    value: number,
    label: string
  ) {
    if (!amountsVisible) {
      return <span className="accounts-hidden">••••</span>;
    }

    return (
      <input
        className="accounts-money-input"
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        value={value || ""}
        placeholder="0"
        aria-label={label}
        onChange={(e) => setField(monthId, field, Number(e.target.value || 0))}
      />
    );
  }

  function openBreakdown(
    monthId: string,
    monthName: string,
    field: ExpenseField,
    title: string,
    currentValue: number
  ) {
    const stored = months.find((item) => item.id === monthId);
    const existing = stored?.breakdowns?.[field] || [];
    const items = existing.length
      ? existing.map((item) => ({ ...item }))
      : currentValue > 0
        ? [{ id: uid(), concept: "Sin desglosar", amount: currentValue }]
        : [{ id: uid(), concept: "", amount: 0 }];

    setBreakdownEditor({
      monthId,
      monthName,
      field,
      title,
      items
    });
  }

  function expenseCell(
    monthId: string,
    monthName: string,
    field: ExpenseField,
    title: string,
    value: number
  ) {
    const stored = months.find((item) => item.id === monthId);
    const hasBreakdown = Boolean(stored?.breakdowns?.[field]?.length);

    return (
      <div className="accounts-expense-cell">
        {amountsVisible ? (
          <input
            className="accounts-money-input"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={value || ""}
            placeholder="0"
            aria-label={`${title} de ${monthName}`}
            onChange={(e) => setExpenseAmount(monthId, field, Number(e.target.value || 0))}
          />
        ) : (
          <span className="accounts-hidden">••••</span>
        )}
        <button
          type="button"
          className={`accounts-breakdown-button ${hasBreakdown ? "active" : ""}`}
          onClick={() => openBreakdown(monthId, monthName, field, title, value)}
          aria-label={`Desglosar ${title} de ${monthName}`}
          title="Ver o editar desglose"
        >
          ≡
        </button>
      </div>
    );
  }

  function updateBreakdownItem(id: string, patch: Partial<BreakdownItem>) {
    setBreakdownEditor((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item)
          }
        : current
    );
  }

  function addBreakdownItem() {
    setBreakdownEditor((current) =>
      current
        ? {
            ...current,
            items: [...current.items, { id: uid(), concept: "", amount: 0 }]
          }
        : current
    );
  }

  function removeBreakdownItem(id: string) {
    setBreakdownEditor((current) =>
      current
        ? {
            ...current,
            items: current.items.filter((item) => item.id !== id)
          }
        : current
    );
  }

  function saveBreakdown() {
    if (!breakdownEditor) return;

    const items = breakdownEditor.items
      .map((item) => ({
        ...item,
        concept: item.concept.trim(),
        amount: money(Number(item.amount || 0))
      }))
      .filter((item) => item.concept || item.amount > 0);

    const total = money(items.reduce((sum, item) => sum + item.amount, 0));

    setMonths((current) => {
      const index = current.findIndex((item) => item.id === breakdownEditor.monthId);
      const base = index >= 0 ? current[index] : blankMonth(breakdownEditor.monthId);
      const next: AccountMonth = {
        ...base,
        [breakdownEditor.field]: total,
        breakdowns: {
          ...(base.breakdowns || {}),
          [breakdownEditor.field]: items
        },
        updatedAt: nowISO()
      };

      if (index < 0) return [...current, next];
      return current.map((item, itemIndex) => itemIndex === index ? next : item);
    });

    setBreakdownEditor(null);
  }

  function shown(value: number) {
    return amountsVisible ? currency(value) : "•••• €";
  }

  if (!ready) {
    return <div className="panel">Cargando tus cuentas…</div>;
  }

  const breakdownTotal = breakdownEditor
    ? money(breakdownEditor.items.reduce((sum, item) => sum + Number(item.amount || 0), 0))
    : 0;

  return (
    <section className="accounts-ledger-page">
      <header className="page-header accounts-ledger-header">
        <div>
          <p className="eyebrow">Finanzas personales</p>
          <h1>Cuentas</h1>
          <p className="muted">Una fila por mes. Igual que tu hoja anual de Excel.</p>
        </div>

        <div className="accounts-header-actions">
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

      <div className="accounts-yearbar panel">
        <button
          className="accounts-year-arrow"
          onClick={() => setYear((current) => current - 1)}
          aria-label="Año anterior"
        >
          ‹
        </button>
        <input
          type="number"
          min="2000"
          max="2100"
          value={year}
          onChange={(e) => setYear(Number(e.target.value) || currentYear())}
          aria-label="Año"
        />
        <button
          className="accounts-year-arrow"
          onClick={() => setYear((current) => current + 1)}
          aria-label="Año siguiente"
        >
          ›
        </button>
        {year !== currentYear() && (
          <button className="accounts-current-year" onClick={() => setYear(currentYear())}>
            Año actual
          </button>
        )}
      </div>

      <div className="accounts-table-panel panel">
        <div className="accounts-table-scroll">
          <table className="accounts-table">
            <thead>
              <tr className="accounts-group-row">
                <th rowSpan={2}>Mes</th>
                <th colSpan={5}>Ingresos</th>
                <th colSpan={8}>Gastos</th>
                <th rowSpan={2}>Ahorro</th>
              </tr>
              <tr>
                <th>Nóm.</th>
                <th>Autón.</th>
                <th>Ing. extra</th>
                <th className="accounts-reason-col">Motivo ing.</th>
                <th>Ing. total</th>
                <th>Mens.</th>
                <th>Seg.</th>
                <th>Ocio</th>
                <th>Dep.</th>
                <th>Autón.</th>
                <th>G. extra</th>
                <th className="accounts-reason-col">Motivo g.</th>
                <th>G. total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.id === new Date().toISOString().slice(0, 7) ? "current-month" : ""}>
                  <th>{row.name}</th>
                  <td>{amountCell(row.id, "salary", row.salary, `Nómina de ${row.name}`)}</td>
                  <td className="accounts-auto-cell" title="Facturas cobradas, sin IVA">
                    <strong>{shown(row.freelance)}</strong>
                    <small>sin IVA</small>
                  </td>
                  <td>{amountCell(row.id, "extraIncome", row.extraIncome, `Ingreso extra de ${row.name}`)}</td>
                  <td className="accounts-reason-cell">
                    <input
                      type="text"
                      value={row.extraIncomeReason}
                      placeholder="Motivo"
                      aria-label={`Motivo del ingreso extra de ${row.name}`}
                      onChange={(e) => setField(row.id, "extraIncomeReason", e.target.value)}
                    />
                  </td>
                  <td className="accounts-total income">{shown(row.totalIncome)}</td>
                  <td>{expenseCell(row.id, row.name, "monthlyPayments", "Mensualidades", row.monthlyPayments)}</td>
                  <td>{expenseCell(row.id, row.name, "insurance", "Seguros", row.insurance)}</td>
                  <td>{expenseCell(row.id, row.name, "leisure", "Ocio", row.leisure)}</td>
                  <td>{expenseCell(row.id, row.name, "sport", "Deporte", row.sport)}</td>
                  <td>{expenseCell(row.id, row.name, "freelanceExpense", "Autónomo", row.freelanceExpense)}</td>
                  <td>{expenseCell(row.id, row.name, "extraExpense", "Gasto extra", row.extraExpense)}</td>
                  <td className="accounts-reason-cell">
                    <input
                      type="text"
                      value={row.extraExpenseReason}
                      placeholder="Motivo"
                      aria-label={`Motivo del gasto extra de ${row.name}`}
                      onChange={(e) => setField(row.id, "extraExpenseReason", e.target.value)}
                    />
                  </td>
                  <td className="accounts-total expense">{shown(row.totalExpense)}</td>
                  <td className={`accounts-savings ${row.savings < 0 ? "negative" : ""}`}>
                    {shown(row.savings)}
                  </td>
                </tr>
              ))}

              <tr className="accounts-year-total">
                <th>TOTAL {year}</th>
                <td>{shown(totals.salary)}</td>
                <td>{shown(totals.freelance)}</td>
                <td>{shown(totals.extraIncome)}</td>
                <td>—</td>
                <td>{shown(totals.totalIncome)}</td>
                <td>{shown(totals.monthlyPayments)}</td>
                <td>{shown(totals.insurance)}</td>
                <td>{shown(totals.leisure)}</td>
                <td>{shown(totals.sport)}</td>
                <td>{shown(totals.freelanceExpense)}</td>
                <td>{shown(totals.extraExpense)}</td>
                <td>—</td>
                <td>{shown(totals.totalExpense)}</td>
                <td className={totals.savings < 0 ? "negative" : ""}>{shown(totals.savings)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="accounts-mobile-list">
        {rows.map((row) => (
          <article
            key={`mobile-${row.id}`}
            className={`accounts-mobile-month ${row.id === new Date().toISOString().slice(0, 7) ? "current-month" : ""}`}
          >
            <header>
              <strong>{row.name}</strong>
              <span className={row.savings < 0 ? "negative" : ""}>
                Ahorro {shown(row.savings)}
              </span>
            </header>

            <div className="accounts-mobile-section">
              <h3>Ingresos</h3>
              <div className="accounts-mobile-grid">
                <label>Nómina{amountCell(row.id, "salary", row.salary, `Nómina de ${row.name}`)}</label>
                <label className="accounts-mobile-auto">Autónomo <small>sin IVA</small><span>{shown(row.freelance)}</span></label>
                <label>Ingreso extra{amountCell(row.id, "extraIncome", row.extraIncome, `Ingreso extra de ${row.name}`)}</label>
                <label className="wide">
                  Motivo ingreso extra
                  <input
                    type="text"
                    value={row.extraIncomeReason}
                    placeholder="Motivo"
                    onChange={(e) => setField(row.id, "extraIncomeReason", e.target.value)}
                  />
                </label>
              </div>
              <div className="accounts-mobile-total income">
                <span>Ingreso total</span>
                <strong>{shown(row.totalIncome)}</strong>
              </div>
            </div>

            <div className="accounts-mobile-section">
              <h3>Gastos</h3>
              <div className="accounts-mobile-grid">
                <label>Mensualidades{expenseCell(row.id, row.name, "monthlyPayments", "Mensualidades", row.monthlyPayments)}</label>
                <label>Seguros{expenseCell(row.id, row.name, "insurance", "Seguros", row.insurance)}</label>
                <label>Ocio{expenseCell(row.id, row.name, "leisure", "Ocio", row.leisure)}</label>
                <label>Deporte{expenseCell(row.id, row.name, "sport", "Deporte", row.sport)}</label>
                <label>Autónomo{expenseCell(row.id, row.name, "freelanceExpense", "Autónomo", row.freelanceExpense)}</label>
                <label>Gasto extra{expenseCell(row.id, row.name, "extraExpense", "Gasto extra", row.extraExpense)}</label>
                <label className="wide">
                  Motivo gasto extra
                  <input
                    type="text"
                    value={row.extraExpenseReason}
                    placeholder="Motivo"
                    onChange={(e) => setField(row.id, "extraExpenseReason", e.target.value)}
                  />
                </label>
              </div>
              <div className="accounts-mobile-total expense">
                <span>Gasto total</span>
                <strong>{shown(row.totalExpense)}</strong>
              </div>
            </div>
          </article>
        ))}

        <article className="accounts-mobile-year-total">
          <strong>TOTAL {year}</strong>
          <div><span>Ingresos</span><b>{shown(totals.totalIncome)}</b></div>
          <div><span>Gastos</span><b>{shown(totals.totalExpense)}</b></div>
          <div className={totals.savings < 0 ? "negative" : ""}><span>Ahorro</span><b>{shown(totals.savings)}</b></div>
        </article>
      </div>

      <p className="accounts-note">
        Ingreso Autónomo = facturas cobradas menos IVA. En los gastos, pulsa ≡ para ver o editar de qué se compone cada importe.
      </p>

      {breakdownEditor && (
        <div className="accounts-breakdown-overlay" onMouseDown={() => setBreakdownEditor(null)}>
          <section
            className="accounts-breakdown-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Desglose de ${breakdownEditor.title}`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">{breakdownEditor.monthName} · {year}</p>
                <h2>{breakdownEditor.title}</h2>
              </div>
              <button className="accounts-breakdown-close" onClick={() => setBreakdownEditor(null)} aria-label="Cerrar">×</button>
            </header>

            <div className="accounts-breakdown-list">
              {breakdownEditor.items.map((item) => (
                <div className="accounts-breakdown-row" key={item.id}>
                  <input
                    type="text"
                    value={item.concept}
                    placeholder="Concepto"
                    aria-label="Concepto"
                    onChange={(e) => updateBreakdownItem(item.id, { concept: e.target.value })}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={item.amount || ""}
                    placeholder="0"
                    aria-label="Importe"
                    onChange={(e) => updateBreakdownItem(item.id, { amount: Number(e.target.value || 0) })}
                  />
                  <button
                    className="accounts-breakdown-delete"
                    onClick={() => removeBreakdownItem(item.id)}
                    aria-label="Eliminar concepto"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button className="accounts-breakdown-add" onClick={addBreakdownItem}>
              + Añadir concepto
            </button>

            <footer>
              <div>
                <span>Total</span>
                <strong>{currency(breakdownTotal)}</strong>
              </div>
              <button className="button secondary" onClick={() => setBreakdownEditor(null)}>Cancelar</button>
              <button className="button primary" onClick={saveBreakdown}>Guardar desglose</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
