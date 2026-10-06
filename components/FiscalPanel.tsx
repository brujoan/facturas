"use client";

import { useEffect, useMemo, useState } from "react";

type InvoiceLine = {
  id: string;
  activityId: string;
  description: string;
  serviceDate?: string;
  quantity: number;
  unitPrice: number;
  vat: number;
  withholding: number;
};

type Invoice = {
  id: string;
  number: string;
  issueDate: string;
  operationDate?: string;
  invoiceMode?: "normal" | "monthly";
  periodFrom?: string;
  periodTo?: string;
  status: "Borrador" | "Emitida" | "Cobrada" | "Anulada";
  lines: InvoiceLine[];
};

type Expense = {
  id: string;
  date: string;
  supplier: string;
  taxId: string;
  concept: string;
  base: number;
  vatRate: number;
  irpfDeductiblePct: number;
  vatDeductiblePct: number;
  hasReceipt: boolean;
  notes: string;
  recurringExpenseId?: string;
  recurringMonth?: string;
  updatedAt?: string;
};

type RecurringExpense = {
  id: string;
  supplier: string;
  concept: string;
  monthlyAmount: number;
  vatRate: number;
  irpfDeductiblePct: number;
  vatDeductiblePct: number;
  startMonth: string;
  endMonth: string;
  dayOfMonth: number;
  active: boolean;
  updatedAt?: string;
};

type TaxStatus = "Pendiente" | "Presentado" | "Pagado" | "No aplica";

type TaxRecord = {
  key: string;
  year: number;
  quarter: number;
  model303: TaxStatus;
  model130: TaxStatus;
  model130Paid: number;
  notes: string;
  updatedAt?: string;
};

type Props = {
  invoices: Invoice[];
};

const EXPENSES_KEY = "facturas_expenses_v1";
const TAX_RECORDS_KEY = "facturas_tax_records_v1";
const DELETED_EXPENSES_KEY = "facturas_deleted_expenses_v1";
const RECURRING_EXPENSES_KEY = "facturas_recurring_expenses_v1";
const DELETED_RECURRING_EXPENSES_KEY = "facturas_deleted_recurring_expenses_v1";
const START_YEAR = 2026;

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

function currentQuarter() {
  return Math.floor(new Date().getMonth() / 3) + 1;
}

function quarterOf(date: string) {
  if (!date) return 1;
  const month = Number(date.slice(5, 7));
  return Math.max(1, Math.min(4, Math.ceil(month / 3)));
}

function yearOf(date: string) {
  return Number(date.slice(0, 4));
}

function currency(value: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR"
  }).format(Number.isFinite(value) ? value : 0);
}

function percent(value: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(Number.isFinite(value) ? value : 0);
}

function money(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function lineBase(line: InvoiceLine) {
  return money(Number(line.quantity || 0) * Number(line.unitPrice || 0));
}

function invoiceCountsAsIssued(invoice: Invoice) {
  return invoice.status === "Emitida" || invoice.status === "Cobrada";
}

function invoiceTaxDate(invoice: Invoice) {
  if ((invoice.invoiceMode || "normal") === "monthly") {
    return invoice.periodTo || invoice.operationDate || invoice.issueDate;
  }
  return invoice.operationDate || invoice.issueDate;
}

function deadlineISO(year: number, quarter: number) {
  if (quarter === 1) return `${year}-04-20`;
  if (quarter === 2) return `${year}-07-20`;
  if (quarter === 3) return `${year}-10-20`;
  return `${year + 1}-01-30`;
}

function deadlineLabel(year: number, quarter: number) {
  const value = new Date(`${deadlineISO(year, quarter)}T12:00:00`);
  return value.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function blankExpense(): Expense {
  return {
    id: "",
    date: todayISO(),
    supplier: "",
    taxId: "",
    concept: "",
    base: 0,
    vatRate: 21,
    irpfDeductiblePct: 100,
    vatDeductiblePct: 100,
    hasReceipt: true,
    notes: ""
  };
}

function blankRecurringExpense(): RecurringExpense {
  return {
    id: "",
    supplier: "Tesorería General de la Seguridad Social",
    concept: "Cuota autónomos",
    monthlyAmount: 200,
    vatRate: 0,
    irpfDeductiblePct: 100,
    vatDeductiblePct: 0,
    startMonth: "2026-08",
    endMonth: "",
    dayOfMonth: 30,
    active: true
  };
}

function monthKeysFrom(startMonth: string, endMonth: string) {
  if (!startMonth || !endMonth || startMonth > endMonth) return [];
  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const [endYear, endMonthNumber] = endMonth.split("-").map(Number);
  const values: string[] = [];

  let year = startYear;
  let month = startMonthNumber;
  while (year < endYear || (year === endYear && month <= endMonthNumber)) {
    values.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return values;
}

function monthKeysForQuarter(year: number, quarter: number) {
  const startMonth = (quarter - 1) * 3 + 1;
  return [0, 1, 2].map((offset) =>
    `${year}-${String(startMonth + offset).padStart(2, "0")}`
  );
}

function recurringApplies(item: RecurringExpense, monthKey: string) {
  if (!item.active) return false;
  if (item.startMonth && monthKey < item.startMonth) return false;
  if (item.endMonth && monthKey > item.endMonth) return false;
  return true;
}

function recurringExpenseId(templateId: string, monthKey: string) {
  return `recurring-${templateId}-${monthKey}`;
}

function emptyRecord(year: number, quarter: number): TaxRecord {
  return {
    key: `${year}-Q${quarter}`,
    year,
    quarter,
    model303: "Pendiente",
    model130: "Pendiente",
    model130Paid: 0,
    notes: "",
    updatedAt: ""
  };
}

function statusClass(status: TaxStatus) {
  return status.toLowerCase().replace(" ", "-");
}

function timestamp(value?: string) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeByKey<T extends { updatedAt?: string }>(
  remote: T[],
  local: T[],
  keyOf: (item: T) => string
) {
  const map = new Map<string, T>();
  remote.forEach((item) => map.set(keyOf(item), item));

  local.forEach((item) => {
    const key = keyOf(item);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item, updatedAt: item.updatedAt || nowISO() });
      return;
    }

    if (timestamp(item.updatedAt) > timestamp(existing.updatedAt)) {
      map.set(key, { ...existing, ...item });
    }
  });

  return [...map.values()];
}

export default function FiscalPanel({ invoices }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(currentQuarter());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [records, setRecords] = useState<TaxRecord[]>([]);
  const [deletedExpenseIds, setDeletedExpenseIds] = useState<string[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [deletedRecurringExpenseIds, setDeletedRecurringExpenseIds] = useState<string[]>([]);
  const [expenseDraft, setExpenseDraft] = useState<Expense>(blankExpense());
  const [recurringDraft, setRecurringDraft] = useState<RecurringExpense>(blankRecurringExpense());
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    async function loadFiscalData() {
      let loadedExpenses: Expense[] = [];
      let loadedRecords: TaxRecord[] = [];
      let loadedDeletedExpenseIds: string[] = [];

      try {
        const savedExpenses = localStorage.getItem(EXPENSES_KEY);
        const savedRecords = localStorage.getItem(TAX_RECORDS_KEY);
        const savedDeleted = localStorage.getItem(DELETED_EXPENSES_KEY);
        loadedExpenses = savedExpenses ? JSON.parse(savedExpenses) : [];
        loadedRecords = savedRecords ? JSON.parse(savedRecords) : [];
        loadedDeletedExpenseIds = savedDeleted ? JSON.parse(savedDeleted) : [];
      } catch {
        // Si falla la lectura local, intentamos recuperar desde Supabase.
      }

      const hadLocalData =
        loadedExpenses.length > 0 ||
        loadedRecords.length > 0 ||
        loadedDeletedExpenseIds.length > 0;

      try {
        const response = await fetch("/api/fiscal", { cache: "no-store" });
        const result = await response.json();
        if (response.ok && result.configured) {
          const remote = result.data || {};
          loadedDeletedExpenseIds = [...new Set([
            ...(remote.deletedExpenseIds || []),
            ...loadedDeletedExpenseIds
          ])];
          const deletedSet = new Set(loadedDeletedExpenseIds);

          loadedExpenses = mergeByKey<Expense>(
            remote.expenses || [],
            loadedExpenses,
            (item) => item.id
          ).filter((item) => !deletedSet.has(item.id));

          loadedRecords = mergeByKey<TaxRecord>(
            remote.taxRecords || [],
            loadedRecords,
            (item) => item.key
          );

          if (hadLocalData) {
            const syncResponse = await fetch("/api/fiscal", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                expenses: loadedExpenses,
                taxRecords: loadedRecords,
                deletedExpenseIds: loadedDeletedExpenseIds
              })
            });
            const synced = await syncResponse.json().catch(() => ({}));
            if (syncResponse.ok && synced.data) {
              loadedDeletedExpenseIds = [...new Set([
                ...loadedDeletedExpenseIds,
                ...(synced.data.deletedExpenseIds || [])
              ])];
              const syncedDeleted = new Set(loadedDeletedExpenseIds);
              loadedExpenses = mergeByKey<Expense>(
                synced.data.expenses || [],
                loadedExpenses,
                (item) => item.id
              ).filter((item) => !syncedDeleted.has(item.id));
              loadedRecords = mergeByKey<TaxRecord>(
                synced.data.taxRecords || [],
                loadedRecords,
                (item) => item.key
              );
            }
          }
        }
      } catch {
        // La copia local sigue disponible si la sincronización remota falla.
      }

      setExpenses(loadedExpenses);
      setRecords(loadedRecords);
      setDeletedExpenseIds(loadedDeletedExpenseIds);
      setReady(true);
    }

    void loadFiscalData();
  }, []);

  useEffect(() => {
    if (!ready) return;

    localStorage.setItem(EXPENSES_KEY, JSON.stringify(expenses));
    localStorage.setItem(TAX_RECORDS_KEY, JSON.stringify(records));
    localStorage.setItem(DELETED_EXPENSES_KEY, JSON.stringify(deletedExpenseIds));

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/fiscal", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expenses, taxRecords: records, deletedExpenseIds })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.data) return;

        const remoteDeleted = [...new Set([
          ...deletedExpenseIds,
          ...(result.data.deletedExpenseIds || [])
        ])];
        const deletedSet = new Set(remoteDeleted);
        const nextExpenses = mergeByKey<Expense>(
          result.data.expenses || [],
          expenses,
          (item) => item.id
        ).filter((item) => !deletedSet.has(item.id));
        const nextRecords = mergeByKey<TaxRecord>(
          result.data.taxRecords || [],
          records,
          (item) => item.key
        );

        if (!sameJson(remoteDeleted, deletedExpenseIds)) setDeletedExpenseIds(remoteDeleted);
        if (!sameJson(nextExpenses, expenses)) setExpenses(nextExpenses);
        if (!sameJson(nextRecords, records)) setRecords(nextRecords);
      } catch {
        // La copia local sigue siendo el respaldo inmediato del dispositivo.
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [expenses, records, deletedExpenseIds, ready]);

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;

    async function refreshFiscal() {
      if (document.visibilityState === "hidden") return;

      try {
        const response = await fetch("/api/fiscal", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.data || cancelled) return;

        const remoteDeleted = [...new Set([
          ...deletedExpenseIds,
          ...(result.data.deletedExpenseIds || [])
        ])];
        const deletedSet = new Set(remoteDeleted);
        const nextExpenses = mergeByKey<Expense>(
          result.data.expenses || [],
          expenses,
          (item) => item.id
        ).filter((item) => !deletedSet.has(item.id));
        const nextRecords = mergeByKey<TaxRecord>(
          result.data.taxRecords || [],
          records,
          (item) => item.key
        );

        if (!sameJson(remoteDeleted, deletedExpenseIds)) setDeletedExpenseIds(remoteDeleted);
        if (!sameJson(nextExpenses, expenses)) setExpenses(nextExpenses);
        if (!sameJson(nextRecords, records)) setRecords(nextRecords);
      } catch {
        // Conserva los datos locales si no hay conexión.
      }
    }

    const onFocus = () => void refreshFiscal();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void refreshFiscal(), 30000);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [ready, deletedExpenseIds, expenses, records]);

  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const values = new Set<number>();
    for (let value = START_YEAR; value <= currentYear; value += 1) values.add(value);

    invoices.forEach((invoice) => {
      const value = yearOf(invoice.issueDate);
      if (value >= START_YEAR) values.add(value);
    });
    expenses.forEach((expense) => {
      const value = yearOf(expense.date);
      if (value >= START_YEAR) values.add(value);
    });
    records.forEach((record) => {
      if (record.year >= START_YEAR) values.add(record.year);
    });

    return [...values].sort((a, b) => b - a);
  }, [invoices, expenses, records]);

  const visibleQuarters = year === START_YEAR ? [3, 4] : [1, 2, 3, 4];

  const activeRecord = useMemo(
    () => records.find((record) => record.key === `${year}-Q${quarter}`) || emptyRecord(year, quarter),
    [records, year, quarter]
  );

  const quarterInvoices = useMemo(
    () => invoices.filter(
      (invoice) => {
        const taxDate = invoiceTaxDate(invoice);
        return (
          invoiceCountsAsIssued(invoice) &&
          yearOf(taxDate) === year &&
          quarterOf(taxDate) === quarter
        );
      }
    ),
    [invoices, year, quarter]
  );

  const quarterExpenses = useMemo(
    () => expenses
      .filter((expense) => yearOf(expense.date) === year && quarterOf(expense.date) === quarter)
      .sort((a, b) => b.date.localeCompare(a.date)),
    [expenses, year, quarter]
  );

  const quarterCollectedInvoices = useMemo(
    () => quarterInvoices.filter((invoice) => invoice.status === "Cobrada"),
    [quarterInvoices]
  );

  const quarterStats = useMemo(() => {
    let incomeBase = 0;
    let vatOutput = 0;
    let withholding = 0;
    let withheldBase = 0;

    for (const invoice of quarterInvoices) {
      for (const line of invoice.lines) {
        const base = lineBase(line);
        incomeBase += base;
        vatOutput += base * (Number(line.vat || 0) / 100);
        withholding += base * (Number(line.withholding || 0) / 100);
        if (Number(line.withholding || 0) > 0) withheldBase += base;
      }
    }

    let expenseBase = 0;
    let vatInput = 0;
    let expenseCash = 0;
    for (const expense of quarterExpenses) {
      const base = Number(expense.base || 0);
      const vatRate = Number(expense.vatRate || 0);
      expenseBase += base * (Number(expense.irpfDeductiblePct || 0) / 100);
      vatInput +=
        base *
        (vatRate / 100) *
        (Number(expense.vatDeductiblePct || 0) / 100);
      expenseCash += base + base * (vatRate / 100);
    }

    let collectedCash = 0;
    for (const invoice of quarterCollectedInvoices) {
      for (const line of invoice.lines) {
        const base = lineBase(line);
        collectedCash +=
          base +
          base * (Number(line.vat || 0) / 100) -
          base * (Number(line.withholding || 0) / 100);
      }
    }

    return {
      incomeBase: money(incomeBase),
      vatOutput: money(vatOutput),
      withholding: money(withholding),
      withheldBase: money(withheldBase),
      expenseBase: money(expenseBase),
      vatInput: money(vatInput),
      expenseCash: money(expenseCash),
      collectedCash: money(collectedCash),
      net: money(incomeBase - expenseBase),
      vatResult: money(vatOutput - vatInput)
    };
  }, [quarterInvoices, quarterExpenses]);

  const cumulativeStats = useMemo(() => {
    const ytdInvoices = invoices.filter(
      (invoice) => {
        const taxDate = invoiceTaxDate(invoice);
        return (
          invoiceCountsAsIssued(invoice) &&
          yearOf(taxDate) === year &&
          quarterOf(taxDate) <= quarter
        );
      }
    );
    const ytdExpenses = expenses.filter(
      (expense) =>
        yearOf(expense.date) === year &&
        quarterOf(expense.date) <= quarter
    );

    let incomeBase = 0;
    let withholding = 0;
    for (const invoice of ytdInvoices) {
      for (const line of invoice.lines) {
        const base = lineBase(line);
        incomeBase += base;
        withholding += base * (Number(line.withholding || 0) / 100);
      }
    }

    const expenseBase = ytdExpenses.reduce(
      (sum, expense) =>
        sum + Number(expense.base || 0) * (Number(expense.irpfDeductiblePct || 0) / 100),
      0
    );

    const previous130 = records
      .filter(
        (record) =>
          record.year === year &&
          record.quarter < quarter &&
          Number(record.model130Paid || 0) > 0 &&
          ["Presentado", "Pagado"].includes(record.model130)
      )
      .reduce((sum, record) => sum + Number(record.model130Paid || 0), 0);

    const estimate = Math.max(0, (incomeBase - expenseBase) * 0.2 - withholding - previous130);

    return {
      incomeBase,
      expenseBase,
      withholding,
      previous130,
      estimate
    };
  }, [invoices, expenses, records, year, quarter]);

  const retentionRatio = quarterStats.incomeBase
    ? quarterStats.withheldBase / quarterStats.incomeBase
    : 0;

  const model130ForPocket =
    activeRecord.model130 === "No aplica"
      ? 0
      : (
          ["Presentado", "Pagado"].includes(activeRecord.model130) &&
          Number(activeRecord.model130Paid || 0) > 0
        )
        ? Number(activeRecord.model130Paid || 0)
        : cumulativeStats.estimate;

  const vatForPocket = Math.max(0, quarterStats.vatResult);

  const liquidAvailable = money(
    quarterStats.collectedCash -
    quarterStats.expenseCash -
    vatForPocket -
    model130ForPocket
  );

  const missingReceipts = quarterExpenses.filter((expense) => !expense.hasReceipt).length;

  const nextPending = useMemo(() => {
    const today = todayISO();
    const candidates: Array<{
      label: string;
      due: string;
      quarter: number;
      model: string;
      overdue: boolean;
    }> = [];

    for (const q of visibleQuarters) {
      const record = records.find((item) => item.key === `${year}-Q${q}`) || emptyRecord(year, q);
      const due = deadlineISO(year, q);

      if (!["Presentado", "Pagado", "No aplica"].includes(record.model303)) {
        candidates.push({ label: `303 · T${q}`, due, quarter: q, model: "303", overdue: due < today });
      }
      if (!["Presentado", "Pagado", "No aplica"].includes(record.model130)) {
        candidates.push({ label: `130 · T${q}`, due, quarter: q, model: "130", overdue: due < today });
      }
    }

    return candidates.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return a.due.localeCompare(b.due);
    })[0] || null;
  }, [records, year, visibleQuarters]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  function saveExpense() {
    if (!expenseDraft.date || !expenseDraft.supplier.trim() || !expenseDraft.concept.trim()) {
      return flash("Fecha, proveedor y concepto son obligatorios.");
    }

    if (Number(expenseDraft.base) < 0) return flash("La base imponible no puede ser negativa.");
    if (Number(expenseDraft.vatRate) < 0 || Number(expenseDraft.vatRate) > 100) return flash("Revisa el porcentaje de IVA.");
    if (Number(expenseDraft.irpfDeductiblePct) < 0 || Number(expenseDraft.irpfDeductiblePct) > 100) return flash("El deducible IRPF debe estar entre 0% y 100%.");
    if (Number(expenseDraft.vatDeductiblePct) < 0 || Number(expenseDraft.vatDeductiblePct) > 100) return flash("El deducible IVA debe estar entre 0% y 100%.");

    const item: Expense = {
      ...expenseDraft,
      id: expenseDraft.id || uid(),
      supplier: expenseDraft.supplier.trim(),
      taxId: expenseDraft.taxId.trim(),
      concept: expenseDraft.concept.trim(),
      base: Number(expenseDraft.base || 0),
      vatRate: Number(expenseDraft.vatRate || 0),
      irpfDeductiblePct: Number(expenseDraft.irpfDeductiblePct || 0),
      vatDeductiblePct: Number(expenseDraft.vatDeductiblePct || 0),
      updatedAt: nowISO()
    };

    setExpenses((current) =>
      expenseDraft.id
        ? current.map((expense) => (expense.id === item.id ? item : expense))
        : [...current, item]
    );
    setExpenseDraft(blankExpense());
    flash(expenseDraft.id ? "Gasto actualizado." : "Gasto registrado.");
  }

  function deleteExpense(expense: Expense) {
    if (!window.confirm(`¿Eliminar el gasto “${expense.concept}”?`)) return;
    setExpenses((current) => current.filter((item) => item.id !== expense.id));
    setDeletedExpenseIds((current) => current.includes(expense.id) ? current : [...current, expense.id]);
    if (expenseDraft.id === expense.id) setExpenseDraft(blankExpense());
    flash("Gasto eliminado.");
  }

  function updateRecord(patch: Partial<TaxRecord>) {
    const key = `${year}-Q${quarter}`;
    setRecords((current) => {
      const found = current.find((record) => record.key === key);
      const next = { ...(found || emptyRecord(year, quarter)), ...patch, key, year, quarter, updatedAt: nowISO() };
      return found
        ? current.map((record) => (record.key === key ? next : record))
        : [...current, next];
    });
  }

  if (!ready) {
    return <div className="panel">Cargando control fiscal…</div>;
  }

  return (
    <section>
      {notice && <div className="toast">{notice}</div>}

      <header className="page-header fiscal-header">
        <div>
          <p className="eyebrow">Control fiscal</p>
          <h1>Trimestrales</h1>
          <p className="muted">Facturas emitidas, gastos, IVA, retenciones y estado de tus modelos. Los borradores no computan y el trimestre se asigna por fecha de operación o fin del periodo mensual.</p>
        </div>
        <label className="year-select">
          Ejercicio
          <select
            value={year}
            onChange={(e) => {
              const nextYear = Number(e.target.value);
              setYear(nextYear);
              if (nextYear === START_YEAR && quarter < 3) setQuarter(3);
            }}
          >
            {availableYears.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
      </header>

      <div className={`fiscal-alert ${nextPending?.overdue ? "overdue" : ""}`}>
        <div>
          <strong>
            {nextPending
              ? `${nextPending.overdue ? "VENCIDO" : "Próximo pendiente"}: ${nextPending.label}`
              : "No hay modelos trimestrales pendientes en este ejercicio"}
          </strong>
          <span>
            {nextPending
              ? `Límite general: ${new Date(`${nextPending.due}T12:00:00`).toLocaleDateString("es-ES")}`
              : "Revisa igualmente las obligaciones anuales."}
          </span>
        </div>
        <span className="fiscal-alert-note">Si el último día es inhábil, el vencimiento puede desplazarse.</span>
      </div>

      {year === START_YEAR && (
        <div className="tax-warning fiscal-start-note">
          Inicio de actividad en agosto de 2026: para 2026 se muestran T3 (julio–septiembre) y T4 (octubre–diciembre).
        </div>
      )}

      <div className="quarter-grid">
        {visibleQuarters.map((q) => {
          const record = records.find((item) => item.key === `${year}-Q${q}`) || emptyRecord(year, q);
          return (
            <button
              key={q}
              className={`quarter-card ${quarter === q ? "selected" : ""}`}
              onClick={() => setQuarter(q)}
            >
              <div><strong>T{q}</strong><span>Límite {deadlineLabel(year, q)}</span></div>
              <div className="quarter-statuses">
                <span className={`tax-chip ${statusClass(record.model303)}`}>303 · {record.model303}</span>
                <span className={`tax-chip ${statusClass(record.model130)}`}>130 · {record.model130}</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="fiscal-kpis">
        <article>
          <span>Facturado · base</span>
          <strong>{currency(quarterStats.incomeBase)}</strong>
          <small>{quarterInvoices.length} facturas emitidas/cobradas</small>
        </article>
        <article className="cash-kpi">
          <span>Cobrado en cuenta</span>
          <strong>{currency(quarterStats.collectedCash)}</strong>
          <small>{quarterCollectedInvoices.length} facturas marcadas Cobrada</small>
        </article>
        <article>
          <span>IVA repercutido</span>
          <strong>{currency(quarterStats.vatOutput)}</strong>
          <small>Facturas emitidas</small>
        </article>
        <article>
          <span>IVA deducible</span>
          <strong>{currency(quarterStats.vatInput)}</strong>
          <small>{quarterExpenses.length} gastos</small>
        </article>
        <article>
          <span>303 estimado</span>
          <strong>{currency(quarterStats.vatResult)}</strong>
          <small>{quarterStats.vatResult < 0 ? "A compensar aprox." : "A ingresar aprox."}</small>
        </article>
        <article>
          <span>IRPF retenido</span>
          <strong>{currency(quarterStats.withholding)}</strong>
          <small>{percent(retentionRatio)} de base con retención</small>
        </article>
        <article>
          <span>Rendimiento fiscal aprox.</span>
          <strong>{currency(quarterStats.net)}</strong>
          <small>Base facturada − gasto deducible</small>
        </article>
        <article className="liquid-kpi">
          <span>Líquido disponible estimado</span>
          <strong>{currency(liquidAvailable)}</strong>
          <small>Cobrado − gastos − 303 − 130</small>
        </article>
      </div>

      <div className="fiscal-money-guide">
        <strong>Qué significa cada cifra</strong>
        <div>
          <span><b>Facturado</b> es la base de las facturas emitidas/cobradas del trimestre.</span>
          <span><b>Cobrado</b> es el total neto de las facturas del trimestre que has marcado como Cobrada (base + IVA − IRPF).</span>
          <span><b>Rendimiento</b> es el beneficio fiscal aproximado: base facturada − gastos deducibles.</span>
          <span><b>Líquido disponible</b> estima lo que podrías considerar “para ti”: cobrado − gasto total registrado − IVA a ingresar − 130 estimado.</span>
        </div>
        <small>El líquido es orientativo: asume que los gastos registrados están pagados y que “Cobrada” refleja dinero ya recibido. No sustituye al saldo real del banco.</small>
      </div>

      <div className="tax-model-grid">
        <article className="panel tax-model-card">
          <div className="tax-model-head">
            <div>
              <p className="eyebrow">IVA</p>
              <h2>Modelo 303 · T{quarter}</h2>
            </div>
            <span className={`tax-chip large ${statusClass(activeRecord.model303)}`}>{activeRecord.model303}</span>
          </div>
          <div className="tax-calc">
            <div><span>IVA repercutido</span><strong>{currency(quarterStats.vatOutput)}</strong></div>
            <div><span>IVA deducible registrado</span><strong>− {currency(quarterStats.vatInput)}</strong></div>
            <div className="tax-calc-total"><span>Resultado orientativo</span><strong>{currency(quarterStats.vatResult)}</strong></div>
          </div>
          <label>Estado
            <select value={activeRecord.model303} onChange={(e) => updateRecord({ model303: e.target.value as TaxStatus })}>
              <option>Pendiente</option><option>Presentado</option><option>Pagado</option><option>No aplica</option>
            </select>
          </label>
          <p className="fiscal-footnote">Plazo general: 1–20 de abril, julio y octubre; T4, 1–30 de enero.</p>
        </article>

        <article className="panel tax-model-card">
          <div className="tax-model-head">
            <div>
              <p className="eyebrow">IRPF</p>
              <h2>Modelo 130 · T{quarter}</h2>
            </div>
            <span className={`tax-chip large ${statusClass(activeRecord.model130)}`}>{activeRecord.model130}</span>
          </div>
          <div className="tax-calc">
            <div><span>Ingresos acumulados</span><strong>{currency(cumulativeStats.incomeBase)}</strong></div>
            <div><span>Gastos deducibles acumulados</span><strong>− {currency(cumulativeStats.expenseBase)}</strong></div>
            <div><span>Retenciones acumuladas</span><strong>− {currency(cumulativeStats.withholding)}</strong></div>
            <div><span>130 pagados anteriores</span><strong>− {currency(cumulativeStats.previous130)}</strong></div>
            <div className="tax-calc-total"><span>Estimación orientativa</span><strong>{currency(cumulativeStats.estimate)}</strong></div>
          </div>
          {retentionRatio >= 0.7 && (
            <div className="tax-warning">En este trimestre, al menos el 70% de la base registrada lleva retención. Si corresponde a actividad profesional y cumples los requisitos, revisa si estás exento de presentar el 130.</div>
          )}
          <div className="form-grid two compact">
            <label>Estado
              <select value={activeRecord.model130} onChange={(e) => updateRecord({ model130: e.target.value as TaxStatus })}>
                <option>Pendiente</option><option>Presentado</option><option>Pagado</option><option>No aplica</option>
              </select>
            </label>
            <label>Importe 130 pagado
              <input type="number" min="0" step="0.01" value={activeRecord.model130Paid} onChange={(e) => updateRecord({ model130Paid: Number(e.target.value) })} />
            </label>
          </div>
          <p className="fiscal-footnote">El 130 usa importes acumulados desde enero. La cifra mostrada es de control, no sustituye la autoliquidación.</p>
        </article>
      </div>

      <div className="split-layout fiscal-expense-layout">
        <div className="panel">
          <div className="section-title">
            <div>
              <h2>{expenseDraft.id ? "Editar gasto" : "Registrar gasto / factura recibida"}</h2>
              <p className="muted">Guarda base, IVA y porcentaje deducible para preparar los trimestrales.</p>
            </div>
          </div>

          <div className="form-grid two">
            <label>Fecha<input type="date" value={expenseDraft.date} onChange={(e) => setExpenseDraft({ ...expenseDraft, date: e.target.value })} /></label>
            <label>Proveedor<input value={expenseDraft.supplier} onChange={(e) => setExpenseDraft({ ...expenseDraft, supplier: e.target.value })} placeholder="Empresa o proveedor" /></label>
            <label>NIF / CIF proveedor<input value={expenseDraft.taxId} onChange={(e) => setExpenseDraft({ ...expenseDraft, taxId: e.target.value })} /></label>
            <label>Concepto<input value={expenseDraft.concept} onChange={(e) => setExpenseDraft({ ...expenseDraft, concept: e.target.value })} placeholder="Drive, SSD, desplazamiento…" /></label>
            <label>Base imponible<input type="number" min="0" step="0.01" value={expenseDraft.base} onChange={(e) => setExpenseDraft({ ...expenseDraft, base: Number(e.target.value) })} /></label>
            <label>IVA %<input type="number" min="0" step="0.01" value={expenseDraft.vatRate} onChange={(e) => setExpenseDraft({ ...expenseDraft, vatRate: Number(e.target.value) })} /></label>
            <label>Deducible IRPF %<input type="number" min="0" max="100" step="1" value={expenseDraft.irpfDeductiblePct} onChange={(e) => setExpenseDraft({ ...expenseDraft, irpfDeductiblePct: Number(e.target.value) })} /></label>
            <label>Deducible IVA %<input type="number" min="0" max="100" step="1" value={expenseDraft.vatDeductiblePct} onChange={(e) => setExpenseDraft({ ...expenseDraft, vatDeductiblePct: Number(e.target.value) })} /></label>
            <label className="receipt-check">
              <input type="checkbox" checked={expenseDraft.hasReceipt} onChange={(e) => setExpenseDraft({ ...expenseDraft, hasReceipt: e.target.checked })} />
              Justificante / factura guardado
            </label>
            <label className="span-2">Notas
              <textarea rows={3} value={expenseDraft.notes} onChange={(e) => setExpenseDraft({ ...expenseDraft, notes: e.target.value })} placeholder="Motivo del gasto, bolo relacionado, criterio de deducción…" />
            </label>
          </div>

          <div className="client-form-actions">
            <button className="button primary" onClick={saveExpense}>{expenseDraft.id ? "Guardar cambios" : "Añadir gasto"}</button>
            {expenseDraft.id && <button className="button secondary" onClick={() => setExpenseDraft(blankExpense())}>Cancelar</button>}
          </div>
        </div>

        <div className="panel">
          <div className="section-title">
            <div>
              <h2>Gastos de T{quarter}</h2>
              <p className="muted">{missingReceipts ? `${missingReceipts} sin justificante marcado` : "Todos con justificante marcado"}</p>
            </div>
          </div>
          <div className="expense-list">
            {quarterExpenses.length === 0 && <p className="muted">No hay gastos registrados en este trimestre.</p>}
            {quarterExpenses.map((expense) => {
              const vatAmount = expense.base * (expense.vatRate / 100);
              const deductibleVat = vatAmount * (expense.vatDeductiblePct / 100);
              return (
                <article className="expense-card" key={expense.id}>
                  <div className="expense-main">
                    <div>
                      <strong>{expense.concept}</strong>
                      <span>{expense.supplier} · {expense.date}</span>
                    </div>
                    <strong>{currency(expense.base + vatAmount)}</strong>
                  </div>
                  <div className="expense-meta">
                    <span>Base {currency(expense.base)}</span>
                    <span>IVA ded. {currency(deductibleVat)}</span>
                    <span>IRPF ded. {expense.irpfDeductiblePct}%</span>
                    <span className={expense.hasReceipt ? "receipt-ok" : "receipt-missing"}>{expense.hasReceipt ? "Justificante ✓" : "Falta justificante"}</span>
                  </div>
                  {expense.notes && <p>{expense.notes}</p>}
                  <div className="expense-actions">
                    <button className="button small secondary" onClick={() => setExpenseDraft(expense)}>Editar</button>
                    <button className="danger-link" onClick={() => deleteExpense(expense)}>Eliminar</button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <div className="panel fiscal-notes-panel">
        <div className="section-title">
          <div><h2>Notas del trimestre</h2><p className="muted">Apunta incidencias, documentación pendiente o lo que quieras revisar antes de presentar.</p></div>
        </div>
        <textarea rows={4} value={activeRecord.notes} onChange={(e) => updateRecord({ notes: e.target.value })} placeholder="Ej.: revisar gasolina del bolo del 12/09, falta factura del SSD…" />
      </div>

      <div className="panel annual-checklist">
        <h2>Revisión anual</h2>
        <div>
          <span><strong>Renta anual</strong><small>Regulariza el IRPF del ejercicio.</small></span>
          <span><strong>Modelo 390</strong><small>Revisar si te corresponde o estás exonerado.</small></span>
          <span><strong>Archivo</strong><small>Conserva facturas emitidas, recibidas y justificantes.</small></span>
        </div>
        <p className="legal-note">Este panel es un control administrativo. Las estimaciones dependen de que los datos y porcentajes de deducción sean correctos y no sustituyen la presentación ante la AEAT.</p>
      </div>
    </section>
  );
}
