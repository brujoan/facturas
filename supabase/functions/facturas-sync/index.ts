import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE6AEjnz13NfMwlAx8+x6qmGQt1SNw
pKCvTK8nmnZvr8cBzQkdHjs7QD0fHG/8de3WCM9HxntHIW4p4RiSviEspQ==
-----END PUBLIC KEY-----`;

const encoder = new TextEncoder();

type Row = Record<string, unknown>;

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function publicKey() {
  const body = PUBLIC_KEY_PEM
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s+/g, "");
  return crypto.subtle.importKey(
    "spki",
    base64ToBytes(body),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
}

async function authorized(req: Request, scope: string, body: string) {
  const timestamp = req.headers.get("x-sync-timestamp") || "";
  const signature = req.headers.get("x-sync-signature") || "";
  const parsed = Number(timestamp);

  if (!timestamp || !signature || !Number.isFinite(parsed)) return false;
  if (Math.abs(Date.now() - parsed) > 5 * 60 * 1000) return false;

  const canonical = `${timestamp}.${req.method}.${scope}.${body}`;
  const key = await publicKey();
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64ToBytes(signature),
    encoder.encode(canonical)
  );
}

function serviceKey() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    const parsed = JSON.parse(modern);
    if (parsed?.default) return String(parsed.default);
  }

  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacy) throw new Error("Supabase server key is not configured");
  return legacy;
}

function adminHeaders() {
  const key = serviceKey();
  return {
    apikey: key,
    ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
    "Content-Type": "application/json"
  };
}

function timestamp(value: unknown) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeNewRow(row: Row, now: string) {
  return row.updatedAt ? row : { ...row, updatedAt: now };
}

function mergeByKey(current: unknown, incoming: unknown, key: string, now: string) {
  const map = new Map<string, Row>();

  for (const raw of Array.isArray(current) ? current : []) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Row;
    const value = String(row[key] ?? "");
    if (value) map.set(value, row);
  }

  for (const raw of Array.isArray(incoming) ? incoming : []) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Row;
    const value = String(candidate[key] ?? "");
    if (!value) continue;

    const existing = map.get(value);
    if (!existing) {
      map.set(value, normalizeNewRow(candidate, now));
      continue;
    }

    const incomingTs = timestamp(candidate.updatedAt);
    const currentTs = timestamp(existing.updatedAt);

    // Legacy clients do not send updatedAt. Existing server data wins over
    // an undated duplicate, preventing stale localStorage from overwriting it.
    if (incomingTs === 0 && currentTs > 0) continue;
    if (incomingTs === 0 && currentTs === 0) continue;

    if (incomingTs >= currentTs) {
      map.set(value, { ...existing, ...candidate });
    }
  }

  return [...map.values()];
}

function mergeStringSet(a: unknown, b: unknown) {
  return [...new Set([
    ...(Array.isArray(a) ? a.map(String) : []),
    ...(Array.isArray(b) ? b.map(String) : [])
  ])];
}

function nextInvoiceNumber(series: string, invoices: Row[]) {
  let max = 0;
  for (const invoice of invoices) {
    if (String(invoice.series || "") !== series) continue;
    const match = String(invoice.number || "").match(/(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${series}-${String(max + 1).padStart(3, "0")}`;
}

function assignAndValidateInvoiceNumbers(invoices: Row[], now: string) {
  const used = new Map<string, string>();

  for (const invoice of invoices) {
    const status = String(invoice.status || "Borrador");
    const number = String(invoice.number || "").trim();
    if (!number || status === "Borrador") continue;

    const existingId = used.get(number);
    const id = String(invoice.id || "");
    if (existingId && existingId !== id) {
      throw new Error(`DUPLICATE_INVOICE_NUMBER:${number}`);
    }
    used.set(number, id);
  }

  const ordered = [...invoices].sort((a, b) =>
    String(a.createdAt || a.updatedAt || "").localeCompare(String(b.createdAt || b.updatedAt || ""))
  );

  for (const invoice of ordered) {
    const status = String(invoice.status || "Borrador");
    if (!["Emitida", "Cobrada"].includes(status)) continue;
    if (String(invoice.number || "").trim()) continue;

    const series = String(invoice.series || new Date().getFullYear()).trim() || String(new Date().getFullYear());
    let number = nextInvoiceNumber(series, ordered);
    while (used.has(number)) {
      const suffix = Number(number.match(/(\d+)$/)?.[1] || 0) + 1;
      number = `${series}-${String(suffix).padStart(3, "0")}`;
    }

    invoice.series = series;
    invoice.number = number;
    invoice.updatedAt = now;
    used.set(number, String(invoice.id || ""));
  }

  return invoices;
}

function mergeIssuer(oldState: Row, newState: Row, now: string) {
  const currentIssuer = oldState.issuer && typeof oldState.issuer === "object" ? oldState.issuer as Row : {};
  const incomingIssuer = newState.issuer && typeof newState.issuer === "object" ? newState.issuer as Row : {};

  if (!Object.keys(currentIssuer).length && Object.keys(incomingIssuer).length) {
    return { issuer: incomingIssuer, issuerUpdatedAt: String(newState.issuerUpdatedAt || now) };
  }

  const currentTs = timestamp(oldState.issuerUpdatedAt);
  const incomingTs = timestamp(newState.issuerUpdatedAt);

  if (incomingTs > 0 && incomingTs >= currentTs) {
    return { issuer: { ...currentIssuer, ...incomingIssuer }, issuerUpdatedAt: String(newState.issuerUpdatedAt) };
  }

  return {
    issuer: currentIssuer,
    issuerUpdatedAt: String(oldState.issuerUpdatedAt || now)
  };
}

function mergeState(scope: string, current: unknown, incoming: unknown, now: string) {
  const oldState = current && typeof current === "object" ? current as Row : {};
  const newState = incoming && typeof incoming === "object" ? incoming as Row : {};

  if (scope === "fiscal") {
    const deletedExpenseIds = mergeStringSet(oldState.deletedExpenseIds, newState.deletedExpenseIds);
    const deletedExpenses = new Set(deletedExpenseIds);

    return {
      ...oldState,
      ...newState,
      expenses: mergeByKey(oldState.expenses, newState.expenses, "id", now)
        .filter((row) => !deletedExpenses.has(String(row.id || ""))),
      taxRecords: mergeByKey(oldState.taxRecords, newState.taxRecords, "key", now),
      deletedExpenseIds
    };
  }

  const deletedClientIds = mergeStringSet(oldState.deletedClientIds, newState.deletedClientIds);
  const deletedInvoiceIds = mergeStringSet(oldState.deletedInvoiceIds, newState.deletedInvoiceIds);
  const deletedActivityIds = mergeStringSet(oldState.deletedActivityIds, newState.deletedActivityIds);
  const deletedConceptIds = mergeStringSet(oldState.deletedConceptIds, newState.deletedConceptIds);

  const clients = mergeByKey(oldState.clients, newState.clients, "id", now)
    .filter((row) => !deletedClientIds.includes(String(row.id || "")));
  const activities = mergeByKey(oldState.activities, newState.activities, "id", now)
    .filter((row) => !deletedActivityIds.includes(String(row.id || "")));
  const concepts = mergeByKey(oldState.concepts, newState.concepts, "id", now)
    .filter((row) => !deletedConceptIds.includes(String(row.id || "")));
  const invoices = assignAndValidateInvoiceNumbers(
    mergeByKey(oldState.invoices, newState.invoices, "id", now)
      .filter((row) => !deletedInvoiceIds.includes(String(row.id || ""))),
    now
  );

  const issuer = mergeIssuer(oldState, newState, now);

  return {
    ...oldState,
    ...newState,
    ...issuer,
    clients,
    activities,
    invoices,
    concepts,
    deletedClientIds,
    deletedInvoiceIds,
    deletedActivityIds,
    deletedConceptIds
  };
}

function samePayload(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function readState(supabaseUrl: string, headers: Record<string, string>, scope: string) {
  const url = `${supabaseUrl}/rest/v1/app_state?id=eq.${encodeURIComponent(scope)}&select=payload,updated_at,revision&limit=1`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`READ_FAILED:${response.status}:${await response.text()}`);
  const rows = await response.json();
  if (!rows[0]) throw new Error("STATE_NOT_FOUND");
  return rows[0] as { payload: unknown; updated_at: string; revision: number };
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "default";

  if (!["default", "fiscal"].includes(scope)) {
    return Response.json({ error: "Invalid scope" }, { status: 400 });
  }

  if (!["GET", "PUT"].includes(req.method)) {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "GET, PUT" } });
  }

  const body = req.method === "PUT" ? await req.text() : "";
  if (!(await authorized(req, scope, body))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const headers = adminHeaders();

  try {
    if (req.method === "GET") {
      const state = await readState(supabaseUrl, headers, scope);
      return Response.json(
        { data: state.payload, updatedAt: state.updated_at, revision: state.revision },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    let parsed: { payload?: unknown };
    try {
      parsed = JSON.parse(body);
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (!("payload" in parsed)) {
      return Response.json({ error: "Missing payload" }, { status: 400 });
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await readState(supabaseUrl, headers, scope);
      const now = new Date().toISOString();

      let merged: unknown;
      try {
        merged = mergeState(scope, current.payload, parsed.payload, now);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid state";
        if (message.startsWith("DUPLICATE_INVOICE_NUMBER:")) {
          return Response.json(
            { error: "duplicate_invoice_number", number: message.split(":").slice(1).join(":") },
            { status: 409 }
          );
        }
        throw error;
      }

      if (samePayload(current.payload, merged)) {
        return Response.json({
          saved: true,
          changed: false,
          data: current.payload,
          updatedAt: current.updated_at,
          revision: current.revision
        });
      }

      const historyResponse = await fetch(`${supabaseUrl}/rest/v1/app_state_history`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify([{
          scope,
          payload: current.payload,
          source_revision: current.revision
        }])
      });

      if (!historyResponse.ok) {
        throw new Error(`BACKUP_FAILED:${historyResponse.status}:${await historyResponse.text()}`);
      }

      const nextRevision = Number(current.revision || 0) + 1;
      const patchUrl =
        `${supabaseUrl}/rest/v1/app_state?id=eq.${encodeURIComponent(scope)}&revision=eq.${current.revision}&select=payload,updated_at,revision`;

      const writeResponse = await fetch(patchUrl, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({
          payload: merged,
          updated_at: now,
          revision: nextRevision
        })
      });

      if (!writeResponse.ok) {
        throw new Error(`WRITE_FAILED:${writeResponse.status}:${await writeResponse.text()}`);
      }

      const rows = await writeResponse.json();
      if (rows[0]) {
        return Response.json({
          saved: true,
          changed: true,
          data: rows[0].payload,
          updatedAt: rows[0].updated_at,
          revision: rows[0].revision
        });
      }

      // Another device won the compare-and-swap. Re-read and merge again.
    }

    return Response.json({ error: "sync_conflict_retry_exhausted" }, { status: 409 });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "sync_failed" }, { status: 500 });
  }
});
