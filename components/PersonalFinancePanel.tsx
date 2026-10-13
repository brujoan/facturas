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
  | "carExpense"
  | "freelanceExpense"
  | "extraExpense";

type BreakdownField = ExpenseField | "freelanceIncome" | "extraIncome";

type BreakdownItem = {
  id: string;
  concept: string;
  amount: number;
  date?: string;
};

type AccountMonth = {
  id: string;
  salary: number;
  freelanceIncome: number;
  extraIncome: number;
  extraIncomeReason: string;
  salaryReason?: string;
  salaryDate?: string;
  monthlyPayments: number;
  insurance: number;
  leisure: number;
  sport: number;
  carExpense: number;
  freelanceExpense: number;
  extraExpense: number;
  extraExpenseReason: string;
  breakdowns?: Partial<Record<BreakdownField, BreakdownItem[]>>;
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
  field: BreakdownField;
  title: string;
  items: BreakdownItem[];
};

const MONTHS_KEY = "facturas_personal_account_months_v2";
const LEGACY_MOVEMENTS_KEY = "facturas_personal_movements_v1";
const OPENING_SAVINGS_2026 = 11810;

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

function todayISO() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
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

function currencyRounded(value: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Math.round(Number(value || 0)));
}

function timestamp(value?: string) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function blankMonth(id: string): AccountMonth {
  return {
    id,
    salary: 0,
    freelanceIncome: 0,
    extraIncome: 0,
    extraIncomeReason: "",
    salaryReason: "",
    salaryDate: "",
    monthlyPayments: 0,
    insurance: 0,
    leisure: 0,
    sport: 0,
    carExpense: 0,
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

function appendReason(current: string, next: string) {
  const clean = next.trim();
  if (!clean) return current;
  if (!current) return clean;
  if (current.includes(clean)) return current;
  return `${current}; ${clean}`;
}

const breakdownFields: BreakdownField[] = [
  "freelanceIncome",
  "extraIncome",
  "monthlyPayments",
  "insurance",
  "leisure",
  "sport",
  "carExpense",
  "freelanceExpense",
  "extraExpense"
];

function salaryMonthForDate(date: string) {
  if (date.startsWith("2026-08")) return "2026-09";
  return date.slice(0, 7);
}

function participatesInCycle(monthId: string) {
  return !monthId.startsWith("2026-") || monthId >= "2026-09";
}

function normalize2026OpeningCycle(sourceMonths: AccountMonth[]) {
  const augustId = "2026-08";
  const septemberId = "2026-09";
  const august = sourceMonths.find((item) => item.id === augustId);

  if (!august?.salaryDate?.startsWith("2026-08") || august.salary <= 0) {
    return sourceMonths;
  }

  const september = sourceMonths.find((item) => item.id === septemberId) || blankMonth(septemberId);
  const movedSeptember: AccountMonth = {
    ...september,
    salary: money(september.salary + august.salary),
    salaryReason: appendReason(september.salaryReason || "", august.salaryReason || ""),
    salaryDate: august.salaryDate,
    updatedAt: nowISO()
  };
  const clearedAugust: AccountMonth = {
    ...august,
    salary: 0,
    salaryReason: "",
    salaryDate: "",
    updatedAt: nowISO()
  };

  return sourceMonths
    .filter((item) => item.id !== augustId && item.id !== septemberId)
    .concat(clearedAugust, movedSeptember);
}

function cycleMonthForDate(date: string, sourceMonths: AccountMonth[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date.slice(0, 7);

  const salaryRows = sourceMonths
    .filter((item) => participatesInCycle(item.id) && /^\d{4}-\d{2}-\d{2}$/.test(item.salaryDate || ""))
    .sort((a, b) => String(a.salaryDate).localeCompare(String(b.salaryDate)));

  let matched = "";
  for (const item of salaryRows) {
    if (String(item.salaryDate) <= date) matched = item.id;
    else break;
  }

  return matched || date.slice(0, 7);
}

function rebalanceDatedBreakdowns(sourceMonths: AccountMonth[]) {
  const schedule = sourceMonths.map((item) => ({
    ...blankMonth(item.id),
    ...item,
    breakdowns: { ...(item.breakdowns || {}) }
  }));

  const map = new Map<string, AccountMonth>();
  for (const item of schedule) {
    const next = { ...item, breakdowns: { ...(item.breakdowns || {}) } };
    for (const field of breakdownFields) {
      const items = next.breakdowns?.[field] || [];
      next.breakdowns = {
        ...(next.breakdowns || {}),
        [field]: items.filter((entry) => !entry.date)
      };
    }
    map.set(item.id, next);
  }

  for (const source of schedule) {
    for (const field of breakdownFields) {
      for (const entry of source.breakdowns?.[field] || []) {
        if (!entry.date) continue;
        const targetId = cycleMonthForDate(entry.date, schedule);
        const target = map.get(targetId) || blankMonth(targetId);
        const targetItems = target.breakdowns?.[field] || [];
        map.set(targetId, {
          ...target,
          breakdowns: {
            ...(target.breakdowns || {}),
            [field]: [...targetItems, entry]
          },
          updatedAt: source.updatedAt || target.updatedAt
        });
      }
    }
  }

  return [...map.values()].map((item) => {
    const next = { ...item, breakdowns: { ...(item.breakdowns || {}) } };
    for (const field of breakdownFields) {
      const original = schedule.find((source) => source.id === item.id);
      const originalHadBreakdown = Boolean(original?.breakdowns?.[field]?.length);
      const items = next.breakdowns?.[field] || [];
      if (items.length || originalHadBreakdown) {
        (next as unknown as Record<BreakdownField, number>)[field] =
          money(items.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
      }
    }
    return next;
  });
}

function dayBefore(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  parsed.setDate(parsed.getDate() - 1);
  return [
    parsed.getFullYear(),
    String(parsed.getMonth() + 1).padStart(2, "0"),
    String(parsed.getDate()).padStart(2, "0")
  ].join("-");
}

function shortDate(date: string) {
  if (!date) return "";
  return new Date(`${date}T12:00:00`).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short"
  });
}

function monthNameFromId(monthId: string) {
  const monthIndex = Number(monthId.slice(5, 7)) - 1;
  return monthNames[monthIndex] || monthId;
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
      } else if (category === "Autónomo") {
        row.freelanceIncome = money(row.freelanceIncome + amount);
        row.breakdowns = {
          ...(row.breakdowns || {}),
          freelanceIncome: [
            ...(row.breakdowns?.freelanceIncome || []),
            { id: movement.id || uid(), concept: concept || "Autónomo", amount, date: movement.date }
          ]
        };
      } else {
        row.extraIncome = money(row.extraIncome + amount);
        row.extraIncomeReason = appendReason(row.extraIncomeReason, concept || category);
      }
    } else if (movement.type === "expense") {
      if (category === "Ocio") {
        row.leisure = money(row.leisure + amount);
      } else if (category === "Coche") {
        row.carExpense = money(row.carExpense + amount);
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

export default function PersonalFinancePanel({ amountsVisible, onToggleAmounts }: Props) {
  const [year, setYear] = useState(currentYear());
  const [months, setMonths] = useState<AccountMonth[]>([]);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"local" | "saving" | "saved" | "error">("local");
  const [breakdownEditor, setBreakdownEditor] = useState<BreakdownEditor | null>(null);
  const [salaryDateEditor, setSalaryDateEditor] = useState<{ monthId: string; monthName: string; date: string } | null>(null);
  const [quickType, setQuickType] = useState<"income" | "expense">("expense");
  const [quickSection, setQuickSection] = useState<"salary" | "freelanceIncome" | "extraIncome" | ExpenseField>("monthlyPayments");
  const [quickDate, setQuickDate] = useState(todayISO());
  const [quickAmount, setQuickAmount] = useState("");
  const [quickConcept, setQuickConcept] = useState("");
  const [quickNotice, setQuickNotice] = useState("");

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
        const normalizedMonths = loadedMonths.map((item) => {
          const next = { ...blankMonth(item.id), ...item, breakdowns: { ...(item.breakdowns || {}) } };

          if (next.extraIncome > 0 && !next.breakdowns?.extraIncome?.length && next.extraIncomeReason) {
            next.breakdowns = {
              ...next.breakdowns,
              extraIncome: [{
                id: `legacy-${item.id}-extra-income`,
                concept: next.extraIncomeReason,
                amount: next.extraIncome
              }]
            };
          }

          if (next.extraExpense > 0 && !next.breakdowns?.extraExpense?.length && next.extraExpenseReason) {
            next.breakdowns = {
              ...next.breakdowns,
              extraExpense: [{
                id: `legacy-${item.id}-extra-expense`,
                concept: next.extraExpenseReason,
                amount: next.extraExpense
              }]
            };
          }

          return next;
        });

        setMonths(rebalanceDatedBreakdowns(normalize2026OpeningCycle(normalizedMonths)));
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

  const lastMovementDate = useMemo(() => {
    const dates: string[] = [];

    for (const item of months) {
      if (item.salaryDate) dates.push(item.salaryDate);
      for (const field of breakdownFields) {
        for (const entry of item.breakdowns?.[field] || []) {
          if (entry.date) dates.push(entry.date);
        }
      }
    }

    return dates.sort().at(-1) || "";
  }, [months]);

  const payCycleRanges = useMemo(() => {
    const salaryRows = months
      .filter((item) => participatesInCycle(item.id) && item.salaryDate)
      .sort((a, b) => String(a.salaryDate).localeCompare(String(b.salaryDate)));

    const ranges = new Map<string, string>();
    salaryRows.forEach((item, index) => {
      const start = String(item.salaryDate);
      const next = salaryRows[index + 1]?.salaryDate;
      ranges.set(item.id, next
        ? `${shortDate(start)} → ${shortDate(dayBefore(String(next)))}`
        : `desde ${shortDate(start)}`);
    });
    return ranges;
  }, [months]);

  const rows = useMemo(() => {
    return monthNames.map((name, index) => {
      const id = `${year}-${String(index + 1).padStart(2, "0")}`;
      const stored = months.find((item) => item.id === id) || blankMonth(id);
      const freelance = stored.freelanceIncome;
      const totalIncome = money(stored.salary + freelance + stored.extraIncome);
      const totalExpense = money(
        stored.monthlyPayments +
        stored.insurance +
        stored.leisure +
        stored.sport +
        stored.carExpense +
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
  }, [year, months]);

  const accountingRows = useMemo(
    () => year === 2026 ? rows.slice(8) : rows,
    [year, rows]
  );

  const openingSavings = year === 2026 ? OPENING_SAVINGS_2026 : 0;

  const totals = useMemo(() => {
    return accountingRows.reduce(
      (acc, row) => ({
        salary: money(acc.salary + row.salary),
        freelance: money(acc.freelance + row.freelance),
        extraIncome: money(acc.extraIncome + row.extraIncome),
        totalIncome: money(acc.totalIncome + row.totalIncome),
        monthlyPayments: money(acc.monthlyPayments + row.monthlyPayments),
        insurance: money(acc.insurance + row.insurance),
        leisure: money(acc.leisure + row.leisure),
        sport: money(acc.sport + row.sport),
        carExpense: money(acc.carExpense + row.carExpense),
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
        carExpense: 0,
        freelanceExpense: 0,
        extraExpense: 0,
        totalExpense: 0,
        savings: openingSavings
      }
    );
  }, [accountingRows, openingSavings]);

  const averageMonthCount = useMemo(() =>
    accountingRows.filter((row) =>
      row.salary !== 0 ||
      row.freelance !== 0 ||
      row.extraIncome !== 0 ||
      row.totalExpense !== 0
    ).length
  , [accountingRows]);

  const averageTotals = useMemo(
    () => accountingRows.reduce(
      (acc, row) => ({
        salary: money(acc.salary + row.salary),
        freelance: money(acc.freelance + row.freelance),
        extraIncome: money(acc.extraIncome + row.extraIncome),
        totalIncome: money(acc.totalIncome + row.totalIncome),
        monthlyPayments: money(acc.monthlyPayments + row.monthlyPayments),
        insurance: money(acc.insurance + row.insurance),
        leisure: money(acc.leisure + row.leisure),
        sport: money(acc.sport + row.sport),
        carExpense: money(acc.carExpense + row.carExpense),
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
        carExpense: 0,
        freelanceExpense: 0,
        extraExpense: 0,
        totalExpense: 0,
        savings: 0
      }
    ),
    [accountingRows]
  );

  const averages = useMemo(() => {
    const divisor = averageMonthCount || 1;
    return {
      salary: money(averageTotals.salary / divisor),
      freelance: money(averageTotals.freelance / divisor),
      extraIncome: money(averageTotals.extraIncome / divisor),
      totalIncome: money(averageTotals.totalIncome / divisor),
      monthlyPayments: money(averageTotals.monthlyPayments / divisor),
      insurance: money(averageTotals.insurance / divisor),
      leisure: money(averageTotals.leisure / divisor),
      sport: money(averageTotals.sport / divisor),
      carExpense: money(averageTotals.carExpense / divisor),
      freelanceExpense: money(averageTotals.freelanceExpense / divisor),
      extraExpense: money(averageTotals.extraExpense / divisor),
      totalExpense: money(averageTotals.totalExpense / divisor),
      savings: money(averageTotals.savings / divisor)
    };
  }, [averageTotals, averageMonthCount]);

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

  function setBreakdownAmount(monthId: string, field: BreakdownField, value: number) {
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
    field: "salary",
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
        onBlur={(e) => {
          const nextValue = Number(e.target.value || 0);
          const stored = months.find((item) => item.id === monthId);
          if (nextValue > 0 && !stored?.salaryDate) {
            setSalaryDateEditor({
              monthId,
              monthName: monthNameFromId(monthId),
              date: ""
            });
          }
        }}
      />
    );
  }

  function openBreakdown(
    monthId: string,
    monthName: string,
    field: BreakdownField,
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

  function breakdownCell(
    monthId: string,
    monthName: string,
    field: BreakdownField,
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
            onChange={(e) => setBreakdownAmount(monthId, field, Number(e.target.value || 0))}
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

      const updated = index < 0
        ? [...current, next]
        : current.map((item, itemIndex) => itemIndex === index ? next : item);
      return rebalanceDatedBreakdowns(updated);
    });

    setBreakdownEditor(null);
  }

  function saveSalaryDate() {
    if (!salaryDateEditor || !/^\d{4}-\d{2}-\d{2}$/.test(salaryDateEditor.date)) return;

    const sourceId = salaryDateEditor.monthId;

    setMonths((current) => {
      const source = current.find((item) => item.id === sourceId) || blankMonth(sourceId);
      const next = {
        ...source,
        salaryDate: salaryDateEditor.date,
        updatedAt: nowISO()
      };
      const sourceIndex = current.findIndex((item) => item.id === sourceId);
      const updated = sourceIndex < 0
        ? [...current, next]
        : current.map((item, index) => index === sourceIndex ? next : item);

      return rebalanceDatedBreakdowns(updated);
    });

    setYear(Number(sourceId.slice(0, 4)));
    setSalaryDateEditor(null);
  }

  function addQuickMovement(event: React.FormEvent) {
    event.preventDefault();

    const amount = money(Number(quickAmount || 0));
    const concept = quickConcept.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(quickDate) || amount <= 0 || !concept) {
      setQuickNotice("Falta fecha, importe o concepto");
      window.setTimeout(() => setQuickNotice(""), 1800);
      return;
    }

    if (!(quickType === "income" && quickSection === "salary")) {
      const movementMonth = quickDate.slice(0, 7);
      const missingSalaryCycle = months
        .filter((item) =>
          participatesInCycle(item.id) &&
          item.salary > 0 &&
          !item.salaryDate &&
          item.id <= movementMonth
        )
        .sort((a, b) => b.id.localeCompare(a.id))[0];

      if (missingSalaryCycle) {
        setQuickNotice(`Falta fecha de nómina en ${monthNameFromId(missingSalaryCycle.id)}`);
        setSalaryDateEditor({
          monthId: missingSalaryCycle.id,
          monthName: monthNameFromId(missingSalaryCycle.id),
          date: ""
        });
        window.setTimeout(() => setQuickNotice(""), 2400);
        return;
      }
    }

    const targetMonthId = quickType === "income" && quickSection === "salary"
      ? salaryMonthForDate(quickDate)
      : cycleMonthForDate(quickDate, months);

    setMonths((current) => {

      const index = current.findIndex((item) => item.id === targetMonthId);
      const base = index >= 0 ? current[index] : blankMonth(targetMonthId);
      let next: AccountMonth = { ...base, updatedAt: nowISO() };

      if (quickType === "income" && quickSection === "salary") {
        next = {
          ...next,
          salary: money(base.salary + amount),
          salaryReason: appendReason(base.salaryReason || "", concept),
          salaryDate: quickDate
        };
      } else {
        const field = quickSection as BreakdownField;
        const currentTotal = Number(base[field] || 0);
        const existing = base.breakdowns?.[field] || [];
        const items = existing.length
          ? [...existing]
          : currentTotal > 0
            ? [{ id: uid(), concept: "Sin desglosar", amount: currentTotal }]
            : [];

        const nextItems = [...items, { id: uid(), concept, amount, date: quickDate }];
        const total = money(nextItems.reduce((sum, item) => sum + Number(item.amount || 0), 0));

        next = {
          ...next,
          [field]: total,
          breakdowns: {
            ...(base.breakdowns || {}),
            [field]: nextItems
          }
        };
      }

      const updated = index < 0
        ? [...current, next]
        : current.map((item, itemIndex) => itemIndex === index ? next : item);

      return rebalanceDatedBreakdowns(updated);
    });

    const targetYear = Number(targetMonthId.slice(0, 4));
    const targetMonthIndex = Number(targetMonthId.slice(5, 7)) - 1;
    setYear(targetYear);
    setQuickAmount("");
    setQuickConcept("");
    setQuickNotice(`Añadido a ${monthNames[targetMonthIndex]}`);
    window.setTimeout(() => setQuickNotice(""), 1800);
  }

  function shown(value: number) {
    return amountsVisible ? currency(value) : "•••• €";
  }

  function shownRounded(value: number) {
    return amountsVisible ? currencyRounded(value) : "•••• €";
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
        <div className="accounts-year-selector">
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
          <span className="accounts-last-movement">
            Último: {lastMovementDate ? new Date(`${lastMovementDate}T12:00:00`).toLocaleDateString("es-ES") : "—"}
          </span>
        </div>

        <form
          className="accounts-quick-movement"
          onSubmit={addQuickMovement}
          title="Añadir movimiento"
        >
          <input
            className="accounts-quick-date"
            type="date"
            value={quickDate}
            aria-label="Fecha"
            onChange={(e) => setQuickDate(e.target.value)}
          />
          <select
            value={quickType}
            onChange={(e) => {
              const type = e.target.value as "income" | "expense";
              setQuickType(type);
              setQuickSection(type === "income" ? "salary" : "monthlyPayments");
            }}
            aria-label="Tipo de movimiento"
          >
            <option value="expense">Gasto</option>
            <option value="income">Ingreso</option>
          </select>

          <select
            value={quickSection}
            onChange={(e) => setQuickSection(e.target.value as "salary" | "freelanceIncome" | "extraIncome" | ExpenseField)}
            aria-label="Sección"
          >
            {quickType === "income" ? (
              <>
                <option value="salary">Nómina</option>
                <option value="freelanceIncome">Autónomo</option>
                <option value="extraIncome">Ingreso extra</option>
              </>
            ) : (
              <>
                <option value="monthlyPayments">Mensualidades</option>
                <option value="insurance">Seguros</option>
                <option value="leisure">Ocio</option>
                <option value="sport">Deporte</option>
                <option value="carExpense">Coche</option>
                <option value="freelanceExpense">Autónomo</option>
                <option value="extraExpense">Gasto extra</option>
              </>
            )}
          </select>

          <input
            className="accounts-quick-amount"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={quickAmount}
            placeholder="Importe"
            aria-label="Importe"
            onChange={(e) => setQuickAmount(e.target.value)}
          />

          <input
            className="accounts-quick-concept"
            type="text"
            value={quickConcept}
            placeholder="Concepto"
            aria-label="Concepto"
            onChange={(e) => setQuickConcept(e.target.value)}
          />

          <button className="accounts-quick-add" type="submit" aria-label="Añadir movimiento">+</button>
          {quickNotice && <span className="accounts-quick-notice">{quickNotice}</span>}
        </form>
      </div>

      <div className="accounts-table-panel panel">
        <div className="accounts-table-scroll">
          <table className="accounts-table">
            <thead>
              <tr className="accounts-group-row">
                <th rowSpan={2}>Mes</th>
                <th colSpan={4}>Ingresos</th>
                <th colSpan={8}>Gastos</th>
                <th rowSpan={2}>Ahorro</th>
              </tr>
              <tr>
                <th>Nóm.</th>
                <th>Autón.</th>
                <th>Ing. extra</th>
                <th>Ing. total</th>
                <th>Mens.</th>
                <th>Seguro</th>
                <th>Ocio</th>
                <th>Deport.</th>
                <th>Coche</th>
                <th>Autón.</th>
                <th>Otros</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {year === 2026 && (
                <tr className="accounts-opening-balance">
                  <th>
                    <span>Agosto</span>
                    <small>Ahorros anteriores</small>
                  </th>
                  <td colSpan={12}>—</td>
                  <td className="accounts-savings">{shownRounded(OPENING_SAVINGS_2026)}</td>
                </tr>
              )}

              {accountingRows.map((row) => (
                <tr key={row.id} className={row.id === new Date().toISOString().slice(0, 7) ? "current-month" : ""}>
                  <th>
                    <span>{row.name}</span>
                    {(row.salary || row.salaryDate) && (
                      <button
                        type="button"
                        className={`accounts-cycle-date-button ${row.salary > 0 && !row.salaryDate ? "missing" : ""}`}
                        onClick={() => setSalaryDateEditor({ monthId: row.id, monthName: row.name, date: row.salaryDate || "" })}
                        title="Cambiar fecha de nómina"
                      >
                        {row.salary > 0 && !row.salaryDate
                          ? "⚠ Falta fecha"
                          : `${payCycleRanges.get(row.id) || (row.salaryDate ? shortDate(row.salaryDate) : "Fecha nómina")} · editar`}
                      </button>
                    )}
                  </th>
                  <td>{amountCell(row.id, "salary", row.salary, `Nómina de ${row.name}`)}</td>
                  <td>{breakdownCell(row.id, row.name, "freelanceIncome", "Autónomo", row.freelance)}</td>
                  <td>{breakdownCell(row.id, row.name, "extraIncome", "Ingreso extra", row.extraIncome)}</td>
                  <td className="accounts-total income">{shown(row.totalIncome)}</td>
                  <td>{breakdownCell(row.id, row.name, "monthlyPayments", "Mensualidades", row.monthlyPayments)}</td>
                  <td>{breakdownCell(row.id, row.name, "insurance", "Seguros", row.insurance)}</td>
                  <td>{breakdownCell(row.id, row.name, "leisure", "Ocio", row.leisure)}</td>
                  <td>{breakdownCell(row.id, row.name, "sport", "Deporte", row.sport)}</td>
                  <td>{breakdownCell(row.id, row.name, "carExpense", "Coche", row.carExpense)}</td>
                  <td>{breakdownCell(row.id, row.name, "freelanceExpense", "Autónomo", row.freelanceExpense)}</td>
                  <td>{breakdownCell(row.id, row.name, "extraExpense", "Gasto extra", row.extraExpense)}</td>
                  <td className="accounts-total expense">{shown(row.totalExpense)}</td>
                  <td className={`accounts-savings ${row.savings < 0 ? "negative" : ""}`}>
                    {shown(row.savings)}
                  </td>
                </tr>
              ))}

              <tr className="accounts-year-total">
                <th>TOTAL {year}</th>
                <td>{shownRounded(totals.salary)}</td>
                <td>{shownRounded(totals.freelance)}</td>
                <td>{shownRounded(totals.extraIncome)}</td>
                <td>{shownRounded(totals.totalIncome)}</td>
                <td>{shownRounded(totals.monthlyPayments)}</td>
                <td>{shownRounded(totals.insurance)}</td>
                <td>{shownRounded(totals.leisure)}</td>
                <td>{shownRounded(totals.sport)}</td>
                <td>{shownRounded(totals.carExpense)}</td>
                <td>{shownRounded(totals.freelanceExpense)}</td>
                <td>{shownRounded(totals.extraExpense)}</td>
                <td>{shownRounded(totals.totalExpense)}</td>
                <td className={totals.savings < 0 ? "negative" : ""}>{shownRounded(totals.savings)}</td>
              </tr>
              <tr className="accounts-year-average">
                <th>MEDIA · {averageMonthCount || 0}m</th>
                <td>{shownRounded(averages.salary)}</td>
                <td>{shownRounded(averages.freelance)}</td>
                <td>{shownRounded(averages.extraIncome)}</td>
                <td>{shownRounded(averages.totalIncome)}</td>
                <td>{shownRounded(averages.monthlyPayments)}</td>
                <td>{shownRounded(averages.insurance)}</td>
                <td>{shownRounded(averages.leisure)}</td>
                <td>{shownRounded(averages.sport)}</td>
                <td>{shownRounded(averages.carExpense)}</td>
                <td>{shownRounded(averages.freelanceExpense)}</td>
                <td>{shownRounded(averages.extraExpense)}</td>
                <td>{shownRounded(averages.totalExpense)}</td>
                <td className={averages.savings < 0 ? "negative" : ""}>{shownRounded(averages.savings)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="accounts-mobile-list">
        {year === 2026 && (
          <article className="accounts-mobile-month accounts-mobile-opening">
            <header>
              <div>
                <strong>Agosto</strong>
                <small>Ahorros anteriores</small>
              </div>
              <span>Ahorro {shownRounded(OPENING_SAVINGS_2026)}</span>
            </header>
          </article>
        )}

        {accountingRows.map((row) => (
          <article
            key={`mobile-${row.id}`}
            className={`accounts-mobile-month ${row.id === new Date().toISOString().slice(0, 7) ? "current-month" : ""}`}
          >
            <header>
              <div>
                <strong>{row.name}</strong>
                {(row.salary || row.salaryDate) && (
                  <button
                    type="button"
                    className={`accounts-cycle-date-button ${row.salary > 0 && !row.salaryDate ? "missing" : ""}`}
                    onClick={() => setSalaryDateEditor({ monthId: row.id, monthName: row.name, date: row.salaryDate || "" })}
                  >
                    {row.salary > 0 && !row.salaryDate
                      ? "⚠ Falta fecha"
                      : `${payCycleRanges.get(row.id) || (row.salaryDate ? shortDate(row.salaryDate) : "Fecha nómina")} · editar`}
                  </button>
                )}
              </div>
              <span className={row.savings < 0 ? "negative" : ""}>
                Ahorro {shown(row.savings)}
              </span>
            </header>

            <div className="accounts-mobile-section">
              <h3>Ingresos</h3>
              <div className="accounts-mobile-grid">
                <label>Nómina{amountCell(row.id, "salary", row.salary, `Nómina de ${row.name}`)}</label>
                <label>Autónomo{breakdownCell(row.id, row.name, "freelanceIncome", "Autónomo", row.freelance)}</label>
                <label>Ingreso extra{breakdownCell(row.id, row.name, "extraIncome", "Ingreso extra", row.extraIncome)}</label>
              </div>
              <div className="accounts-mobile-total income">
                <span>Ingreso total</span>
                <strong>{shown(row.totalIncome)}</strong>
              </div>
            </div>

            <div className="accounts-mobile-section">
              <h3>Gastos</h3>
              <div className="accounts-mobile-grid">
                <label>Mensualidades{breakdownCell(row.id, row.name, "monthlyPayments", "Mensualidades", row.monthlyPayments)}</label>
                <label>Seguro{breakdownCell(row.id, row.name, "insurance", "Seguro", row.insurance)}</label>
                <label>Ocio{breakdownCell(row.id, row.name, "leisure", "Ocio", row.leisure)}</label>
                <label>Deporte{breakdownCell(row.id, row.name, "sport", "Deporte", row.sport)}</label>
                <label>Coche{breakdownCell(row.id, row.name, "carExpense", "Coche", row.carExpense)}</label>
                <label>Autónomo{breakdownCell(row.id, row.name, "freelanceExpense", "Autónomo", row.freelanceExpense)}</label>
                <label>Otros{breakdownCell(row.id, row.name, "extraExpense", "Otros", row.extraExpense)}</label>
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
          <div><span>Ingresos</span><b>{shownRounded(totals.totalIncome)}</b></div>
          <div><span>Gastos</span><b>{shownRounded(totals.totalExpense)}</b></div>
          <div className={totals.savings < 0 ? "negative" : ""}><span>Ahorro</span><b>{shownRounded(totals.savings)}</b></div>
        </article>
        <article className="accounts-mobile-year-total accounts-mobile-average">
          <strong>MEDIA · {averageMonthCount || 0} meses</strong>
          <div><span>Ingresos</span><b>{shownRounded(averages.totalIncome)}</b></div>
          <div><span>Gastos</span><b>{shownRounded(averages.totalExpense)}</b></div>
          <div className={averages.savings < 0 ? "negative" : ""}><span>Ahorro</span><b>{shownRounded(averages.savings)}</b></div>
        </article>
      </div>

      <p className="accounts-note">
        Los movimientos se asignan al ciclo abierto por la última nómina con fecha. Si una nómina no tiene fecha, primero hay que indicarla para cerrar el ciclo anterior.
      </p>

      {salaryDateEditor && (
        <div className="accounts-breakdown-overlay" onMouseDown={() => setSalaryDateEditor(null)}>
          <section
            className="accounts-salary-date-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Cambiar fecha de nómina"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">{salaryDateEditor.monthName} · nómina</p>
                <h2>Fecha de cobro</h2>
              </div>
              <button className="accounts-breakdown-close" onClick={() => setSalaryDateEditor(null)} aria-label="Cerrar">×</button>
            </header>
            <div className="accounts-salary-date-body">
              <input
                type="date"
                value={salaryDateEditor.date}
                onChange={(e) => setSalaryDateEditor((current) => current ? { ...current, date: e.target.value } : current)}
                aria-label="Fecha de cobro de la nómina"
              />
              <p>La fecha cambia el inicio del ciclo, pero la nómina se mantiene en esta fila. Los movimientos fechados se recolocan automáticamente.</p>
            </div>
            <footer>
              <button className="button secondary" onClick={() => setSalaryDateEditor(null)}>Cancelar</button>
              <button className="button primary" onClick={saveSalaryDate}>Guardar fecha</button>
            </footer>
          </section>
        </div>
      )}

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
                    className="accounts-breakdown-date"
                    type="date"
                    value={item.date || ""}
                    aria-label="Fecha"
                    onChange={(e) => updateBreakdownItem(item.id, { date: e.target.value })}
                  />
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
