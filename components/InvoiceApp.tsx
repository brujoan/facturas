"use client";

import { useEffect, useMemo, useState } from "react";
import FiscalPanel from "@/components/FiscalPanel";

type Tab = "facturas" | "nueva" | "clientes" | "fiscal" | "config";
type BillingPeriod = "month" | "year" | "total";
type Status = "Borrador" | "Emitida" | "Cobrada" | "Anulada";

type Issuer = {
  fiscalName: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  email: string;
  phone: string;
  iban: string;
};

type Client = {
  id: string;
  name: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  email: string;
  phone?: string;
  notes?: string;
};

type ActivityPreset = {
  id: string;
  name: string;
  vat: number;
  withholding: number;
};

type InvoiceLine = {
  id: string;
  activityId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  vat: number;
  withholding: number;
};

type SavedConcept = {
  id: string;
  description: string;
  activityId: string;
  unitPrice: number;
  vat: number;
  withholding: number;
  lastUsedAt: string;
};

type Invoice = {
  id: string;
  number: string;
  series: string;
  issueDate: string;
  operationDate: string;
  dueDate: string;
  clientId: string;
  lines: InvoiceLine[];
  notes: string;
  paymentMethod: string;
  status: Status;
  createdAt: string;
};

const storage = {
  issuer: "facturas_issuer_v1",
  clients: "facturas_clients_v1",
  activities: "facturas_activities_v1",
  invoices: "facturas_invoices_v1",
  concepts: "facturas_concepts_v1"
};

const blankIssuer: Issuer = {
  fiscalName: "",
  taxId: "",
  address: "",
  postalCode: "",
  city: "",
  province: "",
  email: "",
  phone: "",
  iban: ""
};

const blankClient: Client = {
  id: "",
  name: "",
  taxId: "",
  address: "",
  postalCode: "",
  city: "",
  province: "",
  email: "",
  phone: "",
  notes: ""
};

const defaultActivities: ActivityPreset[] = [
  {
    id: "cnae-5916",
    name: "CNAE 5916 Actividades de producción de programas de televisión",
    vat: 21,
    withholding: 0
  },
  {
    id: "cnae-5912",
    name: "CNAE 5912 Actividades de posproducción cinematográfica, de vídeo y de programas de televisión",
    vat: 21,
    withholding: 0
  }
];

const legacyActivityIds = new Set(["prof-15", "prof-7", "sin-ret"]);

function normalizeActivities(items: ActivityPreset[]) {
  const custom = items.filter(
    (activity) =>
      !legacyActivityIds.has(activity.id) &&
      !defaultActivities.some(
        (preset) =>
          preset.id === activity.id ||
          preset.name.toLocaleLowerCase("es") === activity.name.toLocaleLowerCase("es")
      )
  );
  return [...defaultActivities, ...custom];
}

function mergeById<T extends { id: string }>(remote: T[], local: T[]) {
  const map = new Map<string, T>();
  remote.forEach((item) => map.set(item.id, item));
  local.forEach((item) => map.set(item.id, { ...(map.get(item.id) || {} as T), ...item }));
  return [...map.values()];
}

function mergeIssuer(remote: Partial<Issuer> | undefined, local: Issuer) {
  const merged = { ...blankIssuer, ...(remote || {}) };
  (Object.keys(local) as Array<keyof Issuer>).forEach((key) => {
    if (local[key] !== "") merged[key] = local[key];
  });
  return merged;
}

function uid() {
  return crypto.randomUUID();
}

function dateISO() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine(activity?: ActivityPreset): InvoiceLine {
  return {
    id: uid(),
    activityId: activity?.id || "",
    description: "",
    quantity: 1,
    unitPrice: 0,
    vat: activity?.vat ?? 21,
    withholding: activity?.withholding ?? 0
  };
}

function emptyInvoice(activity?: ActivityPreset): Invoice {
  const today = dateISO();
  return {
    id: uid(),
    number: "",
    series: String(new Date().getFullYear()),
    issueDate: today,
    operationDate: today,
    dueDate: today,
    clientId: "",
    lines: [emptyLine(activity)],
    notes: "",
    paymentMethod: "Transferencia bancaria",
    status: "Borrador",
    createdAt: new Date().toISOString()
  };
}

function currency(value: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR"
  }).format(value || 0);
}

function lineBase(line: InvoiceLine) {
  return Number(line.quantity || 0) * Number(line.unitPrice || 0);
}

function totals(invoice: Invoice) {
  return invoice.lines.reduce(
    (acc, line) => {
      const base = lineBase(line);
      acc.base += base;
      acc.vat += base * (Number(line.vat || 0) / 100);
      acc.withholding += base * (Number(line.withholding || 0) / 100);
      return acc;
    },
    { base: 0, vat: 0, withholding: 0 }
  );
}

function nextNumber(series: string, invoices: Invoice[]) {
  const prefix = series.trim() || String(new Date().getFullYear());
  const used = invoices
    .filter((invoice) => invoice.series === prefix)
    .map((invoice) => {
      const match = invoice.number.match(/(\d+)$/);
      return match ? Number(match[1]) : 0;
    });
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

function groupTax(lines: InvoiceLine[], field: "vat" | "withholding") {
  const map = new Map<number, { base: number; amount: number }>();
  for (const line of lines) {
    const rate = Number(line[field] || 0);
    if (field === "withholding" && rate === 0) continue;
    const base = lineBase(line);
    const current = map.get(rate) || { base: 0, amount: 0 };
    current.base += base;
    current.amount += base * (rate / 100);
    map.set(rate, current);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

type InvoiceAppProps = {
  version: string;
  deployment: string;
};

export default function InvoiceApp({ version, deployment }: InvoiceAppProps) {
  const [tab, setTab] = useState<Tab>("facturas");
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("month");
  const [billingVisible, setBillingVisible] = useState(false);
  const [billingHistoryVisible, setBillingHistoryVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [issuer, setIssuer] = useState<Issuer>(blankIssuer);
  const [clients, setClients] = useState<Client[]>([]);
  const [activities, setActivities] = useState<ActivityPreset[]>(defaultActivities);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [savedConcepts, setSavedConcepts] = useState<SavedConcept[]>([]);
  const [draft, setDraft] = useState<Invoice>(() => emptyInvoice(defaultActivities[0]));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Invoice | null>(null);
  const [clientDraft, setClientDraft] = useState<Client>({ ...blankClient });
  const [activityDraft, setActivityDraft] = useState({ name: "", vat: 21, withholding: 0 });
  const [notice, setNotice] = useState("");
  const [remoteConfigured, setRemoteConfigured] = useState(false);

  useEffect(() => {
    const read = <T,>(key: string, fallback: T): T => {
      try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
      } catch {
        return fallback;
      }
    };

    async function load() {
      let loadedIssuer = read<Issuer>(storage.issuer, blankIssuer);
      let loadedClients = read<Client[]>(storage.clients, []);
      let loadedActivities = normalizeActivities(read<ActivityPreset[]>(storage.activities, defaultActivities));
      let loadedInvoices = read<Invoice[]>(storage.invoices, []);
      let loadedConcepts = read<SavedConcept[]>(storage.concepts, []);

      try {
        const response = await fetch("/api/data", { cache: "no-store" });
        const result = await response.json();
        if (response.ok && result.configured) {
          setRemoteConfigured(true);

          const remote = result.data || {};
          const mergedIssuer = mergeIssuer(remote.issuer, loadedIssuer);
          const mergedClients = mergeById<Client>(remote.clients || [], loadedClients);
          const mergedActivities = normalizeActivities(mergeById<ActivityPreset>(remote.activities || [], loadedActivities));
          const mergedInvoices = mergeById<Invoice>(remote.invoices || [], loadedInvoices);
          const mergedConcepts = mergeById<SavedConcept>(remote.concepts || [], loadedConcepts);

          loadedIssuer = mergedIssuer;
          loadedClients = mergedClients;
          loadedActivities = mergedActivities;
          loadedInvoices = mergedInvoices;
          loadedConcepts = mergedConcepts;

          const localHadData =
            Boolean(loadedIssuer.fiscalName || loadedIssuer.taxId) ||
            loadedClients.length > 0 ||
            loadedInvoices.length > 0 ||
            loadedConcepts.length > 0;

          if (localHadData) {
            await fetch("/api/data", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                issuer: loadedIssuer,
                clients: loadedClients,
                activities: loadedActivities,
                invoices: loadedInvoices,
                concepts: loadedConcepts
              })
            });
          }
        }
      } catch {
        // Si la base de datos no está disponible, la copia local sigue funcionando.
      }

      setIssuer(loadedIssuer);
      setClients(loadedClients);
      setActivities(loadedActivities.length ? loadedActivities : defaultActivities);
      setInvoices(loadedInvoices);
      setSavedConcepts(loadedConcepts);
      setDraft(emptyInvoice(loadedActivities[0] || defaultActivities[0]));
      setReady(true);
    }

    load();
  }, []);

  useEffect(() => {
    if (!ready) return;

    localStorage.setItem(storage.issuer, JSON.stringify(issuer));
    localStorage.setItem(storage.clients, JSON.stringify(clients));
    localStorage.setItem(storage.activities, JSON.stringify(activities));
    localStorage.setItem(storage.invoices, JSON.stringify(invoices));
    localStorage.setItem(storage.concepts, JSON.stringify(savedConcepts));

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/data", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issuer, clients, activities, invoices, concepts: savedConcepts })
        });
        const result = await response.json();
        if (response.ok && result.configured) setRemoteConfigured(true);
      } catch {
        // El guardado local sigue siendo la copia de respaldo del navegador.
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [issuer, clients, activities, invoices, savedConcepts, ready]);

  useEffect(() => {
    if (!ready || !remoteConfigured) return;

    let cancelled = false;

    async function refreshRemote() {
      if (document.visibilityState === "hidden") return;

      try {
        const response = await fetch("/api/data", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.data || cancelled) return;

        const remote = result.data;
        if (remote.issuer) setIssuer((current) => ({ ...current, ...remote.issuer }));
        if (remote.clients) setClients((current) => mergeById<Client>(current, remote.clients));
        if (remote.activities) {
          setActivities((current) => normalizeActivities(mergeById<ActivityPreset>(current, remote.activities)));
        }
        if (remote.invoices) setInvoices((current) => mergeById<Invoice>(current, remote.invoices));
        if (remote.concepts) setSavedConcepts((current) => mergeById<SavedConcept>(current, remote.concepts));
      } catch {
        // Mantiene la copia local si no hay conexión.
      }
    }

    const onFocus = () => void refreshRemote();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void refreshRemote(), 30000);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [ready, remoteConfigured]);

  const draftTotals = useMemo(() => totals(draft), [draft]);
  const recentInvoices = useMemo(
    () => [...invoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [invoices]
  );

  const billedAmount = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    return invoices
      .filter((invoice) => {
        if (invoice.status === "Anulada") return false;
        if (billingPeriod === "total") return true;

        const year = Number(invoice.issueDate.slice(0, 4));
        if (year !== currentYear) return false;
        if (billingPeriod === "year") return true;

        const month = Number(invoice.issueDate.slice(5, 7));
        return month === currentMonth;
      })
      .reduce((sum, invoice) => {
        const t = totals(invoice);
        return sum + t.base + t.vat - t.withholding;
      }, 0);
  }, [invoices, billingPeriod]);

  const monthlyBillingHistory = useMemo(() => {
    const groups = new Map<string, { year: number; month: number; invoices: number; total: number }>();

    invoices
      .filter((invoice) => invoice.status !== "Anulada" && invoice.issueDate)
      .forEach((invoice) => {
        const year = Number(invoice.issueDate.slice(0, 4));
        const month = Number(invoice.issueDate.slice(5, 7));
        if (!year || !month) return;

        const key = `${year}-${String(month).padStart(2, "0")}`;
        const current = groups.get(key) || { year, month, invoices: 0, total: 0 };
        const t = totals(invoice);
        current.invoices += 1;
        current.total += t.base + t.vat - t.withholding;
        groups.set(key, current);
      });

    return [...groups.values()]
      .sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month))
      .slice(0, 18);
  }, [invoices]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2500);
  }

  function exportBackup() {
    const parseLocal = (key: string) => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    };

    const backup = {
      schema: 1,
      version,
      exportedAt: new Date().toISOString(),
      main: {
        issuer,
        clients,
        activities,
        invoices,
        concepts: savedConcepts
      },
      fiscal: {
        expenses: parseLocal("facturas_expenses_v1"),
        taxRecords: parseLocal("facturas_tax_records_v1"),
        deletedExpenseIds: parseLocal("facturas_deleted_expenses_v1")
      }
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `facturas-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    flash("Copia de seguridad exportada.");
  }

  async function importBackup(file?: File) {
    if (!file) return;

    try {
      const backup = JSON.parse(await file.text());
      if (!backup?.main || !Array.isArray(backup.main.clients) || !Array.isArray(backup.main.invoices)) {
        return flash("El archivo no parece una copia válida de Facturas.");
      }

      const nextIssuer = { ...blankIssuer, ...(backup.main.issuer || {}) };
      const nextClients = mergeById<Client>(clients, backup.main.clients || []);
      const nextActivities = normalizeActivities(mergeById<ActivityPreset>(activities, backup.main.activities || []));
      const nextInvoices = mergeById<Invoice>(invoices, backup.main.invoices || []);
      const nextConcepts = mergeById<SavedConcept>(savedConcepts, backup.main.concepts || []);

      setIssuer(nextIssuer);
      setClients(nextClients);
      setActivities(nextActivities);
      setInvoices(nextInvoices);
      setSavedConcepts(nextConcepts);

      const fiscal = backup.fiscal || {};
      const currentExpenses = (() => {
        try { return JSON.parse(localStorage.getItem("facturas_expenses_v1") || "[]"); } catch { return []; }
      })();
      const currentRecords = (() => {
        try { return JSON.parse(localStorage.getItem("facturas_tax_records_v1") || "[]"); } catch { return []; }
      })();
      const currentDeletedExpenseIds = (() => {
        try { return JSON.parse(localStorage.getItem("facturas_deleted_expenses_v1") || "[]"); } catch { return []; }
      })();

      const mergedDeletedExpenseIds = [...new Set([
        ...currentDeletedExpenseIds,
        ...(fiscal.deletedExpenseIds || [])
      ])];
      const deletedSet = new Set(mergedDeletedExpenseIds);
      const mergedExpenses = mergeById<any>(currentExpenses, fiscal.expenses || [])
        .filter((item: any) => !deletedSet.has(item.id));
      const recordMap = new Map<string, any>();
      currentRecords.forEach((item: any) => recordMap.set(item.key, item));
      (fiscal.taxRecords || []).forEach((item: any) => recordMap.set(item.key, { ...(recordMap.get(item.key) || {}), ...item }));
      const mergedRecords = [...recordMap.values()];

      localStorage.setItem("facturas_expenses_v1", JSON.stringify(mergedExpenses));
      localStorage.setItem("facturas_tax_records_v1", JSON.stringify(mergedRecords));
      localStorage.setItem("facturas_deleted_expenses_v1", JSON.stringify(mergedDeletedExpenseIds));

      await Promise.all([
        fetch("/api/data", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issuer: nextIssuer,
            clients: nextClients,
            activities: nextActivities,
            invoices: nextInvoices,
            concepts: nextConcepts
          })
        }),
        fetch("/api/fiscal", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expenses: mergedExpenses,
            taxRecords: mergedRecords,
            deletedExpenseIds: mergedDeletedExpenseIds
          })
        })
      ]);

      flash("Copia importada y sincronizada.");
      window.setTimeout(() => window.location.reload(), 700);
    } catch {
      flash("No se pudo importar la copia de seguridad.");
    }
  }

  function updateLine(id: string, patch: Partial<InvoiceLine>) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.id === id ? { ...line, ...patch } : line))
    }));
  }

  function applyConcept(lineId: string, description: string) {
    const normalized = description.trim().toLocaleLowerCase("es");
    const saved = savedConcepts.find(
      (concept) => concept.description.trim().toLocaleLowerCase("es") === normalized
    );

    updateLine(lineId, saved
      ? {
          description,
          activityId: saved.activityId,
          unitPrice: saved.unitPrice,
          vat: saved.vat,
          withholding: saved.withholding
        }
      : { description });
  }

  function rememberConcepts(lines: InvoiceLine[]) {
    const usable = lines.filter((line) => line.description.trim());
    if (!usable.length) return;

    setSavedConcepts((current) => {
      const next = [...current];

      for (const line of usable) {
        const description = line.description.trim();
        const normalized = description.toLocaleLowerCase("es");
        const existingIndex = next.findIndex(
          (concept) => concept.description.trim().toLocaleLowerCase("es") === normalized
        );

        const concept: SavedConcept = {
          id: existingIndex >= 0 ? next[existingIndex].id : uid(),
          description,
          activityId: line.activityId,
          unitPrice: Number(line.unitPrice || 0),
          vat: Number(line.vat || 0),
          withholding: Number(line.withholding || 0),
          lastUsedAt: new Date().toISOString()
        };

        if (existingIndex >= 0) next[existingIndex] = concept;
        else next.push(concept);
      }

      return next
        .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
        .slice(0, 100);
    });
  }

  function chooseActivity(lineId: string, activityId: string) {
    const activity = activities.find((item) => item.id === activityId);
    updateLine(lineId, {
      activityId,
      ...(activity ? { vat: activity.vat, withholding: activity.withholding } : {})
    });
  }

  function addLine() {
    setDraft((current) => ({
      ...current,
      lines: [...current.lines, emptyLine(activities[0])]
    }));
  }

  function removeLine(id: string) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.length === 1
        ? current.lines
        : current.lines.filter((line) => line.id !== id)
    }));
  }

  function saveInvoice() {
    if (!draft.clientId) return flash("Selecciona un cliente.");
    if (!draft.lines.some((line) => line.description.trim())) return flash("Añade al menos un concepto.");
    if (!issuer.fiscalName || !issuer.taxId) return flash("Completa tus datos fiscales en Configuración.");

    const number = draft.number.trim() || nextNumber(draft.series, invoices);
    const saved: Invoice = {
      ...draft,
      number,
      status: draft.status === "Borrador" ? "Emitida" : draft.status,
      createdAt: editingId
        ? invoices.find((item) => item.id === editingId)?.createdAt || draft.createdAt
        : new Date().toISOString()
    };

    setInvoices((current) =>
      editingId
        ? current.map((item) => (item.id === editingId ? saved : item))
        : [...current, saved]
    );
    rememberConcepts(saved.lines);
    setEditingId(null);
    setDraft(emptyInvoice(activities[0]));
    setTab("facturas");
    flash(editingId ? "Factura actualizada." : `Factura ${number} guardada.`);
  }

  function editInvoice(invoice: Invoice) {
    setDraft(JSON.parse(JSON.stringify(invoice)));
    setEditingId(invoice.id);
    setTab("nueva");
  }

  function duplicateInvoice(invoice: Invoice) {
    setDraft({
      ...JSON.parse(JSON.stringify(invoice)),
      id: uid(),
      number: "",
      issueDate: dateISO(),
      operationDate: dateISO(),
      dueDate: dateISO(),
      status: "Borrador",
      createdAt: new Date().toISOString()
    });
    setEditingId(null);
    setTab("nueva");
  }

  function deleteInvoice(id: string) {
    if (!window.confirm("¿Eliminar esta factura? Esta acción no se puede deshacer.")) return;
    setInvoices((current) => current.filter((item) => item.id !== id));
  }

  function printInvoice(invoice: Invoice) {
    setPreview(invoice);
    window.setTimeout(() => window.print(), 100);
  }

  function saveClient() {
    if (!clientDraft.name.trim() || !clientDraft.taxId.trim()) {
      return flash("Nombre/razón social y NIF/CIF son obligatorios.");
    }

    const editing = Boolean(clientDraft.id);
    const client: Client = {
      ...clientDraft,
      id: clientDraft.id || uid(),
      name: clientDraft.name.trim(),
      taxId: clientDraft.taxId.trim(),
      phone: (clientDraft.phone || "").trim(),
      notes: clientDraft.notes || ""
    };

    setClients((current) => editing
      ? current.map((item) => item.id === client.id ? client : item)
      : [...current, client]);
    setClientDraft({ ...blankClient });
    flash(editing ? "Cliente actualizado." : "Cliente guardado.");
  }

  function editClient(client: Client) {
    setClientDraft({ ...blankClient, ...client });
  }

  function deleteClient(client: Client) {
    if (invoices.some((invoice) => invoice.clientId === client.id)) {
      return flash("No puedes eliminar un cliente con facturas vinculadas. Puedes editarlo.");
    }
    if (!window.confirm(`¿Eliminar a ${client.name}? Esta acción no se puede deshacer.`)) return;
    setClients((current) => current.filter((item) => item.id !== client.id));
    if (clientDraft.id === client.id) setClientDraft({ ...blankClient });
    flash("Cliente eliminado.");
  }

  function addActivity() {
    if (!activityDraft.name.trim()) return flash("Pon un nombre a la actividad.");
    setActivities((current) => [...current, { ...activityDraft, id: uid() }]);
    setActivityDraft({ name: "", vat: 21, withholding: 0 });
    flash("Actividad añadida.");
  }

  function updateSavedConcept(id: string, patch: Partial<SavedConcept>) {
    setSavedConcepts((current) =>
      current.map((concept) => concept.id === id ? { ...concept, ...patch } : concept)
    );
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  if (!ready) {
    return <main className="loading">Cargando gestor…</main>;
  }

  const printClient = preview ? clients.find((client) => client.id === preview.clientId) : undefined;
  const printTotals = preview ? totals(preview) : null;

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div>
            <div className="logo-row">
              <div className="brand-mark small">F</div>
              <div>
                <strong>Facturas</strong>
                <span>Gestor privado</span>
              </div>
            </div>

            <nav>
              <button className={tab === "facturas" ? "active" : ""} onClick={() => setTab("facturas")}>
                <span>▦</span> Facturas
              </button>
              <button className={tab === "nueva" ? "active" : ""} onClick={() => {
                setEditingId(null);
                setDraft(emptyInvoice(activities[0]));
                setTab("nueva");
              }}>
                <span>＋</span> Nueva factura
              </button>
              <button className={tab === "clientes" ? "active" : ""} onClick={() => setTab("clientes")}>
                <span>♙</span> Clientes
              </button>
              <button className={tab === "fiscal" ? "active" : ""} onClick={() => setTab("fiscal")}>
                <span>◫</span> Trimestrales
              </button>
              <button className={tab === "config" ? "active" : ""} onClick={() => setTab("config")}>
                <span>⚙</span> Configuración
              </button>
            </nav>
          </div>

          <div className="sidebar-footer">
            <div className="version-badge">
              <strong>v{version}</strong>
              <span>deploy {deployment}</span>
            </div>
            <button className="logout" onClick={logout}>Cerrar sesión</button>
          </div>
        </aside>

        <main className="content">
          {notice && <div className="toast">{notice}</div>}

          {tab === "facturas" && (
            <section>
              <header className="page-header">
                <div>
                  <p className="eyebrow">Resumen</p>
                  <h1>Facturas</h1>
                  <p className="muted">Consulta, edita, duplica o exporta tus facturas.</p>
                </div>
                <button className="button primary" onClick={() => {
                  setEditingId(null);
                  setDraft(emptyInvoice(activities[0]));
                  setTab("nueva");
                }}>＋ Nueva factura</button>
              </header>

              <div className="stats-grid">
                <article className="stat-card billed-card">
                  <div className="stat-card-head">
                    <span>Facturado</span>
                    <select
                      className="stat-period-select"
                      value={billingPeriod}
                      onChange={(e) => setBillingPeriod(e.target.value as BillingPeriod)}
                      aria-label="Periodo de facturación"
                    >
                      <option value="month">Este mes</option>
                      <option value="year">Este año</option>
                      <option value="total">Total</option>
                    </select>
                  </div>
                  <button
                    className="billing-value"
                    onClick={() => setBillingVisible((visible) => !visible)}
                    aria-label={billingVisible ? "Ocultar facturación" : "Mostrar facturación"}
                  >
                    <strong>{billingVisible ? currency(billedAmount) : "•••••• €"}</strong>
                    <span>{billingVisible ? "Ocultar" : "Mostrar"}</span>
                  </button>
                </article>
                <article className="stat-card">
                  <span>Facturas</span>
                  <strong>{invoices.length}</strong>
                </article>
                <article className="stat-card">
                  <span>Pendientes</span>
                  <strong>{invoices.filter((item) => item.status === "Emitida").length}</strong>
                </article>
                <article className="stat-card">
                  <span>Cobradas</span>
                  <strong>{invoices.filter((item) => item.status === "Cobrada").length}</strong>
                </article>
              </div>

              <div className="billing-history-wrap">
                <button
                  className="button secondary billing-history-toggle"
                  onClick={() => setBillingHistoryVisible((visible) => !visible)}
                >
                  {billingHistoryVisible ? "Ocultar historial mensual" : "Ver historial mensual"}
                </button>

                {billingHistoryVisible && (
                  <div className="panel monthly-history">
                    <div className="section-title">
                      <div>
                        <h2>Historial mensual</h2>
                        <p className="muted">Resumen rápido de los meses con facturación.</p>
                      </div>
                    </div>
                    {monthlyBillingHistory.length === 0 ? (
                      <p className="muted">Todavía no hay meses con facturas.</p>
                    ) : (
                      <div className="monthly-history-grid">
                        {monthlyBillingHistory.map((item) => {
                          const label = new Date(item.year, item.month - 1, 1).toLocaleDateString("es-ES", {
                            month: "long",
                            year: "numeric"
                          });
                          return (
                            <article key={`${item.year}-${item.month}`}>
                              <span>{label}</span>
                              <strong>{billingVisible ? currency(item.total) : "•••••• €"}</strong>
                              <small>{item.invoices} {item.invoices === 1 ? "factura" : "facturas"}</small>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="panel table-panel">
                {recentInvoices.length === 0 ? (
                  <div className="empty-state">
                    <div>⌁</div>
                    <h3>Todavía no hay facturas</h3>
                    <p>Crea la primera y aparecerá aquí.</p>
                    <button className="button primary" onClick={() => setTab("nueva")}>Crear factura</button>
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Número</th>
                          <th>Fecha</th>
                          <th>Cliente</th>
                          <th>Estado</th>
                          <th className="right">Total</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentInvoices.map((invoice) => {
                          const client = clients.find((item) => item.id === invoice.clientId);
                          const t = totals(invoice);
                          return (
                            <tr key={invoice.id}>
                              <td><strong>{invoice.number || "Sin número"}</strong></td>
                              <td>{invoice.issueDate}</td>
                              <td>{client?.name || "Cliente eliminado"}</td>
                              <td><span className={`status ${invoice.status.toLowerCase()}`}>{invoice.status}</span></td>
                              <td className="right"><strong>{currency(t.base + t.vat - t.withholding)}</strong></td>
                              <td className="actions">
                                <button onClick={() => printInvoice(invoice)}>PDF</button>
                                <button onClick={() => editInvoice(invoice)}>Editar</button>
                                <button onClick={() => duplicateInvoice(invoice)}>Duplicar</button>
                                <button className="danger-link" onClick={() => deleteInvoice(invoice.id)}>Eliminar</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}

          {tab === "nueva" && (
            <section>
              <header className="page-header">
                <div>
                  <p className="eyebrow">{editingId ? "Editar" : "Nueva"}</p>
                  <h1>{editingId ? `Factura ${draft.number}` : "Crear factura"}</h1>
                  <p className="muted">Cada línea puede tener una actividad, IVA y retención diferentes.</p>
                </div>
                <div className="header-actions">
                  <button className="button secondary" onClick={() => setTab("facturas")}>Cancelar</button>
                  <button className="button primary" onClick={saveInvoice}>Guardar factura</button>
                </div>
              </header>

              <div className="invoice-layout">
                <div className="stack">
                  <div className="panel">
                    <div className="section-title">
                      <div><span className="step">1</span><h2>Datos de factura</h2></div>
                    </div>
                    <div className="form-grid four">
                      <label>Serie
                        <input value={draft.series} onChange={(e) => setDraft({ ...draft, series: e.target.value })} />
                      </label>
                      <label>Número
                        <input value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })} placeholder="Automático al guardar" />
                      </label>
                      <label>Fecha emisión
                        <input type="date" value={draft.issueDate} onChange={(e) => setDraft({ ...draft, issueDate: e.target.value })} />
                      </label>
                      <label>Fecha operación
                        <input type="date" value={draft.operationDate} onChange={(e) => setDraft({ ...draft, operationDate: e.target.value })} />
                      </label>
                      <label>Vencimiento
                        <input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
                      </label>
                      <label>Estado
                        <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}>
                          <option>Borrador</option><option>Emitida</option><option>Cobrada</option><option>Anulada</option>
                        </select>
                      </label>
                      <label className="span-2">Cliente
                        <select value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}>
                          <option value="">Selecciona un cliente…</option>
                          {clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.taxId}</option>)}
                        </select>
                      </label>
                    </div>
                    {clients.length === 0 && <p className="hint">Primero crea un cliente desde la pestaña Clientes.</p>}
                  </div>

                  <div className="panel">
                    <div className="section-title">
                      <div><span className="step">2</span><h2>Conceptos y actividades</h2></div>
                      <button className="button small secondary" onClick={addLine}>＋ Añadir línea</button>
                    </div>

                    <datalist id="saved-concepts">
                      {savedConcepts.map((concept) => (
                        <option
                          key={concept.id}
                          value={concept.description}
                          label={concept.unitPrice ? `${currency(concept.unitPrice)} · IVA ${concept.vat}% · IRPF ${concept.withholding}%` : undefined}
                        />
                      ))}
                    </datalist>

                    <div className="line-head">
                      <span>Actividad / concepto</span><span>Cant.</span><span>Precio</span><span>IVA %</span><span>IRPF %</span><span>Total base</span><span></span>
                    </div>

                    {draft.lines.map((line) => (
                      <div className="invoice-line" key={line.id}>
                        <div className="line-description">
                          <select value={line.activityId} onChange={(e) => chooseActivity(line.id, e.target.value)}>
                            <option value="">Sin actividad predefinida</option>
                            {activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
                          </select>
                          <input
                            list="saved-concepts"
                            autoComplete="off"
                            value={line.description}
                            onChange={(e) => applyConcept(line.id, e.target.value)}
                            placeholder="Descripción del servicio o trabajo realizado"
                          />
                        </div>
                        <input type="number" min="0" step="0.01" value={line.quantity} onChange={(e) => updateLine(line.id, { quantity: Number(e.target.value) })} />
                        <input type="number" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(line.id, { unitPrice: Number(e.target.value) })} />
                        <input type="number" step="0.01" value={line.vat} onChange={(e) => updateLine(line.id, { vat: Number(e.target.value) })} />
                        <input type="number" step="0.01" value={line.withholding} onChange={(e) => updateLine(line.id, { withholding: Number(e.target.value) })} />
                        <strong>{currency(lineBase(line))}</strong>
                        <button className="icon-button" onClick={() => removeLine(line.id)} title="Eliminar línea">×</button>
                      </div>
                    ))}

                    <div className="tax-explanation">
                      <strong>Retención por línea</strong>
                      <span>Puedes mezclar, por ejemplo, una línea al 15%, otra al 7% y otra al 0% dentro de la misma factura. Los conceptos usados se guardan automáticamente y aparecerán como sugerencia la próxima vez.</span>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="section-title">
                      <div><span className="step">3</span><h2>Pago y observaciones</h2></div>
                    </div>
                    <div className="form-grid two">
                      <label>Forma de pago
                        <input value={draft.paymentMethod} onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })} />
                      </label>
                      <label>IBAN
                        <input value={issuer.iban} onChange={(e) => setIssuer({ ...issuer, iban: e.target.value })} placeholder="Se toma de Configuración" />
                      </label>
                      <label className="span-2">Notas
                        <textarea rows={4} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Condiciones, referencia del servicio, observaciones…" />
                      </label>
                    </div>
                  </div>
                </div>

                <aside className="summary-card">
                  <p className="eyebrow">Total factura</p>
                  <div className="summary-row"><span>Base imponible</span><strong>{currency(draftTotals.base)}</strong></div>
                  {groupTax(draft.lines, "vat").map(([rate, row]) => (
                    <div className="summary-row sub" key={`vat-${rate}`}><span>IVA {rate}%</span><span>+ {currency(row.amount)}</span></div>
                  ))}
                  {groupTax(draft.lines, "withholding").map(([rate, row]) => (
                    <div className="summary-row sub retention" key={`ret-${rate}`}><span>IRPF {rate}%</span><span>− {currency(row.amount)}</span></div>
                  ))}
                  <div className="summary-total">
                    <span>Total</span>
                    <strong>{currency(draftTotals.base + draftTotals.vat - draftTotals.withholding)}</strong>
                  </div>
                  <p className="summary-note">La retención reduce el importe a cobrar, no la base imponible.</p>
                  <button className="button primary wide" onClick={saveInvoice}>Guardar factura</button>
                </aside>
              </div>
            </section>
          )}

          {tab === "clientes" && (
            <section>
              <header className="page-header">
                <div>
                  <p className="eyebrow">Directorio</p>
                  <h1>Clientes</h1>
                  <p className="muted">Guarda los datos fiscales una vez y reutilízalos en futuras facturas.</p>
                </div>
              </header>

              <div className="split-layout">
                <div className="panel">
                  <h2>{clientDraft.id ? "Editar cliente" : "Nuevo cliente"}</h2>
                  <div className="form-grid two">
                    <label>Nombre / razón social<input value={clientDraft.name} onChange={(e) => setClientDraft({ ...clientDraft, name: e.target.value })} /></label>
                    <label>NIF / CIF<input value={clientDraft.taxId} onChange={(e) => setClientDraft({ ...clientDraft, taxId: e.target.value })} /></label>
                    <label className="span-2">Dirección<input value={clientDraft.address} onChange={(e) => setClientDraft({ ...clientDraft, address: e.target.value })} /></label>
                    <label>Código postal<input value={clientDraft.postalCode} onChange={(e) => setClientDraft({ ...clientDraft, postalCode: e.target.value })} /></label>
                    <label>Ciudad<input value={clientDraft.city} onChange={(e) => setClientDraft({ ...clientDraft, city: e.target.value })} /></label>
                    <label>Provincia<input value={clientDraft.province} onChange={(e) => setClientDraft({ ...clientDraft, province: e.target.value })} /></label>
                    <label>Email<input type="email" value={clientDraft.email} onChange={(e) => setClientDraft({ ...clientDraft, email: e.target.value })} /></label>
                    <label>Teléfono<input type="tel" autoComplete="tel" placeholder="+34 600 000 000" value={clientDraft.phone || ""} onChange={(e) => setClientDraft({ ...clientDraft, phone: e.target.value })} /></label>
                    <label className="span-2">Notas internas del contacto
                      <textarea
                        rows={5}
                        placeholder="Persona de contacto, horarios, acuerdos, recordatorios…"
                        value={clientDraft.notes || ""}
                        onChange={(e) => setClientDraft({ ...clientDraft, notes: e.target.value })}
                      />
                      <span className="field-hint">Estas notas son privadas y no aparecen en las facturas.</span>
                    </label>
                  </div>
                  <div className="client-form-actions">
                    <button className="button primary" onClick={saveClient}>{clientDraft.id ? "Guardar cambios" : "Guardar cliente"}</button>
                    {clientDraft.id && (
                      <button className="button secondary" onClick={() => setClientDraft({ ...blankClient })}>Cancelar edición</button>
                    )}
                  </div>
                </div>

                <div className="panel">
                  <h2>Clientes guardados</h2>
                  <div className="cards-list">
                    {clients.length === 0 && <p className="muted">Aún no has guardado clientes.</p>}
                    {clients.map((client) => (
                      <article className="client-card" key={client.id}>
                        <div>
                          <strong>{client.name}</strong>
                          <span>{client.taxId}</span>
                          {client.phone && <span><strong className="contact-label">Tel.</strong> {client.phone}</span>}
                          {client.email && <small>{client.email}</small>}
                          <small>{[client.address, client.postalCode, client.city].filter(Boolean).join(", ")}</small>
                          {client.notes && <p className="client-notes">{client.notes}</p>}
                        </div>
                        <div className="client-actions">
                          <button className="button small secondary" onClick={() => editClient(client)}>Editar</button>
                          <button className="danger-link" onClick={() => deleteClient(client)}>Eliminar</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {tab === "fiscal" && <FiscalPanel invoices={invoices} />}

          {tab === "config" && (
            <section>
              <header className="page-header">
                <div>
                  <p className="eyebrow">Preferencias</p>
                  <h1>Configuración</h1>
                  <p className="muted">Datos del emisor y actividades que usarás habitualmente.</p>
                </div>
              </header>

              <div className="stack">
                <div className="panel">
                  <h2>Tus datos fiscales</h2>
                  <div className="form-grid three">
                    <label>Nombre / razón social<input value={issuer.fiscalName} onChange={(e) => setIssuer({ ...issuer, fiscalName: e.target.value })} /></label>
                    <label>NIF<input value={issuer.taxId} onChange={(e) => setIssuer({ ...issuer, taxId: e.target.value })} /></label>
                    <label>Email<input value={issuer.email} onChange={(e) => setIssuer({ ...issuer, email: e.target.value })} /></label>
                    <label className="span-2">Dirección fiscal<input value={issuer.address} onChange={(e) => setIssuer({ ...issuer, address: e.target.value })} /></label>
                    <label>Teléfono<input value={issuer.phone} onChange={(e) => setIssuer({ ...issuer, phone: e.target.value })} /></label>
                    <label>Código postal<input value={issuer.postalCode} onChange={(e) => setIssuer({ ...issuer, postalCode: e.target.value })} /></label>
                    <label>Ciudad<input value={issuer.city} onChange={(e) => setIssuer({ ...issuer, city: e.target.value })} /></label>
                    <label>Provincia<input value={issuer.province} onChange={(e) => setIssuer({ ...issuer, province: e.target.value })} /></label>
                    <label className="span-2">IBAN<input value={issuer.iban} onChange={(e) => setIssuer({ ...issuer, iban: e.target.value })} /></label>
                  </div>
                  <p className="saved-note">
                    {remoteConfigured
                      ? "Los cambios se guardan automáticamente en la base de datos y también en este navegador."
                      : "Los cambios se guardan automáticamente en este navegador hasta conectar la base de datos."}
                  </p>
                </div>

                <div className="panel">
                  <div className="section-title">
                    <div><h2>Actividades y retenciones</h2><p className="muted">Crea presets para rellenar IVA e IRPF automáticamente en cada línea.</p></div>
                  </div>

                  <div className="activity-create">
                    <input placeholder="Nombre de la actividad" value={activityDraft.name} onChange={(e) => setActivityDraft({ ...activityDraft, name: e.target.value })} />
                    <label>IVA %<input type="number" value={activityDraft.vat} onChange={(e) => setActivityDraft({ ...activityDraft, vat: Number(e.target.value) })} /></label>
                    <label>IRPF %<input type="number" value={activityDraft.withholding} onChange={(e) => setActivityDraft({ ...activityDraft, withholding: Number(e.target.value) })} /></label>
                    <button className="button primary" onClick={addActivity}>Añadir</button>
                  </div>

                  <div className="activity-list">
                    {activities.map((activity) => (
                      <article key={activity.id}>
                        <div><strong>{activity.name}</strong><span>IVA {activity.vat}% · IRPF {activity.withholding}%</span></div>
                        <button className="danger-link" onClick={() => setActivities((current) => current.filter((item) => item.id !== activity.id))}>Eliminar</button>
                      </article>
                    ))}
                  </div>
                  <p className="legal-note">La aplicación calcula los importes según los porcentajes que indiques; no determina por sí sola cuándo una retención es fiscalmente aplicable.</p>
                </div>

                <div className="panel">
                  <div className="section-title">
                    <div>
                      <h2>Conceptos guardados</h2>
                      <p className="muted">Se crean automáticamente al usarlos en una factura. Aquí puedes corregirlos o actualizar sus valores habituales.</p>
                    </div>
                  </div>

                  {savedConcepts.length === 0 ? (
                    <p className="muted">Todavía no hay conceptos guardados.</p>
                  ) : (
                    <div className="saved-concepts-editor">
                      {savedConcepts.map((concept) => (
                        <article key={concept.id}>
                          <label className="concept-name">Concepto
                            <input
                              value={concept.description}
                              onChange={(e) => updateSavedConcept(concept.id, { description: e.target.value })}
                            />
                          </label>
                          <label>Actividad
                            <select
                              value={concept.activityId}
                              onChange={(e) => {
                                const activity = activities.find((item) => item.id === e.target.value);
                                updateSavedConcept(concept.id, {
                                  activityId: e.target.value,
                                  ...(activity ? { vat: activity.vat, withholding: activity.withholding } : {})
                                });
                              }}
                            >
                              <option value="">Sin actividad</option>
                              {activities.map((activity) => (
                                <option key={activity.id} value={activity.id}>{activity.name}</option>
                              ))}
                            </select>
                          </label>
                          <label>Precio habitual
                            <input
                              type="number"
                              step="0.01"
                              value={concept.unitPrice}
                              onChange={(e) => updateSavedConcept(concept.id, { unitPrice: Number(e.target.value) })}
                            />
                          </label>
                          <label>IVA %
                            <input
                              type="number"
                              step="0.01"
                              value={concept.vat}
                              onChange={(e) => updateSavedConcept(concept.id, { vat: Number(e.target.value) })}
                            />
                          </label>
                          <label>IRPF %
                            <input
                              type="number"
                              step="0.01"
                              value={concept.withholding}
                              onChange={(e) => updateSavedConcept(concept.id, { withholding: Number(e.target.value) })}
                            />
                          </label>
                        </article>
                      ))}
                    </div>
                  )}
                  <p className="saved-note">Los cambios se guardan automáticamente y se usarán la próxima vez que selecciones ese concepto.</p>
                </div>

                <div className="panel version-panel">
                  <h2>Versión de la aplicación</h2>
                  <div className="version-details">
                    <span><strong>Versión</strong><b>v{version}</b></span>
                    <span><strong>Deployment</strong><b>{deployment}</b></span>
                  </div>
                  <p className="saved-note">Cada actualización funcional llevará una versión nueva. El identificador de deployment te permite saber exactamente qué build estás usando.</p>
                </div>

                <div className="panel data-warning">
                  <h2>Datos y copias de seguridad</h2>
                  <p>
                    {remoteConfigured
                      ? "Supabase conectado: los datos se sincronizan entre dispositivos, se conserva una copia local y el servidor crea un snapshot antes de cada escritura."
                      : "La copia local sigue activa. Si la sincronización remota falla, tus datos permanecen en este navegador hasta recuperar la conexión."}
                  </p>
                  <div className="backup-actions">
                    <button className="button secondary" onClick={exportBackup}>Exportar copia JSON</button>
                    <label className="button secondary backup-import">
                      Importar copia
                      <input
                        type="file"
                        accept="application/json,.json"
                        onChange={(e) => {
                          void importBackup(e.target.files?.[0]);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                  <p className="saved-note">Recomendación: exporta una copia antes de cambios importantes. Importar una copia fusiona los datos existentes; no elimina registros que ya estén en Supabase.</p>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      <section id="print-sheet">
        {preview && printClient && printTotals && (
          <div className="invoice-paper">
            <header className="invoice-print-header">
              <div>
                <div className="print-brand">FACTURA</div>
                <h1>{preview.number}</h1>
                <p>Fecha de emisión: {preview.issueDate}</p>
                {preview.operationDate && <p>Fecha de operación: {preview.operationDate}</p>}
              </div>
              <div className="issuer-print">
                <strong>{issuer.fiscalName}</strong>
                <span>{issuer.taxId}</span>
                <span>{issuer.address}</span>
                <span>{issuer.postalCode} {issuer.city} {issuer.province}</span>
                <span>{issuer.email}</span>
              </div>
            </header>

            <div className="bill-to">
              <span>FACTURAR A</span>
              <strong>{printClient.name}</strong>
              <p>{printClient.taxId}</p>
              <p>{printClient.address}</p>
              <p>{printClient.postalCode} {printClient.city} {printClient.province}</p>
            </div>

            <table className="print-table">
              <thead><tr><th>Concepto</th><th>Cant.</th><th>Precio</th><th>IVA</th><th>IRPF</th><th>Base</th></tr></thead>
              <tbody>
                {preview.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.description}</td>
                    <td>{line.quantity}</td>
                    <td>{currency(line.unitPrice)}</td>
                    <td>{line.vat}%</td>
                    <td>{line.withholding}%</td>
                    <td>{currency(lineBase(line))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="print-bottom">
              <div className="payment-print">
                <strong>Pago</strong>
                <p>{preview.paymentMethod}</p>
                {issuer.iban && <p>IBAN: {issuer.iban}</p>}
                {preview.dueDate && <p>Vencimiento: {preview.dueDate}</p>}
                {preview.notes && <><strong>Observaciones</strong><p>{preview.notes}</p></>}
              </div>
              <div className="print-totals">
                <div><span>Base imponible</span><strong>{currency(printTotals.base)}</strong></div>
                {groupTax(preview.lines, "vat").map(([rate, row]) => (
                  <div key={`pv-${rate}`}><span>IVA {rate}% s/ {currency(row.base)}</span><strong>{currency(row.amount)}</strong></div>
                ))}
                {groupTax(preview.lines, "withholding").map(([rate, row]) => (
                  <div key={`pr-${rate}`}><span>IRPF {rate}% s/ {currency(row.base)}</span><strong>− {currency(row.amount)}</strong></div>
                ))}
                <div className="grand-total"><span>TOTAL</span><strong>{currency(printTotals.base + printTotals.vat - printTotals.withholding)}</strong></div>
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
