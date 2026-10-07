"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import FiscalPanel from "@/components/FiscalPanel";
import { downloadInvoicePdf } from "@/lib/invoicePdf";

type Tab = "facturas" | "nueva" | "clientes" | "fiscal" | "config";
type BillingPeriod = "month" | "year" | "total";
type InvoiceMode = "normal" | "monthly";
type Status = "Borrador" | "Emitida" | "Cobrada" | "Anulada";
type InvoiceSortKey = "number" | "date" | "client" | "status" | "total";
type SortDirection = "asc" | "desc";
type SyncStatus = "local" | "sincronizando" | "sincronizado" | "error" | "sesion";

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
  updatedAt?: string;
};

type ActivityPreset = {
  id: string;
  name: string;
  vat: number;
  withholding: number;
  updatedAt?: string;
};

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

type SavedConcept = {
  id: string;
  description: string;
  activityId: string;
  unitPrice: number;
  vat: number;
  withholding: number;
  lastUsedAt: string;
  updatedAt?: string;
};

type Invoice = {
  id: string;
  number: string;
  series: string;
  issueDate: string;
  operationDate: string;
  invoiceMode?: InvoiceMode;
  periodFrom?: string;
  periodTo?: string;
  dueDate: string;
  clientId: string;
  lines: InvoiceLine[];
  notes: string;
  paymentMethod: string;
  status: Status;
  internalNote?: string;
  issuerSnapshot?: Issuer;
  clientSnapshot?: Client;
  createdAt: string;
  updatedAt?: string;
};

const storage = {
  issuer: "facturas_issuer_v1",
  issuerUpdatedAt: "facturas_issuer_updated_at_v1",
  clients: "facturas_clients_v1",
  activities: "facturas_activities_v1",
  invoices: "facturas_invoices_v1",
  concepts: "facturas_concepts_v1",
  deletedClients: "facturas_deleted_clients_v1",
  deletedInvoices: "facturas_deleted_invoices_v1",
  deletedActivities: "facturas_deleted_activities_v1",
  deletedConcepts: "facturas_deleted_concepts_v1"
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
  const migrated = items.filter((activity) => !legacyActivityIds.has(activity.id));

  const presets = defaultActivities.map((preset) => {
    const saved = migrated.find((activity) => activity.id === preset.id);
    return saved ? { ...preset, ...saved, id: preset.id } : preset;
  });

  const custom = migrated.filter(
    (activity) => !defaultActivities.some((preset) => preset.id === activity.id)
  );

  return [...presets, ...custom];
}

function nowISO() {
  return new Date().toISOString();
}

function timestamp(value?: string) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeById<T extends { id: string; updatedAt?: string }>(remote: T[], local: T[]) {
  const map = new Map<string, T>();
  remote.forEach((item) => map.set(item.id, item));

  local.forEach((item) => {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, { ...item, updatedAt: item.updatedAt || nowISO() });
      return;
    }

    const localTs = timestamp(item.updatedAt);
    const remoteTs = timestamp(existing.updatedAt);
    if (localTs > remoteTs) map.set(item.id, { ...existing, ...item });
  });

  return [...map.values()];
}

function mergeIds(remote: string[] = [], local: string[] = []) {
  return [...new Set([...remote, ...local])];
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeIssuerState(
  remote: Partial<Issuer> | undefined,
  remoteUpdatedAt: string | undefined,
  local: Issuer,
  localUpdatedAt: string
) {
  if (!remote || Object.keys(remote).length === 0) {
    return {
      issuer: local,
      updatedAt: localUpdatedAt || (Object.values(local).some(Boolean) ? nowISO() : "")
    };
  }

  if (timestamp(localUpdatedAt) > timestamp(remoteUpdatedAt)) {
    return { issuer: local, updatedAt: localUpdatedAt };
  }

  return {
    issuer: { ...blankIssuer, ...remote },
    updatedAt: remoteUpdatedAt || nowISO()
  };
}

function uid() {
  return crypto.randomUUID();
}

function dateISO() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
}

function monthRange(date: string) {
  const safeDate = date || dateISO();
  const [year, month] = safeDate.split("-").map(Number);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const last = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { first, last };
}

function money(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function emptyLine(activity?: ActivityPreset): InvoiceLine {
  return {
    id: uid(),
    activityId: activity?.id || "",
    description: "",
    serviceDate: "",
    quantity: 1,
    unitPrice: 0,
    vat: activity?.vat ?? 21,
    withholding: activity?.withholding ?? 0
  };
}

function emptyInvoice(activity?: ActivityPreset): Invoice {
  const today = dateISO();
  const stamp = nowISO();
  return {
    id: uid(),
    number: "",
    series: String(new Date().getFullYear()),
    issueDate: today,
    operationDate: today,
    invoiceMode: "normal",
    periodFrom: "",
    periodTo: "",
    dueDate: today,
    clientId: "",
    lines: [emptyLine(activity)],
    notes: "",
    paymentMethod: "Transferencia bancaria",
    status: "Borrador",
    internalNote: "",
    createdAt: stamp,
    updatedAt: stamp
  };
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

function totals(invoice: Invoice) {
  return invoice.lines.reduce(
    (acc, line) => {
      const base = lineBase(line);
      acc.base = money(acc.base + base);
      acc.vat = money(acc.vat + money(base * (Number(line.vat || 0) / 100)));
      acc.withholding = money(acc.withholding + money(base * (Number(line.withholding || 0) / 100)));
      return acc;
    },
    { base: 0, vat: 0, withholding: 0 }
  );
}

function invoiceCountsAsIssued(invoice: Invoice) {
  return invoice.status === "Emitida" || invoice.status === "Cobrada";
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
    current.base = money(current.base + base);
    current.amount = money(current.amount + money(base * (rate / 100)));
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
  const [billingCalendarOpen, setBillingCalendarOpen] = useState(false);
  const [billingCalendarMonth, setBillingCalendarMonth] = useState(() => dateISO().slice(0, 7));
  const [selectedBillingDay, setSelectedBillingDay] = useState<string | null>(null);
  const [invoiceSort, setInvoiceSort] = useState<{ key: InvoiceSortKey; direction: SortDirection }>({
    key: "date",
    direction: "desc"
  });
  const [invoiceFilters, setInvoiceFilters] = useState({
    number: "",
    dateFrom: "",
    dateTo: "",
    clientId: "",
    status: "",
    totalMin: "",
    totalMax: ""
  });
  const [ready, setReady] = useState(false);
  const [issuer, setIssuer] = useState<Issuer>(blankIssuer);
  const [issuerUpdatedAt, setIssuerUpdatedAt] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [activities, setActivities] = useState<ActivityPreset[]>(defaultActivities);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [savedConcepts, setSavedConcepts] = useState<SavedConcept[]>([]);
  const [deletedClientIds, setDeletedClientIds] = useState<string[]>([]);
  const [deletedInvoiceIds, setDeletedInvoiceIds] = useState<string[]>([]);
  const [deletedActivityIds, setDeletedActivityIds] = useState<string[]>([]);
  const [deletedConceptIds, setDeletedConceptIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<Invoice>(() => emptyInvoice(defaultActivities[0]));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Invoice | null>(null);
  const [clientDraft, setClientDraft] = useState<Client>({ ...blankClient });
  const [activityDraft, setActivityDraft] = useState({ name: "", vat: 21, withholding: 0 });
  const [notice, setNotice] = useState("");
  const [remoteConfigured, setRemoteConfigured] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("local");
  const [lastSyncedAt, setLastSyncedAt] = useState("");
  const skipNextSyncRef = useRef(false);

  function mainPayload() {
    return {
      issuer,
      issuerUpdatedAt,
      clients,
      activities,
      invoices,
      concepts: savedConcepts,
      deletedClientIds,
      deletedInvoiceIds,
      deletedActivityIds,
      deletedConceptIds
    };
  }

  function applyRemoteState(remote: any) {
    if (!remote) return false;

    const nextDeletedClients = mergeIds(remote.deletedClientIds || [], deletedClientIds);
    const nextDeletedInvoices = mergeIds(remote.deletedInvoiceIds || [], deletedInvoiceIds);
    const nextDeletedActivities = mergeIds(remote.deletedActivityIds || [], deletedActivityIds);
    const nextDeletedConcepts = mergeIds(remote.deletedConceptIds || [], deletedConceptIds);

    const nextClients = mergeById<Client>(remote.clients || [], clients)
      .filter((item) => !nextDeletedClients.includes(item.id));
    const nextActivities = normalizeActivities(
      mergeById<ActivityPreset>(remote.activities || [], activities)
        .filter((item) => !nextDeletedActivities.includes(item.id))
    );
    const nextInvoices = mergeById<Invoice>(remote.invoices || [], invoices)
      .filter((item) => !nextDeletedInvoices.includes(item.id));
    const nextConcepts = mergeById<SavedConcept>(remote.concepts || [], savedConcepts)
      .filter((item) => !nextDeletedConcepts.includes(item.id));

    const issuerMerge = mergeIssuerState(
      remote.issuer,
      remote.issuerUpdatedAt,
      issuer,
      issuerUpdatedAt
    );

    const changed =
      !sameJson(nextClients, clients) ||
      !sameJson(nextActivities, activities) ||
      !sameJson(nextInvoices, invoices) ||
      !sameJson(nextConcepts, savedConcepts) ||
      !sameJson(nextDeletedClients, deletedClientIds) ||
      !sameJson(nextDeletedInvoices, deletedInvoiceIds) ||
      !sameJson(nextDeletedActivities, deletedActivityIds) ||
      !sameJson(nextDeletedConcepts, deletedConceptIds) ||
      !sameJson(issuerMerge.issuer, issuer) ||
      issuerMerge.updatedAt !== issuerUpdatedAt;

    if (!changed) return false;

    skipNextSyncRef.current = true;
    setClients(nextClients);
    setActivities(nextActivities);
    setInvoices(nextInvoices);
    setSavedConcepts(nextConcepts);
    setDeletedClientIds(nextDeletedClients);
    setDeletedInvoiceIds(nextDeletedInvoices);
    setDeletedActivityIds(nextDeletedActivities);
    setDeletedConceptIds(nextDeletedConcepts);
    setIssuer(issuerMerge.issuer);
    setIssuerUpdatedAt(issuerMerge.updatedAt);
    return true;
  }

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
      let loadedIssuerUpdatedAt = read<string>(storage.issuerUpdatedAt, "");
      let loadedClients = read<Client[]>(storage.clients, []);
      let loadedActivities = normalizeActivities(read<ActivityPreset[]>(storage.activities, defaultActivities));
      let loadedInvoices = read<Invoice[]>(storage.invoices, []);
      let loadedConcepts = read<SavedConcept[]>(storage.concepts, []);
      let loadedDeletedClients = read<string[]>(storage.deletedClients, []);
      let loadedDeletedInvoices = read<string[]>(storage.deletedInvoices, []);
      let loadedDeletedActivities = read<string[]>(storage.deletedActivities, []);
      let loadedDeletedConcepts = read<string[]>(storage.deletedConcepts, []);

      const localHadData =
        Boolean(loadedIssuer.fiscalName || loadedIssuer.taxId) ||
        loadedClients.length > 0 ||
        loadedInvoices.length > 0 ||
        loadedConcepts.length > 0 ||
        loadedDeletedClients.length > 0 ||
        loadedDeletedInvoices.length > 0 ||
        loadedDeletedActivities.length > 0 ||
        loadedDeletedConcepts.length > 0;

      try {
        const response = await fetch("/api/data", { cache: "no-store" });
        const result = await response.json();

        if (response.status === 401) {
          setSyncStatus("sesion");
        } else if (response.ok && result.configured) {
          setRemoteConfigured(true);
          setSyncStatus("sincronizado");
          setLastSyncedAt(result.updatedAt || nowISO());

          const remote = result.data || {};
          loadedDeletedClients = mergeIds(remote.deletedClientIds || [], loadedDeletedClients);
          loadedDeletedInvoices = mergeIds(remote.deletedInvoiceIds || [], loadedDeletedInvoices);
          loadedDeletedActivities = mergeIds(remote.deletedActivityIds || [], loadedDeletedActivities);
          loadedDeletedConcepts = mergeIds(remote.deletedConceptIds || [], loadedDeletedConcepts);

          const issuerMerge = mergeIssuerState(
            remote.issuer,
            remote.issuerUpdatedAt,
            loadedIssuer,
            loadedIssuerUpdatedAt
          );
          loadedIssuer = issuerMerge.issuer;
          loadedIssuerUpdatedAt = issuerMerge.updatedAt;

          loadedClients = mergeById<Client>(remote.clients || [], loadedClients)
            .filter((item) => !loadedDeletedClients.includes(item.id));
          loadedActivities = normalizeActivities(
            mergeById<ActivityPreset>(remote.activities || [], loadedActivities)
              .filter((item) => !loadedDeletedActivities.includes(item.id))
          );
          loadedInvoices = mergeById<Invoice>(remote.invoices || [], loadedInvoices)
            .filter((item) => !loadedDeletedInvoices.includes(item.id));
          loadedConcepts = mergeById<SavedConcept>(remote.concepts || [], loadedConcepts)
            .filter((item) => !loadedDeletedConcepts.includes(item.id));

          let snapshotsAdded = false;
          loadedInvoices = loadedInvoices.map((invoice) => {
            if (invoice.status === "Borrador" || (invoice.issuerSnapshot && invoice.clientSnapshot)) {
              return invoice;
            }

            const client = loadedClients.find((item) => item.id === invoice.clientId);
            if (!client) return invoice;

            snapshotsAdded = true;
            return {
              ...invoice,
              issuerSnapshot: invoice.issuerSnapshot || { ...loadedIssuer },
              clientSnapshot: invoice.clientSnapshot || { ...client },
              updatedAt: nowISO()
            };
          });

          if (localHadData || snapshotsAdded) {
            const syncResponse = await fetch("/api/data", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                issuer: loadedIssuer,
                issuerUpdatedAt: loadedIssuerUpdatedAt,
                clients: loadedClients,
                activities: loadedActivities,
                invoices: loadedInvoices,
                concepts: loadedConcepts,
                deletedClientIds: loadedDeletedClients,
                deletedInvoiceIds: loadedDeletedInvoices,
                deletedActivityIds: loadedDeletedActivities,
                deletedConceptIds: loadedDeletedConcepts
              })
            });
            const synced = await syncResponse.json().catch(() => ({}));
            if (syncResponse.ok && synced.data) {
              loadedClients = synced.data.clients || loadedClients;
              loadedActivities = normalizeActivities(synced.data.activities || loadedActivities);
              loadedInvoices = synced.data.invoices || loadedInvoices;
              loadedConcepts = synced.data.concepts || loadedConcepts;
              loadedIssuer = { ...blankIssuer, ...(synced.data.issuer || loadedIssuer) };
              loadedIssuerUpdatedAt = synced.data.issuerUpdatedAt || loadedIssuerUpdatedAt;
              setLastSyncedAt(synced.updatedAt || nowISO());
            }
          }
        }
      } catch {
        setSyncStatus("error");
      }

      setIssuer(loadedIssuer);
      setIssuerUpdatedAt(loadedIssuerUpdatedAt);
      setClients(loadedClients);
      setActivities(loadedActivities.length ? loadedActivities : defaultActivities);
      setInvoices(loadedInvoices);
      setSavedConcepts(loadedConcepts);
      setDeletedClientIds(loadedDeletedClients);
      setDeletedInvoiceIds(loadedDeletedInvoices);
      setDeletedActivityIds(loadedDeletedActivities);
      setDeletedConceptIds(loadedDeletedConcepts);
      setDraft(emptyInvoice(loadedActivities[0] || defaultActivities[0]));
      setReady(true);
    }

    void load();
  }, []);

  useEffect(() => {
    if (!ready) return;

    localStorage.setItem(storage.issuer, JSON.stringify(issuer));
    localStorage.setItem(storage.issuerUpdatedAt, JSON.stringify(issuerUpdatedAt));
    localStorage.setItem(storage.clients, JSON.stringify(clients));
    localStorage.setItem(storage.activities, JSON.stringify(activities));
    localStorage.setItem(storage.invoices, JSON.stringify(invoices));
    localStorage.setItem(storage.concepts, JSON.stringify(savedConcepts));
    localStorage.setItem(storage.deletedClients, JSON.stringify(deletedClientIds));
    localStorage.setItem(storage.deletedInvoices, JSON.stringify(deletedInvoiceIds));
    localStorage.setItem(storage.deletedActivities, JSON.stringify(deletedActivityIds));
    localStorage.setItem(storage.deletedConcepts, JSON.stringify(deletedConceptIds));

    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        setSyncStatus("sincronizando");
        const response = await fetch("/api/data", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mainPayload())
        });
        const result = await response.json().catch(() => ({}));

        if (response.status === 401) {
          setSyncStatus("sesion");
          return;
        }

        if (!response.ok) {
          setSyncStatus("error");
          if (result?.error) flash(result.error);
          return;
        }

        if (!result.configured) {
          setSyncStatus("local");
          return;
        }

        setRemoteConfigured(true);
        setSyncStatus("sincronizado");
        setLastSyncedAt(result.updatedAt || nowISO());
        if (result.data) applyRemoteState(result.data);
      } catch {
        setSyncStatus("error");
      }
    }, 650);

    return () => window.clearTimeout(timer);
  }, [
    issuer,
    issuerUpdatedAt,
    clients,
    activities,
    invoices,
    savedConcepts,
    deletedClientIds,
    deletedInvoiceIds,
    deletedActivityIds,
    deletedConceptIds,
    ready
  ]);

  useEffect(() => {
    if (!ready || !remoteConfigured) return;

    let cancelled = false;

    async function refreshRemote() {
      if (document.visibilityState === "hidden") return;

      try {
        const response = await fetch("/api/data", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (cancelled) return;

        if (response.status === 401) {
          setSyncStatus("sesion");
          return;
        }

        if (!response.ok || !result.data) {
          setSyncStatus("error");
          return;
        }

        const changed = applyRemoteState(result.data);
        setSyncStatus("sincronizado");
        setLastSyncedAt(result.updatedAt || nowISO());
        if (!changed) skipNextSyncRef.current = false;
      } catch {
        setSyncStatus("error");
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
  }, [
    ready,
    remoteConfigured,
    issuer,
    issuerUpdatedAt,
    clients,
    activities,
    invoices,
    savedConcepts,
    deletedClientIds,
    deletedInvoiceIds,
    deletedActivityIds,
    deletedConceptIds
  ]);

  useEffect(() => {
    if (!billingCalendarOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBillingCalendarOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [billingCalendarOpen]);

  const draftTotals = useMemo(() => totals(draft), [draft]);
  const recentInvoices = useMemo(() => {
    const normalizedNumber = invoiceFilters.number.trim().toLocaleLowerCase("es");
    const minTotal = invoiceFilters.totalMin === "" ? null : Number(invoiceFilters.totalMin);
    const maxTotal = invoiceFilters.totalMax === "" ? null : Number(invoiceFilters.totalMax);

    const filtered = invoices.filter((invoice) => {
      const client = clients.find((item) => item.id === invoice.clientId);
      const invoiceTotal = (() => {
        const t = totals(invoice);
        return money(t.base + t.vat - t.withholding);
      })();

      if (normalizedNumber && !invoice.number.toLocaleLowerCase("es").includes(normalizedNumber)) return false;
      if (invoiceFilters.dateFrom && invoice.issueDate < invoiceFilters.dateFrom) return false;
      if (invoiceFilters.dateTo && invoice.issueDate > invoiceFilters.dateTo) return false;
      if (invoiceFilters.clientId && invoice.clientId !== invoiceFilters.clientId) return false;
      if (invoiceFilters.status && invoice.status !== invoiceFilters.status) return false;
      if (minTotal !== null && Number.isFinite(minTotal) && invoiceTotal < minTotal) return false;
      if (maxTotal !== null && Number.isFinite(maxTotal) && invoiceTotal > maxTotal) return false;

      return true;
    });

    return filtered.sort((a, b) => {
      const clientA = clients.find((item) => item.id === a.clientId)?.name || "";
      const clientB = clients.find((item) => item.id === b.clientId)?.name || "";
      const totalA = (() => {
        const t = totals(a);
        return money(t.base + t.vat - t.withholding);
      })();
      const totalB = (() => {
        const t = totals(b);
        return money(t.base + t.vat - t.withholding);
      })();

      let comparison = 0;
      if (invoiceSort.key === "number") comparison = (a.number || "").localeCompare(b.number || "", "es", { numeric: true });
      if (invoiceSort.key === "date") comparison = a.issueDate.localeCompare(b.issueDate);
      if (invoiceSort.key === "client") comparison = clientA.localeCompare(clientB, "es");
      if (invoiceSort.key === "status") comparison = a.status.localeCompare(b.status, "es");
      if (invoiceSort.key === "total") comparison = totalA - totalB;

      if (comparison === 0) comparison = a.createdAt.localeCompare(b.createdAt);
      return invoiceSort.direction === "asc" ? comparison : -comparison;
    });
  }, [invoices, clients, invoiceFilters, invoiceSort]);

  const billedAmount = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    return invoices
      .filter((invoice) => {
        if (!invoiceCountsAsIssued(invoice)) return false;
        if (billingPeriod === "total") return true;

        const year = Number(invoice.issueDate.slice(0, 4));
        if (year !== currentYear) return false;
        if (billingPeriod === "year") return true;

        const month = Number(invoice.issueDate.slice(5, 7));
        return month === currentMonth;
      })
      .reduce((sum, invoice) => {
        const t = totals(invoice);
        return money(sum + t.base + t.vat - t.withholding);
      }, 0);
  }, [invoices, billingPeriod]);

  const billingBreakdown = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const periodInvoices = invoices.filter((invoice) => {
      if (!invoiceCountsAsIssued(invoice)) return false;
      if (billingPeriod === "total") return true;

      const year = Number(invoice.issueDate.slice(0, 4));
      if (year !== currentYear) return false;
      if (billingPeriod === "year") return true;

      return Number(invoice.issueDate.slice(5, 7)) === currentMonth;
    });

    let collected = 0;
    let receivable = 0;

    for (const invoice of periodInvoices) {
      const t = totals(invoice);
      const value = money(t.base + t.vat - t.withholding);
      if (invoice.status === "Cobrada") collected = money(collected + value);
      if (invoice.status === "Emitida") receivable = money(receivable + value);
    }

    const total = money(collected + receivable);
    return {
      collected,
      receivable,
      collectedPct: total > 0 ? collected / total : 0,
      receivablePct: total > 0 ? receivable / total : 0
    };
  }, [invoices, billingPeriod]);

  function toggleInvoiceSort(key: InvoiceSortKey) {
    setInvoiceSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "date" || key === "total" ? "desc" : "asc" }
    );
  }

  function sortMark(key: InvoiceSortKey) {
    if (invoiceSort.key !== key) return "↕";
    return invoiceSort.direction === "asc" ? "↑" : "↓";
  }

  function clearInvoiceFilters() {
    setInvoiceFilters({
      number: "",
      dateFrom: "",
      dateTo: "",
      clientId: "",
      status: "",
      totalMin: "",
      totalMax: ""
    });
  }

  const hasInvoiceFilters = Object.values(invoiceFilters).some(Boolean);

  const monthlyBillingHistory = useMemo(() => {
    const groups = new Map<string, { year: number; month: number; invoices: number; total: number }>();

    invoices
      .filter((invoice) => invoiceCountsAsIssued(invoice) && invoice.issueDate)
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

  const billingCalendarData = useMemo(() => {
    const [year, month] = billingCalendarMonth.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
    const byDay = new Map<string, { invoices: Invoice[]; total: number; collected: number; receivable: number }>();

    const monthInvoices = invoices
      .filter(
        (invoice) =>
          invoiceCountsAsIssued(invoice) &&
          invoice.issueDate?.startsWith(`${billingCalendarMonth}-`)
      )
      .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.createdAt.localeCompare(b.createdAt));

    let total = 0;
    let collected = 0;
    let receivable = 0;

    for (const invoice of monthInvoices) {
      const t = totals(invoice);
      const value = money(t.base + t.vat - t.withholding);
      total = money(total + value);
      if (invoice.status === "Cobrada") collected = money(collected + value);
      if (invoice.status === "Emitida") receivable = money(receivable + value);

      const current = byDay.get(invoice.issueDate) || {
        invoices: [],
        total: 0,
        collected: 0,
        receivable: 0
      };
      current.invoices.push(invoice);
      current.total = money(current.total + value);
      if (invoice.status === "Cobrada") current.collected = money(current.collected + value);
      if (invoice.status === "Emitida") current.receivable = money(current.receivable + value);
      byDay.set(invoice.issueDate, current);
    }

    let running = 0;
    const cumulative = Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const date = `${billingCalendarMonth}-${String(day).padStart(2, "0")}`;
      running = money(running + (byDay.get(date)?.total || 0));
      return { day, value: running };
    });

    const max = Math.max(total, 1);
    const chartPoints = cumulative
      .map((item, index) => {
        const x = daysInMonth === 1 ? 0 : (index / (daysInMonth - 1)) * 100;
        const y = 38 - (item.value / max) * 34;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

    return {
      year,
      month,
      daysInMonth,
      firstWeekday,
      byDay,
      invoices: monthInvoices,
      total,
      collected,
      receivable,
      cumulative,
      chartPoints
    };
  }, [invoices, billingCalendarMonth]);

  const selectedBillingDayData = selectedBillingDay
    ? billingCalendarData.byDay.get(selectedBillingDay)
    : undefined;

  function changeBillingCalendarMonth(offset: number) {
    const [year, month] = billingCalendarMonth.split("-").map(Number);
    const target = new Date(year, month - 1 + offset, 1);
    setBillingCalendarMonth(
      `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`
    );
    setSelectedBillingDay(null);
  }

  function openBillingCalendar() {
    if (billingPeriod === "month") {
      setBillingCalendarMonth(dateISO().slice(0, 7));
    }
    setSelectedBillingDay(null);
    setBillingCalendarOpen(true);
  }

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2500);
  }

  async function exportBackup() {
    const parseLocal = (key: string) => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    };

    let fiscalData = {
      expenses: parseLocal("facturas_expenses_v1"),
      taxRecords: parseLocal("facturas_tax_records_v1"),
      deletedExpenseIds: parseLocal("facturas_deleted_expenses_v1"),
      recurringExpenses: parseLocal("facturas_recurring_expenses_v1"),
      deletedRecurringExpenseIds: parseLocal("facturas_deleted_recurring_expenses_v1")
    };

    try {
      const response = await fetch("/api/fiscal", { cache: "no-store" });
      const result = await response.json();
      if (response.ok && result.configured && result.data) {
        fiscalData = {
          expenses: result.data.expenses || fiscalData.expenses,
          taxRecords: result.data.taxRecords || fiscalData.taxRecords,
          deletedExpenseIds: result.data.deletedExpenseIds || fiscalData.deletedExpenseIds,
          recurringExpenses: result.data.recurringExpenses || fiscalData.recurringExpenses,
          deletedRecurringExpenseIds:
            result.data.deletedRecurringExpenseIds || fiscalData.deletedRecurringExpenseIds
        };
      }
    } catch {
      // Si no hay conexión, la copia local sigue siendo exportable.
    }

    const backup = {
      schema: 2,
      version,
      exportedAt: nowISO(),
      main: mainPayload(),
      fiscal: fiscalData
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `facturas-backup-${dateISO()}.json`;
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
      if (
        !backup?.main ||
        !Array.isArray(backup.main.clients) ||
        !Array.isArray(backup.main.invoices)
      ) {
        return flash("El archivo no parece una copia válida de Facturas.");
      }

      const nextDeletedClients = mergeIds(deletedClientIds, backup.main.deletedClientIds || []);
      const nextDeletedInvoices = mergeIds(deletedInvoiceIds, backup.main.deletedInvoiceIds || []);
      const nextDeletedActivities = mergeIds(deletedActivityIds, backup.main.deletedActivityIds || []);
      const nextDeletedConcepts = mergeIds(deletedConceptIds, backup.main.deletedConceptIds || []);

      const issuerMerge = mergeIssuerState(
        backup.main.issuer,
        backup.main.issuerUpdatedAt,
        issuer,
        issuerUpdatedAt
      );

      const nextClients = mergeById<Client>(clients, backup.main.clients || [])
        .filter((item) => !nextDeletedClients.includes(item.id));
      const nextActivities = normalizeActivities(
        mergeById<ActivityPreset>(activities, backup.main.activities || [])
          .filter((item) => !nextDeletedActivities.includes(item.id))
      );
      const nextInvoices = mergeById<Invoice>(invoices, backup.main.invoices || [])
        .filter((item) => !nextDeletedInvoices.includes(item.id));
      const nextConcepts = mergeById<SavedConcept>(savedConcepts, backup.main.concepts || [])
        .filter((item) => !nextDeletedConcepts.includes(item.id));

      setIssuer(issuerMerge.issuer);
      setIssuerUpdatedAt(issuerMerge.updatedAt);
      setClients(nextClients);
      setActivities(nextActivities);
      setInvoices(nextInvoices);
      setSavedConcepts(nextConcepts);
      setDeletedClientIds(nextDeletedClients);
      setDeletedInvoiceIds(nextDeletedInvoices);
      setDeletedActivityIds(nextDeletedActivities);
      setDeletedConceptIds(nextDeletedConcepts);

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
      const currentRecurringExpenses = (() => {
        try { return JSON.parse(localStorage.getItem("facturas_recurring_expenses_v1") || "[]"); } catch { return []; }
      })();
      const currentDeletedRecurringExpenseIds = (() => {
        try { return JSON.parse(localStorage.getItem("facturas_deleted_recurring_expenses_v1") || "[]"); } catch { return []; }
      })();

      const mergedDeletedExpenseIds = mergeIds(currentDeletedExpenseIds, fiscal.deletedExpenseIds || []);
      const mergedDeletedRecurringExpenseIds = mergeIds(
        currentDeletedRecurringExpenseIds,
        fiscal.deletedRecurringExpenseIds || []
      );
      const deletedSet = new Set(mergedDeletedExpenseIds);
      const mergedExpenses = mergeById<any>(currentExpenses, fiscal.expenses || [])
        .filter((item: any) => !deletedSet.has(item.id));

      const deletedRecurringSet = new Set(mergedDeletedRecurringExpenseIds);
      const mergedRecurringExpenses = mergeById<any>(
        currentRecurringExpenses,
        fiscal.recurringExpenses || []
      ).filter((item: any) => !deletedRecurringSet.has(item.id));

      const recordMap = new Map<string, any>();
      currentRecords.forEach((item: any) => recordMap.set(item.key, item));
      (fiscal.taxRecords || []).forEach((item: any) => {
        const existing = recordMap.get(item.key);
        if (!existing || timestamp(item.updatedAt) > timestamp(existing.updatedAt)) {
          recordMap.set(item.key, { ...item, updatedAt: item.updatedAt || nowISO() });
        }
      });
      const mergedRecords = [...recordMap.values()];

      localStorage.setItem("facturas_expenses_v1", JSON.stringify(mergedExpenses));
      localStorage.setItem("facturas_tax_records_v1", JSON.stringify(mergedRecords));
      localStorage.setItem("facturas_deleted_expenses_v1", JSON.stringify(mergedDeletedExpenseIds));
      localStorage.setItem("facturas_recurring_expenses_v1", JSON.stringify(mergedRecurringExpenses));
      localStorage.setItem(
        "facturas_deleted_recurring_expenses_v1",
        JSON.stringify(mergedDeletedRecurringExpenseIds)
      );

      const [mainResponse, fiscalResponse] = await Promise.all([
        fetch("/api/data", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issuer: issuerMerge.issuer,
            issuerUpdatedAt: issuerMerge.updatedAt,
            clients: nextClients,
            activities: nextActivities,
            invoices: nextInvoices,
            concepts: nextConcepts,
            deletedClientIds: nextDeletedClients,
            deletedInvoiceIds: nextDeletedInvoices,
            deletedActivityIds: nextDeletedActivities,
            deletedConceptIds: nextDeletedConcepts
          })
        }),
        fetch("/api/fiscal", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expenses: mergedExpenses,
            taxRecords: mergedRecords,
            deletedExpenseIds: mergedDeletedExpenseIds,
            recurringExpenses: mergedRecurringExpenses,
            deletedRecurringExpenseIds: mergedDeletedRecurringExpenseIds
          })
        })
      ]);

      if (!mainResponse.ok || !fiscalResponse.ok) {
        return flash("La copia se importó localmente, pero falta sincronizar con el servidor.");
      }

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
          lastUsedAt: nowISO(),
          updatedAt: nowISO()
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
    const selectedClient = clients.find((client) => client.id === draft.clientId);
    const isDraft = draft.status === "Borrador";

    if (!isDraft) {
      if (!draft.clientId || !selectedClient) return flash("Selecciona un cliente.");
      if (!draft.lines.some((line) => line.description.trim())) return flash("Añade al menos un concepto.");
      if (!issuer.fiscalName || !issuer.taxId || !issuer.address || !issuer.postalCode || !issuer.city) {
        return flash("Completa tus datos fiscales y dirección antes de emitir.");
      }
      if (!selectedClient.name || !selectedClient.taxId || !selectedClient.address) {
        return flash("Completa nombre, NIF/CIF y dirección del cliente antes de emitir.");
      }

      for (const line of draft.lines) {
        if (!line.description.trim()) continue;
        if (Number(line.quantity) <= 0) return flash("La cantidad de cada concepto debe ser mayor que 0.");
        if (Number(line.unitPrice) < 0) return flash("El precio no puede ser negativo.");
        if (Number(line.vat) < 0 || Number(line.vat) > 100) return flash("Revisa el porcentaje de IVA.");
        if (Number(line.withholding) < 0 || Number(line.withholding) > 100) return flash("Revisa el porcentaje de IRPF.");
      }

      if ((draft.invoiceMode || "normal") === "monthly") {
        if (!draft.periodFrom || !draft.periodTo) return flash("Indica el periodo facturado desde/hasta.");
        if (draft.periodFrom > draft.periodTo) return flash("La fecha inicial del periodo no puede ser posterior a la final.");
        if (draft.periodFrom.slice(0, 7) !== draft.periodTo.slice(0, 7)) {
          return flash("Una factura mensual debe corresponder a un único mes natural.");
        }

        const invalidServiceDate = draft.lines.some(
          (line) =>
            line.serviceDate &&
            (line.serviceDate < (draft.periodFrom || "") || line.serviceDate > (draft.periodTo || ""))
        );
        if (invalidServiceDate) return flash("Hay una fecha de concepto fuera del periodo facturado.");
      }

      const manualNumber = draft.number.trim();
      if (
        manualNumber &&
        invoices.some((invoice) => invoice.id !== editingId && invoice.number.trim() === manualNumber)
      ) {
        return flash(`Ya existe una factura con el número ${manualNumber}.`);
      }
    }

    const previous = editingId ? invoices.find((item) => item.id === editingId) : undefined;
    const stamp = nowISO();
    const saved: Invoice = {
      ...draft,
      number: isDraft ? draft.number.trim() : draft.number.trim(),
      issuerSnapshot:
        previous?.issuerSnapshot ||
        draft.issuerSnapshot ||
        (!isDraft ? { ...issuer } : undefined),
      clientSnapshot:
        previous?.clientSnapshot ||
        draft.clientSnapshot ||
        (!isDraft && selectedClient ? { ...selectedClient } : undefined),
      createdAt: previous?.createdAt || draft.createdAt || stamp,
      updatedAt: stamp
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
    flash(editingId ? "Factura actualizada." : (isDraft ? "Borrador guardado." : "Factura guardada y pendiente de numeración segura."));
  }

  function editInvoice(invoice: Invoice) {
    setDraft(JSON.parse(JSON.stringify(invoice)));
    setEditingId(invoice.id);
    setTab("nueva");
  }

  function duplicateInvoice(invoice: Invoice) {
    const today = dateISO();
    const range = monthRange(today);
    const stamp = nowISO();

    setDraft({
      ...JSON.parse(JSON.stringify(invoice)),
      id: uid(),
      number: "",
      issueDate: today,
      operationDate: today,
      periodFrom: (invoice.invoiceMode || "normal") === "monthly" ? range.first : "",
      periodTo: (invoice.invoiceMode || "normal") === "monthly" ? range.last : "",
      dueDate: today,
      status: "Borrador",
      issuerSnapshot: undefined,
      clientSnapshot: undefined,
      lines: invoice.lines.map((line) => ({
        ...line,
        id: uid(),
        serviceDate: (invoice.invoiceMode || "normal") === "monthly" ? "" : line.serviceDate
      })),
      createdAt: stamp,
      updatedAt: stamp
    });
    setEditingId(null);
    setTab("nueva");
  }

  function updateInvoiceInternalNote(id: string, internalNote: string) {
    setInvoices((current) =>
      current.map((invoice) => invoice.id === id ? { ...invoice, internalNote, updatedAt: nowISO() } : invoice)
    );
  }

  function deleteInvoice(id: string) {
    if (!window.confirm("¿Eliminar esta factura? Esta acción no se puede deshacer.")) return;
    setInvoices((current) => current.filter((item) => item.id !== id));
    setDeletedInvoiceIds((current) => current.includes(id) ? current : [...current, id]);
  }

  async function printInvoice(invoice: Invoice) {
    const client = invoice.clientSnapshot || clients.find((item) => item.id === invoice.clientId);
    const invoiceIssuer = invoice.issuerSnapshot || issuer;

    if (!client) return flash("No se encuentran los datos del cliente para generar el PDF.");
    if (!invoice.number.trim()) return flash("La factura todavía no tiene numeración definitiva.");

    try {
      await downloadInvoicePdf({
        number: invoice.number,
        issueDate: invoice.issueDate,
        notes: invoice.notes || "",
        paymentMethod: invoice.paymentMethod || "Transferencia bancaria",
        issuer: {
          fiscalName: invoiceIssuer.fiscalName,
          taxId: invoiceIssuer.taxId,
          address: invoiceIssuer.address,
          postalCode: invoiceIssuer.postalCode,
          city: invoiceIssuer.city,
          province: invoiceIssuer.province,
          email: invoiceIssuer.email,
          iban: invoiceIssuer.iban
        },
        client: {
          name: client.name,
          taxId: client.taxId,
          address: client.address,
          postalCode: client.postalCode,
          city: client.city,
          province: client.province
        },
        lines: invoice.lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity || 0),
          unitPrice: Number(line.unitPrice || 0),
          vat: Number(line.vat || 0),
          withholding: Number(line.withholding || 0)
        }))
      });
    } catch (error) {
      console.error(error);
      flash("No se pudo generar el PDF de la factura.");
    }
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
      notes: clientDraft.notes || "",
      updatedAt: nowISO()
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
    setDeletedClientIds((current) => current.includes(client.id) ? current : [...current, client.id]);
    if (clientDraft.id === client.id) setClientDraft({ ...blankClient });
    flash("Cliente eliminado.");
  }

  function addActivity() {
    if (!activityDraft.name.trim()) return flash("Pon un nombre a la actividad.");
    setActivities((current) => [...current, { ...activityDraft, id: uid(), updatedAt: nowISO() }]);
    setActivityDraft({ name: "", vat: 21, withholding: 0 });
    flash("Actividad añadida.");
  }

  function updateActivity(id: string, patch: Partial<ActivityPreset>) {
    setActivities((current) =>
      current.map((activity) => activity.id === id ? { ...activity, ...patch, updatedAt: nowISO() } : activity)
    );
  }

  function deleteActivity(id: string) {
    if (defaultActivities.some((activity) => activity.id === id)) return;
    setActivities((current) => current.filter((activity) => activity.id !== id));
    setDeletedActivityIds((current) => current.includes(id) ? current : [...current, id]);
    flash("Actividad eliminada.");
  }

  function updateIssuer(patch: Partial<Issuer>) {
    setIssuer((current) => ({ ...current, ...patch }));
    setIssuerUpdatedAt(nowISO());
  }

  function updateSavedConcept(id: string, patch: Partial<SavedConcept>) {
    setSavedConcepts((current) =>
      current.map((concept) => concept.id === id ? { ...concept, ...patch, updatedAt: nowISO() } : concept)
    );
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  if (!ready) {
    return <main className="loading">Cargando gestor…</main>;
  }

  const printClient = preview
    ? preview.clientSnapshot || clients.find((client) => client.id === preview.clientId)
    : undefined;
  const printIssuer = preview?.issuerSnapshot || issuer;
  const printTotals = preview ? totals(preview) : null;
  const syncLabel =
    syncStatus === "sincronizado" ? "Sincronizado" :
    syncStatus === "sincronizando" ? "Guardando…" :
    syncStatus === "sesion" ? "Sesión caducada" :
    syncStatus === "error" ? "Error de sincronización" :
    "Solo en este dispositivo";

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
            <div className={`sync-badge ${syncStatus}`}>
              <span>{syncLabel}</span>
              {lastSyncedAt && syncStatus === "sincronizado" && (
                <small>{new Date(lastSyncedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</small>
              )}
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
                    <button className="billing-detail-trigger" onClick={openBillingCalendar}>
                      Facturado <span aria-hidden="true">↗</span>
                    </button>
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
                  <div className="billing-breakdown">
                    <div>
                      <span>Cobrado</span>
                      <strong>{billingVisible ? currency(billingBreakdown.collected) : "•••• €"}</strong>
                      <small>{Math.round(billingBreakdown.collectedPct * 100)}%</small>
                    </div>
                    <div>
                      <span>Por cobrar</span>
                      <strong>{billingVisible ? currency(billingBreakdown.receivable) : "•••• €"}</strong>
                      <small>{Math.round(billingBreakdown.receivablePct * 100)}%</small>
                    </div>
                  </div>
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

              <div className="panel table-panel">
                {invoices.length === 0 ? (
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
                        <tr className="sortable-head">
                          <th><button onClick={() => toggleInvoiceSort("number")}>Número <span>{sortMark("number")}</span></button></th>
                          <th><button onClick={() => toggleInvoiceSort("date")}>Fecha <span>{sortMark("date")}</span></button></th>
                          <th><button onClick={() => toggleInvoiceSort("client")}>Cliente <span>{sortMark("client")}</span></button></th>
                          <th><button onClick={() => toggleInvoiceSort("status")}>Estado <span>{sortMark("status")}</span></button></th>
                          <th className="right"><button onClick={() => toggleInvoiceSort("total")}>Total <span>{sortMark("total")}</span></button></th>
                          <th>Observaciones</th>
                          <th>{hasInvoiceFilters && <button className="clear-filters" onClick={clearInvoiceFilters}>Limpiar</button>}</th>
                        </tr>
                        <tr className="filter-row">
                          <th>
                            <input
                              value={invoiceFilters.number}
                              onChange={(e) => setInvoiceFilters((current) => ({ ...current, number: e.target.value }))}
                              placeholder="Buscar nº"
                              aria-label="Filtrar por número"
                            />
                          </th>
                          <th>
                            <div className="date-filter">
                              <input
                                type="date"
                                value={invoiceFilters.dateFrom}
                                onChange={(e) => setInvoiceFilters((current) => ({ ...current, dateFrom: e.target.value }))}
                                aria-label="Fecha desde"
                              />
                              <input
                                type="date"
                                value={invoiceFilters.dateTo}
                                onChange={(e) => setInvoiceFilters((current) => ({ ...current, dateTo: e.target.value }))}
                                aria-label="Fecha hasta"
                              />
                            </div>
                          </th>
                          <th>
                            <select
                              value={invoiceFilters.clientId}
                              onChange={(e) => setInvoiceFilters((current) => ({ ...current, clientId: e.target.value }))}
                              aria-label="Filtrar por cliente"
                            >
                              <option value="">Todos</option>
                              {[...clients]
                                .sort((a, b) => a.name.localeCompare(b.name, "es"))
                                .map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                            </select>
                          </th>
                          <th>
                            <select
                              value={invoiceFilters.status}
                              onChange={(e) => setInvoiceFilters((current) => ({ ...current, status: e.target.value }))}
                              aria-label="Filtrar por estado"
                            >
                              <option value="">Todos</option>
                              <option value="Borrador">Borrador</option>
                              <option value="Emitida">Emitida</option>
                              <option value="Cobrada">Cobrada</option>
                              <option value="Anulada">Anulada</option>
                            </select>
                          </th>
                          <th>
                            <div className="total-filter">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={invoiceFilters.totalMin}
                                onChange={(e) => setInvoiceFilters((current) => ({ ...current, totalMin: e.target.value }))}
                                placeholder="Mín."
                                aria-label="Total mínimo"
                              />
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={invoiceFilters.totalMax}
                                onChange={(e) => setInvoiceFilters((current) => ({ ...current, totalMax: e.target.value }))}
                                placeholder="Máx."
                                aria-label="Total máximo"
                              />
                            </div>
                          </th>
                          <th></th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentInvoices.length === 0 && (
                          <tr>
                            <td colSpan={7} className="filtered-empty">
                              No hay facturas que coincidan con estos filtros.
                            </td>
                          </tr>
                        )}
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
                              <td className="invoice-observation-cell">
                                <input
                                  value={invoice.internalNote || ""}
                                  onChange={(e) => updateInvoiceInternalNote(invoice.id, e.target.value)}
                                  placeholder="Ej. Operador cámara Barça–Sevilla"
                                  aria-label={`Observaciones internas de ${invoice.number || "factura"}`}
                                />
                              </td>
                              <td className="actions">
                                <button
                                  onClick={() => printInvoice(invoice)}
                                  disabled={invoiceCountsAsIssued(invoice) && !invoice.number}
                                  title={invoiceCountsAsIssued(invoice) && !invoice.number ? "Esperando numeración segura" : "Descargar PDF"}
                                >
                                  {invoiceCountsAsIssued(invoice) && !invoice.number ? "Numerando…" : "PDF"}
                                </button>
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
                  <h1>{editingId ? `Factura ${draft.number || "sin numerar"}` : "Crear factura"}</h1>
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
                      <label>Tipo de factura
                        <select
                          value={draft.invoiceMode || "normal"}
                          onChange={(e) => {
                            const invoiceMode = e.target.value as InvoiceMode;
                            if (invoiceMode === "monthly") {
                              const range = monthRange(draft.issueDate);
                              setDraft({
                                ...draft,
                                invoiceMode,
                                periodFrom: draft.periodFrom || range.first,
                                periodTo: draft.periodTo || range.last
                              });
                            } else {
                              setDraft({ ...draft, invoiceMode });
                            }
                          }}
                        >
                          <option value="normal">Normal</option>
                          <option value="monthly">Mensual / recapitulativa</option>
                        </select>
                      </label>
                      {(draft.invoiceMode || "normal") === "normal" ? (
                        <label>Fecha operación
                          <input type="date" value={draft.operationDate} onChange={(e) => setDraft({ ...draft, operationDate: e.target.value })} />
                        </label>
                      ) : (
                        <>
                          <label>Periodo desde
                            <input type="date" value={draft.periodFrom || ""} onChange={(e) => setDraft({ ...draft, periodFrom: e.target.value })} />
                          </label>
                          <label>Periodo hasta
                            <input type="date" value={draft.periodTo || ""} onChange={(e) => setDraft({ ...draft, periodTo: e.target.value })} />
                          </label>
                        </>
                      )}
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

                    <div className={`line-head ${(draft.invoiceMode || "normal") === "monthly" ? "with-service-date" : ""}`}>
                      {(draft.invoiceMode || "normal") === "monthly" && <span>Fecha</span>}
                      <span>Actividad / concepto</span><span>Cant.</span><span>Precio</span><span>IVA %</span><span>IRPF %</span><span>Total base</span><span></span>
                    </div>

                    {draft.lines.map((line) => (
                      <div className={`invoice-line ${(draft.invoiceMode || "normal") === "monthly" ? "with-service-date" : ""}`} key={line.id}>
                        {(draft.invoiceMode || "normal") === "monthly" && (
                          <input
                            className="service-date-input"
                            type="date"
                            value={line.serviceDate || ""}
                            min={draft.periodFrom || undefined}
                            max={draft.periodTo || undefined}
                            onChange={(e) => updateLine(line.id, { serviceDate: e.target.value })}
                            aria-label="Fecha del servicio"
                          />
                        )}
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
                      <strong>{(draft.invoiceMode || "normal") === "monthly" ? "Factura mensual" : "Retención por línea"}</strong>
                      <span>
                        {(draft.invoiceMode || "normal") === "monthly"
                          ? "La fecha de cada concepto es opcional. Úsala si quieres dejar constancia exacta de cuándo se realizó cada servicio dentro del periodo facturado."
                          : "Puedes mezclar, por ejemplo, una línea al 15%, otra al 7% y otra al 0% dentro de la misma factura. Los conceptos usados se guardan automáticamente y aparecerán como sugerencia la próxima vez."}
                      </span>
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
                        <input value={issuer.iban} onChange={(e) => updateIssuer({ iban: e.target.value })} placeholder="Se toma de Configuración" />
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
                    <label>Nombre / razón social<input value={issuer.fiscalName} onChange={(e) => updateIssuer({ fiscalName: e.target.value })} /></label>
                    <label>NIF<input value={issuer.taxId} onChange={(e) => updateIssuer({ taxId: e.target.value })} /></label>
                    <label>Email<input value={issuer.email} onChange={(e) => updateIssuer({ email: e.target.value })} /></label>
                    <label className="span-2">Dirección fiscal<input value={issuer.address} onChange={(e) => updateIssuer({ address: e.target.value })} /></label>
                    <label>Teléfono<input value={issuer.phone} onChange={(e) => updateIssuer({ phone: e.target.value })} /></label>
                    <label>Código postal<input value={issuer.postalCode} onChange={(e) => updateIssuer({ postalCode: e.target.value })} /></label>
                    <label>Ciudad<input value={issuer.city} onChange={(e) => updateIssuer({ city: e.target.value })} /></label>
                    <label>Provincia<input value={issuer.province} onChange={(e) => updateIssuer({ province: e.target.value })} /></label>
                    <label className="span-2">IBAN<input value={issuer.iban} onChange={(e) => updateIssuer({ iban: e.target.value })} /></label>
                  </div>
                  <p className="saved-note">
                    {remoteConfigured
                      ? "Los cambios se guardan automáticamente en la base de datos y también en este navegador."
                      : "Los cambios se guardan automáticamente en este navegador hasta conectar la base de datos."}
                  </p>
                </div>

                <div className="panel">
                  <div className="section-title">
                    <div><h2>Actividades y retenciones</h2><p className="muted">Edita nombre, IVA e IRPF. Los cambios se guardan automáticamente y se usarán en nuevas líneas de factura.</p></div>
                  </div>

                  <div className="activity-create">
                    <input placeholder="Nombre de la actividad" value={activityDraft.name} onChange={(e) => setActivityDraft({ ...activityDraft, name: e.target.value })} />
                    <label>IVA %<input type="number" value={activityDraft.vat} onChange={(e) => setActivityDraft({ ...activityDraft, vat: Number(e.target.value) })} /></label>
                    <label>IRPF %<input type="number" value={activityDraft.withholding} onChange={(e) => setActivityDraft({ ...activityDraft, withholding: Number(e.target.value) })} /></label>
                    <button className="button primary" onClick={addActivity}>Añadir</button>
                  </div>

                  <div className="activity-list activity-editor-list">
                    {activities.map((activity) => {
                      const isBase = defaultActivities.some((preset) => preset.id === activity.id);
                      return (
                        <article key={activity.id}>
                          <label className="activity-name-field">Actividad
                            <input
                              value={activity.name}
                              onChange={(e) => updateActivity(activity.id, { name: e.target.value })}
                            />
                          </label>
                          <label>IVA %
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={activity.vat}
                              onChange={(e) => updateActivity(activity.id, { vat: Number(e.target.value) })}
                            />
                          </label>
                          <label>IRPF %
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={activity.withholding}
                              onChange={(e) => updateActivity(activity.id, { withholding: Number(e.target.value) })}
                            />
                          </label>
                          {isBase ? (
                            <span className="activity-base-badge">Actividad base</span>
                          ) : (
                            <button
                              className="danger-link"
                              onClick={() => deleteActivity(activity.id)}
                            >
                              Eliminar
                            </button>
                          )}
                        </article>
                      );
                    })}
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
                {(preview.invoiceMode || "normal") === "monthly" ? (
                  <p>Periodo facturado: {preview.periodFrom || "—"} a {preview.periodTo || "—"}</p>
                ) : (
                  preview.operationDate && <p>Fecha de operación: {preview.operationDate}</p>
                )}
              </div>
              <div className="issuer-print">
                <strong>{printIssuer.fiscalName}</strong>
                <span>{printIssuer.taxId}</span>
                <span>{printIssuer.address}</span>
                <span>{printIssuer.postalCode} {printIssuer.city} {printIssuer.province}</span>
                <span>{printIssuer.email}</span>
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
              <thead>
                <tr>
                  {(preview.invoiceMode || "normal") === "monthly" && <th>Fecha</th>}
                  <th>Concepto</th><th>Cant.</th><th>Precio</th><th>IVA</th><th>IRPF</th><th>Base</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((line) => (
                  <tr key={line.id}>
                    {(preview.invoiceMode || "normal") === "monthly" && <td>{line.serviceDate || "—"}</td>}
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
                {printIssuer.iban && <p>IBAN: {printIssuer.iban}</p>}
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
