"use client";

import { useEffect, useMemo, useState } from "react";

type Status = "Borrador" | "Emitida" | "Cobrada" | "Anulada";

type InvoiceLine = {
  id: string;
  description: string;
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
  periodTo?: string;
  collectionDate?: string;
  clientId: string;
  status: Status;
  lines: InvoiceLine[];
};

type Client = {
  id: string;
  name: string;
};

type Expense = {
  id: string;
  date: string;
  supplier: string;
  concept: string;
  base: number;
  vatRate: number;
  irpfDeductiblePct: number;
  vatDeductiblePct: number;
  hasReceipt: boolean;
  updatedAt?: string;
};

type PeriodMode = "month" | "year" | "range";

type Props = {
  invoices: Invoice[];
  clients: Client[];
  amountsVisible: boolean;
  onToggleAmounts: () => void;
  onOpenFiscal: () => void;
};

const EXPENSES_KEY = "facturas_expenses_v1";
const DELETED_EXPENSES_KEY = "facturas_deleted_expenses_v1";

function todayISO() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
}

function monthRange(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    from: `${year}-${String(month).padStart(2, "0")}-01`,
    to: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  };
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

function lineBase(line: InvoiceLine) {
  return money(Number(line.quantity || 0) * Number(line.unitPrice || 0));
}

function invoiceDate(invoice: Invoice) {
  if ((invoice.invoiceMode || "normal") === "monthly") {
    return invoice.periodTo || invoice.operationDate || invoice.issueDate;
  }
  return invoice.operationDate || invoice.issueDate;
}

function timestamp(value?: string) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeExpenses(remote: Expense[], local: Expense[], deletedIds: string[]) {
  const deleted = new Set(deletedIds);
  const map = new Map<string, Expense>();

  for (const expense of remote) {
    if (expense?.id && !deleted.has(expense.id)) map.set(expense.id, expense);
  }

  for (const expense of local) {
    if (!expense?.id || deleted.has(expense.id)) continue;
    const existing = map.get(expense.id);
    if (!existing || timestamp(expense.updatedAt) > timestamp(existing.updatedAt)) {
      map.set(expense.id, expense);
    }
  }

  return [...map.values()];
}

export default function FinancePanel({
  invoices,
  clients,
  amountsVisible,
  onToggleAmounts,
  onOpenFiscal
}: Props) {
  const currentDate = todayISO();
  const currentYear = currentDate.slice(0, 4);
  const currentMonth = currentDate.slice(0, 7);

  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);
  const [range, setRange] = useState(() => monthRange(currentMonth));
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadExpenses() {
      let localExpenses: Expense[] = [];
      let localDeleted: string[] = [];

      try {
        localExpenses = JSON.parse(localStorage.getItem(EXPENSES_KEY) || "[]");
        localDeleted = JSON.parse(localStorage.getItem(DELETED_EXPENSES_KEY) || "[]");
      } catch {
        // Seguimos con la copia remota si el almacenamiento local está dañado.
      }

      let merged = mergeExpenses([], localExpenses, localDeleted);

      try {
        const response = await fetch("/api/fiscal", { cache: "no-store" });
        const result = await response.json();
        if (response.ok && result.configured && result.data) {
          const remoteDeleted = [
            ...new Set([...(result.data.deletedExpenseIds || []), ...localDeleted])
          ];
          merged = mergeExpenses(result.data.expenses || [], localExpenses, remoteDeleted);
        }
      } catch {
        // La vista puede funcionar con la copia local.
      }

      if (!cancelled) {
        setExpenses(merged);
        setReady(true);
      }
    }

    void loadExpenses();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeRange = useMemo(() => {
    if (periodMode === "month") return monthRange(month);
    if (periodMode === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
    return range.from <= range.to ? range : { from: range.to, to: range.from };
  }, [periodMode, month, year, range]);

  const filteredInvoices = useMemo(
    () => invoices
      .filter((invoice) => {
        if (!["Emitida", "Cobrada"].includes(invoice.status)) return false;
        const date = invoiceDate(invoice);
        return Boolean(date && date >= activeRange.from && date <= activeRange.to);
      })
      .sort((a, b) => invoiceDate(b).localeCompare(invoiceDate(a))),
    [invoices, activeRange]
  );

  const filteredExpenses = useMemo(
    () => expenses
      .filter((expense) => expense.date >= activeRange.from && expense.date <= activeRange.to)
      .sort((a, b) => b.date.localeCompare(a.date)),
    [expenses, activeRange]
  );

  const stats = useMemo(() => {
    let incomeBase = 0;
    let incomeCash = 0;
    let collectedCash = 0;

    for (const invoice of filteredInvoices) {
      let invoiceCash = 0;
      for (const line of invoice.lines) {
        const base = lineBase(line);
        incomeBase += base;
        invoiceCash +=
          base +
          base * (Number(line.vat || 0) / 100) -
          base * (Number(line.withholding || 0) / 100);
      }
      incomeCash += invoiceCash;
      if (invoice.status === "Cobrada") collectedCash += invoiceCash;
    }

    let expenseBase = 0;
    let deductibleExpenseBase = 0;
    let expenseCash = 0;

    for (const expense of filteredExpenses) {
      const base = Number(expense.base || 0);
      expenseBase += base;
      deductibleExpenseBase += base * (Number(expense.irpfDeductiblePct || 0) / 100);
      expenseCash += base + base * (Number(expense.vatRate || 0) / 100);
    }

    return {
      incomeBase: money(incomeBase),
      incomeCash: money(incomeCash),
      collectedCash: money(collectedCash),
      expenseBase: money(expenseBase),
      deductibleExpenseBase: money(deductibleExpenseBase),
      expenseCash: money(expenseCash),
      profit: money(incomeBase - expenseBase),
      fiscalProfit: money(incomeBase - deductibleExpenseBase),
      cashBalance: money(collectedCash - expenseCash)
    };
  }, [filteredInvoices, filteredExpenses]);

  const periodLabel = useMemo(() => {
    if (periodMode === "month") {
      return new Date(`${month}-01T12:00:00`).toLocaleDateString("es-ES", {
        month: "long",
        year: "numeric"
      });
    }
    if (periodMode === "year") return year;

    const formatter = new Intl.DateTimeFormat("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
    return `${formatter.format(new Date(`${activeRange.from}T12:00:00`))} – ${formatter.format(new Date(`${activeRange.to}T12:00:00`))}`;
  }, [periodMode, month, year, activeRange]);

  function shown(value: number) {
    return amountsVisible ? currency(value) : "•••• €";
  }

  if (!ready) {
    return <div className="panel">Cargando ingresos y gastos…</div>;
  }

  return (
    <section>
      <header className="page-header finance-header">
        <div>
          <p className="eyebrow">Resultados</p>
          <h1>Ingresos y gastos</h1>
          <p className="muted">
            Beneficio calculado sin IVA: base facturada menos base de gastos registrados.
          </p>
        </div>
        <div className="finance-header-actions">
          <button className="button secondary" onClick={onToggleAmounts}>
            {amountsVisible ? "Ocultar importes" : "Mostrar importes"}
          </button>
          <button className="button secondary" onClick={onOpenFiscal}>Gestionar gastos</button>
        </div>
      </header>

      <div className="finance-toolbar panel">
        <div className="finance-period-switch" aria-label="Periodo de resultados">
          <button className={periodMode === "month" ? "active" : ""} onClick={() => setPeriodMode("month")}>Mes</button>
          <button className={periodMode === "year" ? "active" : ""} onClick={() => setPeriodMode("year")}>Año</button>
          <button className={periodMode === "range" ? "active" : ""} onClick={() => setPeriodMode("range")}>Fechas</button>
        </div>

        <div className="finance-period-fields">
          {periodMode === "month" && (
            <label>
              Mes
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          )}
          {periodMode === "year" && (
            <label>
              Año
              <input
                type="number"
                min="2000"
                max="2100"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </label>
          )}
          {periodMode === "range" && (
            <>
              <label>
                Desde
                <input
                  type="date"
                  value={range.from}
                  onChange={(e) => setRange((current) => ({ ...current, from: e.target.value }))}
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  value={range.to}
                  onChange={(e) => setRange((current) => ({ ...current, to: e.target.value }))}
                />
              </label>
            </>
          )}
        </div>

        <strong className="finance-period-label">{periodLabel}</strong>
      </div>

      <div className="finance-kpis">
        <article>
          <span>Ingresos</span>
          <strong>{shown(stats.incomeBase)}</strong>
          <small>Base facturada · {filteredInvoices.length} {filteredInvoices.length === 1 ? "factura" : "facturas"}</small>
        </article>
        <article>
          <span>Gastos</span>
          <strong>{shown(stats.expenseBase)}</strong>
          <small>Base registrada · {filteredExpenses.length} {filteredExpenses.length === 1 ? "gasto" : "gastos"}</small>
        </article>
        <article className={`finance-profit ${stats.profit < 0 ? "negative" : ""}`}>
          <span>Beneficio</span>
          <strong>{shown(stats.profit)}</strong>
          <small>Ingresos − gastos · antes de impuestos</small>
        </article>
        <article>
          <span>Rendimiento fiscal aprox.</span>
          <strong>{shown(stats.fiscalProfit)}</strong>
          <small>Ingresos − parte deducible de gastos</small>
        </article>
        <article className={stats.cashBalance < 0 ? "negative" : ""}>
          <span>Caja neta</span>
          <strong>{shown(stats.cashBalance)}</strong>
          <small>Cobrado − gastos pagados/registrados con IVA</small>
        </article>
      </div>

      <div className="finance-explanation">
        <span><b>Beneficio</b> usa importes sin IVA para no contar el IVA repercutido como ingreso ni el soportado como gasto.</span>
        <span><b>Rendimiento fiscal</b> aplica el porcentaje deducible configurado en cada gasto.</span>
      </div>

      <div className="finance-ledgers">
        <section className="panel finance-ledger">
          <div className="section-title">
            <div>
              <p className="eyebrow">Entradas</p>
              <h2>Ingresos</h2>
            </div>
            <strong>{shown(stats.incomeBase)}</strong>
          </div>

          {filteredInvoices.length === 0 ? (
            <p className="finance-empty">No hay facturas emitidas o cobradas en este periodo.</p>
          ) : (
            <div className="finance-list">
              {filteredInvoices.map((invoice) => {
                const client = clients.find((item) => item.id === invoice.clientId);
                const base = money(invoice.lines.reduce((sum, line) => sum + lineBase(line), 0));
                const cash = money(invoice.lines.reduce((sum, line) => {
                  const lineAmount = lineBase(line);
                  return sum +
                    lineAmount +
                    lineAmount * (Number(line.vat || 0) / 100) -
                    lineAmount * (Number(line.withholding || 0) / 100);
                }, 0));

                return (
                  <article key={invoice.id}>
                    <div className="finance-list-main">
                      <strong>{invoice.number || "Sin numerar"}</strong>
                      <span>{client?.name || "Cliente"} · {invoiceDate(invoice)}</span>
                    </div>
                    <span className={`status ${invoice.status.toLowerCase()}`}>{invoice.status}</span>
                    <div className="finance-list-money">
                      <strong>{shown(base)}</strong>
                      <small>{amountsVisible ? `Total factura ${currency(cash)}` : "Total oculto"}</small>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel finance-ledger">
          <div className="section-title">
            <div>
              <p className="eyebrow">Salidas</p>
              <h2>Gastos</h2>
            </div>
            <strong>{shown(stats.expenseBase)}</strong>
          </div>

          {filteredExpenses.length === 0 ? (
            <div className="finance-empty finance-empty-action">
              <p>No hay gastos registrados en este periodo.</p>
              <button className="button secondary" onClick={onOpenFiscal}>Añadir gasto</button>
            </div>
          ) : (
            <div className="finance-list">
              {filteredExpenses.map((expense) => {
                const base = money(Number(expense.base || 0));
                const cash = money(base + base * (Number(expense.vatRate || 0) / 100));
                return (
                  <article key={expense.id}>
                    <div className="finance-list-main">
                      <strong>{expense.concept || "Gasto"}</strong>
                      <span>{expense.supplier || "Proveedor"} · {expense.date}</span>
                    </div>
                    <span className="finance-deductible">
                      {Number(expense.irpfDeductiblePct || 0)}% ded.
                    </span>
                    <div className="finance-list-money">
                      <strong>{shown(base)}</strong>
                      <small>{amountsVisible ? `Pagado ${currency(cash)}` : "Importe oculto"}</small>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
