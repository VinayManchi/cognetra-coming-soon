create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'unsubscribed')),
  token_hash text,
  token_expires_at timestamptz,
  consent_at timestamptz,
  consent_version text,
  source text,
  signup_ip text,
  signup_user_agent text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists waitlist_signups_status_idx on public.waitlist_signups (status);
