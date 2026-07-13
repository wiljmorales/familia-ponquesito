-- Familia Ponquesito — Reto 2: solicitudes de cotización
--
-- Cómo aplicarlo: pega este archivo completo en el SQL Editor de tu
-- proyecto de Supabase (Database > SQL Editor) y ejecútalo. Es idempotente
-- (puedes volver a correrlo sin duplicar nada ni perder datos existentes).

create table if not exists public.cake_requests (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  whatsapp text not null,
  celebration_date date not null,
  celebration_type text not null,
  guest_count integer not null,
  preferred_flavor text not null,
  cake_description text not null,
  reference_image_path text,
  status text not null default 'new',
  source text not null default 'landing',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cake_requests_status_check check (
    status in ('new', 'contacted', 'quoted', 'confirmed', 'cancelled', 'completed')
  ),
  constraint cake_requests_guest_count_check check (guest_count > 0)
);

-- Migra instalaciones previas que ya tenían la columna con el nombre
-- antiguo (reference_image_url): se renombra en vez de recrearla para no
-- perder datos. El nombre "url" era engañoso porque nunca guarda una URL
-- (el bucket es privado); ahora es explícitamente una ruta interna.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cake_requests'
      and column_name = 'reference_image_url'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cake_requests'
      and column_name = 'reference_image_path'
  ) then
    alter table public.cake_requests
      rename column reference_image_url to reference_image_path;
  end if;
end $$;

comment on table public.cake_requests is
  'Solicitudes de cotización de tortas recibidas desde el formulario público de la landing.';
comment on column public.cake_requests.reference_image_path is
  'Ruta del objeto dentro del bucket privado cake-references (NO una URL pública ni firmada). '
  'Para mostrarla, generar una signed URL temporal en el servidor con createSignedUrl.';

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
-- file_size_limit y allowed_mime_types quedan reforzados también aquí (no
-- solo en el código de la app) como segunda capa de defensa.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cake-references',
  'cake-references',
  false,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Sin políticas de storage para anon/authenticated: igual que la tabla,
-- las subidas, lecturas y borrados de este bucket solo ocurren desde el
-- servidor con la service role key (que bypassa RLS y políticas de
-- Storage por diseño).
