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

-- Familia Ponquesito — Reto 3: leads del cake builder ("Crea tu propia torta")
--
-- Tabla nueva y separada de cake_requests a propósito: cake_requests tiene
-- columnas NOT NULL (celebration_type, preferred_flavor, cake_description)
-- que no existen en el flujo del Reto 3; forzarlas con valores inventados
-- ensuciaría los datos reales del Reto 2. Ver docs/challenge-3.md.

create table if not exists public.cake_designs (
  id uuid primary key default gen_random_uuid(),
  design_code text not null unique,
  design jsonb not null,
  customer_name text not null,
  whatsapp text not null,
  email text,
  event_date date not null,
  guest_count integer not null,
  zone text not null,
  status text not null default 'new',
  source text not null default 'cake-builder',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cake_designs_status_check check (
    status in ('new', 'contacted', 'quoted', 'confirmed', 'cancelled', 'completed')
  ),
  constraint cake_designs_guest_count_check check (guest_count > 0)
);

comment on table public.cake_designs is
  'Leads capturados desde el juego "Crea tu propia torta" (Reto 3): diseño completo + datos de contacto para preparar una cotización personalizada.';
comment on column public.cake_designs.design is
  'Configuración completa del diseño (CakeDesign serializado): permite reconstruirlo sin depender de una imagen guardada.';
comment on column public.cake_designs.design_code is
  'Código amigable mostrado al cliente (ej. FP-3-A7K2), generado en el servidor al guardar.';

-- Mismo criterio de seguridad que cake_requests: RLS habilitado y SIN
-- políticas públicas. La única vía de lectura/escritura es el rol
-- service_role, usado exclusivamente desde una Server Action de servidor.
alter table public.cake_designs enable row level security;

drop trigger if exists cake_designs_set_updated_at on public.cake_designs;
create trigger cake_designs_set_updated_at
  before update on public.cake_designs
  for each row
  execute function public.set_updated_at();

-- Familia Ponquesito — Reto 4: "la máquina de leads que trabaja sola"
--
-- Añade correo del cliente a cake_requests (el Reto 2 nunca lo recolectó) y
-- dos tablas nuevas para centralizar la automatización de ambas fuentes de
-- leads sin duplicar lógica ni tocar cake_requests/cake_designs más de lo
-- necesario. Ver docs/challenge-4.md.

-- Columna nueva, nullable a propósito: forzar NOT NULL rompería cualquier
-- fila ya existente sin correo. Lo "obligatorio" se aplica en la
-- validación Zod/UI para todo envío nuevo a partir de este reto, no aquí.
alter table public.cake_requests add column if not exists email text;

comment on column public.cake_requests.email is
  'Correo del cliente. Nullable por compatibilidad con filas anteriores al Reto 4; requerido por Zod/UI para envíos nuevos.';

-- Tabla central de leads: une cake_requests y cake_designs en un solo
-- lugar para la automatización (clasificación, correos, WhatsApp), sin
-- reemplazar esas tablas como fuente de verdad de cada solicitud.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('cake_request', 'cake_design')),
  source_id uuid not null,
  reference_code text not null unique,
  customer_name text not null,
  customer_email text not null,
  customer_whatsapp text not null,
  celebration_date date not null,
  priority text not null check (priority in ('not_viable', 'urgent', 'high', 'normal')),
  normalized_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint leads_source_unique unique (source_type, source_id)
);

comment on table public.leads is
  'Vista central de leads capturados en cake_requests (Reto 2) y cake_designs (Reto 3), usada por el servicio de automatización (Reto 4). No reemplaza esas tablas: source_type + source_id apuntan a la fila original.';
comment on column public.leads.customer_email is
  'Requerido: a diferencia de cake_requests.email (nullable, por filas previas al Reto 4), todo lead creado por este flujo exige correo.';
comment on constraint leads_source_unique on public.leads is
  'Evita duplicar el lead si processLead se vuelve a ejecutar para la misma solicitud (idempotencia).';

-- Sin updated_at: los leads no se editan después de creados (la
-- clasificación y los datos normalizados se calculan una sola vez al
-- registrarse); un campo que nunca cambia no aporta nada.

alter table public.leads enable row level security;

-- Historial de intentos de automatización por lead (registro de correo al
-- cliente, correo a Karem, etc.). Permite demostrar que el flujo se
-- ejecutó y sirve para la idempotencia real: antes de reenviar un correo,
-- el servicio consulta si ya existe un evento con status = 'success' para
-- ese lead_id + event_type.
create table if not exists public.lead_automation_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null check (event_type in ('lead_registered', 'customer_email', 'owner_email')),
  status text not null check (status in ('success', 'error')),
  error_message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on table public.lead_automation_events is
  'Historial de intentos de automatización (correo al cliente, correo a Karem) por lead. metadata guarda, entre otros datos, el id devuelto por Resend cuando el envío tiene éxito.';

create index if not exists lead_automation_events_lead_event_status_idx
  on public.lead_automation_events (lead_id, event_type, status);

-- Mismo criterio de seguridad que el resto: RLS habilitado y SIN políticas
-- públicas. Solo service_role, desde el servicio de automatización que
-- corre en el servidor tras un envío exitoso a cake_requests/cake_designs.
alter table public.lead_automation_events enable row level security;
