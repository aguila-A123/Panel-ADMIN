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


-- Categorías para productos (necesario para el nuevo apartado "Categoría")
alter table public.products add column if not exists category text;
alter table public.products add column if not exists category_extra text;

-- Monitor del worker NACEX / Servicio de etiquetas
create table if not exists public.worker_status (
  id text primary key,
  name text,
  status text,
  last_seen timestamptz,
  last_error text,
  updated_at timestamptz default now()
);

alter table public.worker_status enable row level security;

drop policy if exists "worker_status_select" on public.worker_status;
create policy "worker_status_select"
on public.worker_status
for select
using (true);

drop policy if exists "worker_status_all" on public.worker_status;
create policy "worker_status_all"
on public.worker_status
for all
using (true)
with check (true);

insert into public.worker_status (id, name, status, last_seen, updated_at)
values ('nacex_worker', 'Servicio de etiquetas', 'inactive', now(), now())
on conflict (id) do nothing;
