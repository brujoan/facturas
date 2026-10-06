type AppPayload = {
  issuer: unknown;
  clients: unknown[];
  activities: unknown[];
  invoices: unknown[];
  concepts?: unknown[];
  expenses?: unknown[];
  taxRecords?: unknown[];
};

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

function headers(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}

export function isDatabaseConfigured() {
  return Boolean(config());
}

export async function readAppState(): Promise<AppPayload | null> {
  const cfg = config();
  if (!cfg) return null;

  const response = await fetch(
    `${cfg.url}/rest/v1/app_state?id=eq.default&select=payload&limit=1`,
    { headers: headers(cfg.key), cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error(`Supabase read failed: ${response.status} ${await response.text()}`);
  }

  const rows = (await response.json()) as Array<{ payload?: AppPayload }>;
  return rows[0]?.payload ?? null;
}

export async function writeAppState(payload: AppPayload) {
  const cfg = config();
  if (!cfg) return false;

  const response = await fetch(`${cfg.url}/rest/v1/app_state?on_conflict=id`, {
    method: "POST",
    headers: {
      ...headers(cfg.key),
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify([
      {
        id: "default",
        payload,
        updated_at: new Date().toISOString()
      }
    ])
  });

  if (!response.ok) {
    throw new Error(`Supabase write failed: ${response.status} ${await response.text()}`);
  }

  return true;
}
