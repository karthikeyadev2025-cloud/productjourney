-- Run this once in the Supabase SQL editor for your new project.
-- Creates all tables used by the jewelry pipeline (Vercel cloud version).

-- ============================================================
-- 1. Products table (original)
-- ============================================================
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  product_name  text not null,
  category      text,
  short_description text,
  long_description  text,
  materials     text,
  tags          text[] default '{}',
  folder        text not null unique,
  images        jsonb not null default '[]',   -- [{name, url, scene, angle}]
  source_file   text,
  status        text default 'ready',
  created_at    timestamptz default now()
);

create index if not exists products_created_at_idx on public.products (created_at desc);
create index if not exists products_category_idx   on public.products (category);

alter table public.products enable row level security;
drop policy if exists "public read" on public.products;
create policy "public read" on public.products for select using (true);

-- ============================================================
-- 2. Settings table (replaces local config.json)
-- ============================================================
create table if not exists public.settings (
  id            text primary key default 'main',
  gemini_api_key text default '',
  supabase_url  text default '',
  supabase_key  text default '',
  text_model    text default 'gemini-2.5-flash',
  image_model   text default 'gemini-2.5-flash-image',
  scenes        text[] default '{marble,model,golden,silk}',
  angles        text[] default '{}',
  gender        text default 'female',
  preset        text default 'clean',
  updated_at    timestamptz default now()
);

alter table public.settings enable row level security;

-- ============================================================
-- 3. Jobs table (replaces in-memory job object)
-- ============================================================
create table if not exists public.jobs (
  id            uuid primary key default gen_random_uuid(),
  running       boolean default false,
  total         int default 0,
  done          int default 0,
  current       text default '',
  step          text default '',
  logs          jsonb default '[]',
  results       jsonb default '[]',
  errors        jsonb default '[]',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.jobs enable row level security;

-- Insert a default job row (singleton pattern — we always update this one row)
insert into public.jobs (id, running) values ('00000000-0000-0000-0000-000000000001', false)
on conflict (id) do nothing;

-- Insert a default settings row
insert into public.settings (id) values ('main')
on conflict (id) do nothing;

-- ============================================================
-- Storage buckets
-- ============================================================
-- The "jewelry" bucket (for output images) is created automatically by the app.
-- The "jewelry-input" bucket (for raw uploads) is also created automatically.
-- Both are set to public so URLs work directly.

-- ============================================================
-- RLS policies for service-key access
-- ============================================================
-- The server uses the service_role key which bypasses RLS,
-- so no additional policies are needed for writes.
-- Public read on products is already set above.
