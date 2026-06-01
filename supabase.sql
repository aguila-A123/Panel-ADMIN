create extension if not exists "pgcrypto";

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  price numeric(10,2) default 0,
  image_url text,
  status text default 'Activo',
  created_at timestamptz default now()
);

create table if not exists public.product_sizes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  size text,
  price numeric(10,2),
  stock integer default 0,
  created_at timestamptz default now()
);

alter table public.products enable row level security;
alter table public.product_sizes enable row level security;

create policy "products_all"
on public.products
for all
using (true)
with check (true);

create policy "sizes_all"
on public.product_sizes
for all
using (true)
with check (true);

