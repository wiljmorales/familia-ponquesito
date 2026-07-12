-- Familia Ponquesito — Reto 2: solicitudes de cotización
--
-- Cómo aplicarlo: pega este archivo completo en el SQL Editor de tu
-- proyecto de Supabase (Database > SQL Editor) y ejecútalo. Es idempotente
-- (puedes volver a correrlo sin duplicar nada).

create table if not exists public.cake_requests (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  whatsapp text not null,
  celebration_date date not null,
  celebration_type text not null,
  guest_count integer not null,
  preferred_flavor text not null,
  cake_description text not null,
  reference_image_url text,
  status text not null default 'new',
  source text not null default 'landing',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cake_requests_status_check check (
    status in ('new', 'contacted', 'quoted', 'confirmed', 'cancelled', 'completed')
  ),
  constraint cake_requests_guest_count_check check (guest_count > 0)
);

comment on table public.cake_requests is
  'Solicitudes de cotización de tortas recibidas desde el formulario público de la landing.';
comment on column public.cake_requests.reference_image_url is
  'Ruta del objeto dentro del bucket cake-references (no es una URL pública: el bucket es privado).';

-- RLS habilitado y SIN políticas públicas a propósito: la única vía de
-- lectura/escritura es el rol service_role, usado exclusivamente desde el
-- servidor (Server Action de Next.js), nunca expuesto al navegador. Esto
-- evita tener que abrir una política de inserción anónima para un
-- formulario público.
alter table public.cake_requests enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cake_requests_set_updated_at on public.cake_requests;
create trigger cake_requests_set_updated_at
  before update on public.cake_requests
  for each row
  execute function public.set_updated_at();

-- Bucket privado para las imágenes de referencia adjuntas al formulario.
-- Privado a propósito: son fotos que clientes suben con fines de
-- cotización, no material para publicar; no necesitan URL pública.
insert into storage.buckets (id, name, public)
values ('cake-references', 'cake-references', false)
on conflict (id) do nothing;

-- Sin políticas de storage para anon/authenticated: igual que la tabla,
-- las subidas y lecturas de este bucket solo ocurren desde el servidor
-- con la service role key.
