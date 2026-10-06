create table if not exists public.app_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- No public RLS policies are created intentionally.
-- The Next.js server uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Never expose that key to the browser.
