"use client";

import { useEffect, useMemo, useState } from "react";

type Tab = "facturas" | "nueva" | "clientes" | "config";
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
  invoices: "facturas_invoices_v1"
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

const defaultActivities: ActivityPreset[] = [
  { id: "prof-15", name: "Actividad profesional · 15% IRPF", vat: 21, withholding: 15 },
  { id: "prof-7", name: "Actividad profesional · 7% IRPF", vat: 21, withholding: 7 },
  { id: "sin-ret", name: "Actividad sin retención", vat: 21, withholding: 0 }
];

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

export default function InvoiceApp() {
  const [tab, setTab] = useState<Tab>("facturas");
  const [ready, setReady] = useState(false);
  const [issuer, setIssuer] = useState<Issuer>(blankIssuer);
  const [clients, setClients] = useState<Client[]>([]);
  const [activities, setActivities] = useState<ActivityPreset[]>(defaultActivities);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [draft, setDraft] = useState<Invoice>(() => emptyInvoice(defaultActivities[0]));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Invoice | null>(null);
  const [clientDraft, setClientDraft] = useState<Client>({
    id: "",
    name: "",
    taxId: "",
    address: "",
    postalCode: "",
    city: "",
    province: "",
    email: ""
  });
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
      let loadedActivities = read<ActivityPreset[]>(storage.activities, defaultActivities);
      let loadedInvoices = read<Invoice[]>(storage.invoices, []);

      try {
        const response = await fetch("/api/data", { cache: "no-store" });
        const result = await response.json();
        if (response.ok && result.configured) {
          setRemoteConfigured(true);
          if (result.data) {
            loadedIssuer = result.data.issuer || blankIssuer;
            loadedClients = result.data.clients || [];
            loadedActivities = result.data.activities?.length ? result.data.activities : defaultActivities;
            loadedInvoices = result.data.invoices || [];
          }
        }
      } catch {
        // Si la base de datos no está disponible, la app sigue funcionando en local.
      }

      setIssuer(loadedIssuer);
      setClients(loadedClients);
      setActivities(loadedActivities.length ? loadedActivities : defaultActivities);
      setInvoices(loadedInvoices);
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

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/data", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issuer, clients, activities, invoices })
        });
        const result = await response.json();
        if (response.ok && result.configured) setRemoteConfigured(true);
      } catch {
        // El guardado local sigue siendo la copia de respaldo del navegador.
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [issuer, clients, activities, invoices, ready]);

  const draftTotals = useMemo(() => totals(draft), [draft]);
  const recentInvoices = useMemo(
    () => [...invoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [invoices]
  );

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2500);
  }

  function updateLine(id: string, patch: Partial<InvoiceLine>) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.id === id ? { ...line, ...patch } : line))
    }));
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

  function addClient() {
    if (!clientDraft.name.trim() || !clientDraft.taxId.trim()) {
      return flash("Nombre/razón social y NIF/CIF son obligatorios.");
    }
    const client = { ...clientDraft, id: uid() };
    setClients((current) => [...current, client]);
    setClientDraft({
      id: "",
      name: "",
      taxId: "",
      address: "",
      postalCode: "",
      city: "",
      province: "",
      email: ""
    });
    flash("Cliente guardado.");
  }

  function addActivity() {
    if (!activityDraft.name.trim()) return flash("Pon un nombre a la actividad.");
    setActivities((current) => [...current, { ...activityDraft, id: uid() }]);
    setActivityDraft({ name: "", vat: 21, withholding: 0 });
    flash("Actividad añadida.");
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
              <button className={tab === "config" ? "active" : ""} onClick={() => setTab("config")}>
                <span>⚙</span> Configuración
              </button>
            </nav>
          </div>

          <button className="logout" onClick={logout}>Cerrar sesión</button>
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
                <article className="stat-card">
                  <span>Facturado</span>
                  <strong>{currency(invoices.filter(i => i.status !== "Anulada").reduce((sum, item) => {
                    const t = totals(item); return sum + t.base + t.vat - t.withholding;
                  }, 0))}</strong>
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
                            value={line.description}
                            onChange={(e) => updateLine(line.id, { description: e.target.value })}
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
                      <span>Puedes mezclar, por ejemplo, una línea al 15%, otra al 7% y otra al 0% dentro de la misma factura. Los totales se calculan por separado.</span>
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
                  <h2>Nuevo cliente</h2>
                  <div className="form-grid two">
                    <label>Nombre / razón social<input value={clientDraft.name} onChange={(e) => setClientDraft({ ...clientDraft, name: e.target.value })} /></label>
                    <label>NIF / CIF<input value={clientDraft.taxId} onChange={(e) => setClientDraft({ ...clientDraft, taxId: e.target.value })} /></label>
                    <label className="span-2">Dirección<input value={clientDraft.address} onChange={(e) => setClientDraft({ ...clientDraft, address: e.target.value })} /></label>
                    <label>Código postal<input value={clientDraft.postalCode} onChange={(e) => setClientDraft({ ...clientDraft, postalCode: e.target.value })} /></label>
                    <label>Ciudad<input value={clientDraft.city} onChange={(e) => setClientDraft({ ...clientDraft, city: e.target.value })} /></label>
                    <label>Provincia<input value={clientDraft.province} onChange={(e) => setClientDraft({ ...clientDraft, province: e.target.value })} /></label>
                    <label>Email<input type="email" value={clientDraft.email} onChange={(e) => setClientDraft({ ...clientDraft, email: e.target.value })} /></label>
                  </div>
                  <button className="button primary" onClick={addClient}>Guardar cliente</button>
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
                          <small>{[client.address, client.postalCode, client.city].filter(Boolean).join(", ")}</small>
                        </div>
                        <button className="danger-link" onClick={() => setClients((current) => current.filter((item) => item.id !== client.id))}>Eliminar</button>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

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

                <div className="panel data-warning">
                  <h2>Datos y copias de seguridad</h2>
                  <p>
                    {remoteConfigured
                      ? "Base de datos conectada: facturas, clientes, actividades y configuración quedan sincronizados entre dispositivos. El navegador conserva además una copia local."
                      : "Modo local activo: facturas y clientes se guardan en este navegador. En cuanto configuremos Supabase, la misma interfaz pasará a sincronizar los datos entre dispositivos."}
                  </p>
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
