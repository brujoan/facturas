import { sign } from "crypto";

export type SyncScope = "default" | "fiscal";

type AppPayload = {
  issuer?: unknown;
  clients?: unknown[];
  activities?: unknown[];
  invoices?: unknown[];
  concepts?: unknown[];
  expenses?: unknown[];
  taxRecords?: unknown[];
};

function config() {
  const url = process.env.SUPABASE_SYNC_URL;
  const privateKey = process.env.SYNC_SIGNING_PRIVATE_KEY;
  return url && privateKey ? { url, privateKey } : null;
}

function signature(privateKey: string, method: "GET" | "PUT", scope: SyncScope, body: string, timestamp: string) {
  const canonical = `${timestamp}.${method}.${scope}.${body}`;
  return sign("sha256", Buffer.from(canonical), {
    key: privateKey,
    dsaEncoding: "ieee-p1363"
  }).toString("base64");
}

async function requestState(scope: SyncScope, method: "GET" | "PUT", payload?: AppPayload) {
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

  if (!response.ok) {
    throw new Error(`Supabase sync failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

export function isDatabaseConfigured() {
  return Boolean(config());
}

export async function readAppState(): Promise<AppPayload | null> {
  const result = await requestState("default", "GET");
  return result?.data ?? null;
}

export async function writeAppState(payload: AppPayload) {
  const result = await requestState("default", "PUT", payload);
  return Boolean(result?.saved);
}

export async function readFiscalState(): Promise<AppPayload | null> {
  const result = await requestState("fiscal", "GET");
  return result?.data ?? null;
}

export async function writeFiscalState(payload: AppPayload) {
  const result = await requestState("fiscal", "PUT", payload);
  return Boolean(result?.saved);
}
