import { sign } from "crypto";

export type SyncScope = "default" | "fiscal";

export type AppPayload = {
  issuer?: unknown;
  issuerUpdatedAt?: string;
  clients?: unknown[];
  activities?: unknown[];
  invoices?: unknown[];
  concepts?: unknown[];
  deletedClientIds?: string[];
  deletedInvoiceIds?: string[];
  deletedActivityIds?: string[];
  deletedConceptIds?: string[];
  expenses?: unknown[];
  taxRecords?: unknown[];
  deletedExpenseIds?: string[];
};

export type SyncResult = {
  saved?: boolean;
  changed?: boolean;
  data?: AppPayload | null;
  updatedAt?: string | null;
  revision?: number;
};

function config() {
  const url = process.env.SUPABASE_SYNC_URL;
  const privateKey = process.env.SYNC_SIGNING_PRIVATE_KEY;
  return url && privateKey ? { url, privateKey } : null;
}

function signature(
  privateKey: string,
  method: "GET" | "PUT",
  scope: SyncScope,
  body: string,
  timestamp: string
) {
  const canonical = `${timestamp}.${method}.${scope}.${body}`;
  return sign("sha256", Buffer.from(canonical), {
    key: privateKey,
    dsaEncoding: "ieee-p1363"
  }).toString("base64");
}

async function requestState(
  scope: SyncScope,
  method: "GET" | "PUT",
  payload?: AppPayload
): Promise<SyncResult | null> {
  const cfg = config();
  if (!cfg) return null;

  const body = method === "PUT" ? JSON.stringify({ payload }) : "";
  const timestamp = String(Date.now());
  const response = await fetch(`${cfg.url}?scope=${scope}`, {
    method,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-sync-timestamp": timestamp,
      "x-sync-signature": signature(cfg.privateKey, method, scope, body, timestamp)
    },
    ...(method === "PUT" ? { body } : {})
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail =
      result?.error === "duplicate_invoice_number"
        ? `duplicate_invoice_number:${result.number || ""}`
        : result?.error || `status_${response.status}`;
    throw new Error(`Supabase sync failed: ${detail}`);
  }

  return result as SyncResult;
}

export function isDatabaseConfigured() {
  return Boolean(config());
}

export async function readAppState() {
  return requestState("default", "GET");
}

export async function writeAppState(payload: AppPayload) {
  return requestState("default", "PUT", payload);
}

export async function readFiscalState() {
  return requestState("fiscal", "GET");
}

export async function writeFiscalState(payload: AppPayload) {
  return requestState("fiscal", "PUT", payload);
}
