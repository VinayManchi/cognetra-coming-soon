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

create table if not exists public.waitlist_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  email text,
  ip text,
  user_agent text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists waitlist_events_email_created_idx on public.waitlist_events (email, created_at desc);
create index if not exists waitlist_events_ip_created_idx on public.waitlist_events (ip, created_at desc);
create index if not exists waitlist_events_type_created_idx on public.waitlist_events (event_type, created_at desc);
