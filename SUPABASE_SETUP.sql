-- Run this once in the Supabase SQL editor for your new project.
-- Creates all tables and storage buckets used by the jewelry pipeline (Vercel cloud version).

-- ============================================================
-- 1. Products table
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
  text_model    text default 'gemini-3.5-flash',
  image_model   text default 'gemini-3.1-flash-lite-image',
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
  "perImage"    jsonb default '{}',   -- per-file status map for Batch Command Center
  lease_owner       text,            -- exclusive processing lock owner (prevents double-processing races)
  lease_expires_at  timestamptz,     -- self-expiring lease, so a crashed/killed invocation can't wedge the lock forever
  config_snapshot   jsonb,           -- creative settings frozen at batch-start time (scenes/angles/gender/preset/aspectRatio/watermarkUrl/imageLimit)
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.jobs enable row level security;

-- Insert singleton rows if they don't exist
insert into public.jobs (id, running) values ('00000000-0000-0000-0000-000000000001', false)
on conflict (id) do nothing;

insert into public.settings (id) values ('main')
on conflict (id) do nothing;


-- ============================================================
-- 4. Storage Buckets Setup
-- ============================================================
-- 'jewelry' (rendered catalog output) is public — the storefront links
-- directly to these images.
-- 'jewelry-input' (raw, unprocessed customer/client photos) is PRIVATE —
-- the app only ever accesses it through the authenticated admin API,
-- which uses short-lived signed URLs, never a public link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values 
  ('jewelry', 'jewelry', true, null, null),
  ('jewelry-input', 'jewelry-input', false, null, null)
on conflict (id) do nothing;

-- If this project was created before this update, the bucket may already
-- exist as public — this flips it to private for existing installs too.
update storage.buckets set public = false where id = 'jewelry-input';

-- Public read applies ONLY to the output bucket now.
drop policy if exists "Public Access to Jewelry Images" on storage.objects;
create policy "Public Access to Jewelry Images"
on storage.objects for select
using ( bucket_id = 'jewelry' );

-- ============================================================
-- 5. Migration: Add perImage column to existing jobs table
--    Run this if your jobs table was created before this update.
-- ============================================================
alter table public.jobs
  add column if not exists "perImage" jsonb default '{}';

-- ============================================================
-- 6. Migration: Add processing-lease + config-snapshot columns
--    Run this if your jobs table was created before this update.
--    These close a race condition where a page reload, a second open
--    tab, or a client retry after a timeout could run the render
--    pipeline twice concurrently against the same file.
-- ============================================================
alter table public.jobs
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists config_snapshot jsonb;
