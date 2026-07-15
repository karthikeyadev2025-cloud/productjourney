-- Run this once in the Supabase SQL editor for your new project.
-- Creates the products table used by the jewelry pipeline.

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

-- Row-level security is safe to enable; the server uses the service key which bypasses RLS.
alter table public.products enable row level security;

-- Allow anonymous read access so any storefront (Shopify/Woo/MyStore OS) can pull the catalog.
drop policy if exists "public read" on public.products;
create policy "public read" on public.products for select using (true);

-- The Supabase Storage bucket named "jewelry" is created automatically by the app on first run,
-- and set to public so image URLs are directly usable in your storefront.
