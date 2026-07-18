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

-- Familia Ponquesito — Reto 6: "Pulso Ponquesito" (reporte semanal automático)
--
-- Registro de ejecuciones del reporte semanal: una fila por corrida
-- (programada por Vercel Cron o disparada manualmente con el secreto).
-- Solo guarda métricas agregadas y el resumen ejecutivo — nunca nombres,
-- correos, teléfonos ni payloads de clientes. La página pública
-- /reporte-semanal lee exclusivamente esta tabla, así la anonimización es
-- estructural (no hay dato personal que filtrar). Ver docs/challenge-6.md.

create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  trigger_type text not null check (trigger_type in ('scheduled', 'manual')),
  status text not null default 'processing' check (
    status in ('processing', 'sent', 'email_error', 'data_error')
  ),
  -- Nulos SOLO mientras status = 'processing' o si la corrida falló antes
  -- de generarlos (data_error): la fila se inserta primero para reservar el
  -- periodo (idempotencia del cron) y se completa durante la ejecución.
  metrics jsonb,
  summary text,
  summary_source text check (summary_source in ('gemini', 'fallback')),
  -- Destinatario ENMASCARADO (ej. "k•••@gmail.com"), apto para mostrarse
  -- en la página pública. El correo real solo vive en la variable de
  -- entorno KAREM_NOTIFICATION_EMAIL, jamás en la base de datos.
  recipient_masked text,
  error_message text,
  generated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint weekly_reports_period_check check (period_end >= period_start)
);

comment on table public.weekly_reports is
  'Registro de ejecuciones del reporte semanal "Pulso Ponquesito" (Reto 6): métricas agregadas, resumen ejecutivo y resultado del envío. Sin datos personales por diseño.';
comment on column public.weekly_reports.summary_source is
  'gemini = resumen redactado por Gemini; fallback = resumen determinístico (Gemini nunca es punto único de fallo).';
comment on column public.weekly_reports.status is
  'processing → sent | email_error | data_error. Un fallo de Gemini NO es un estado de error: se usa el fallback y el envío continúa.';

-- Idempotencia del cron: solo puede existir UNA corrida programada por
-- periodo. El flujo programado inserta la fila 'processing' como reserva;
-- si otro disparo del mismo periodo ya la insertó, el insert falla con
-- 23505 y esa corrida se omite sin enviar correo. Las corridas manuales
-- (trigger_type = 'manual') quedan fuera del índice a propósito: reenviar
-- a mano un periodo es una acción deliberada y auditada con su propia fila.
create unique index if not exists weekly_reports_scheduled_period_key
  on public.weekly_reports (period_start, period_end)
  where trigger_type = 'scheduled';

-- Mismo criterio de seguridad que el resto: RLS habilitado y SIN políticas
-- públicas. Solo service_role desde el servidor (cron/route handler y la
-- página /reporte-semanal, que renderiza en servidor).
alter table public.weekly_reports enable row level security;

-- Familia Ponquesito — Reto 7: Agente de Atención Ponquesito
--
-- El agente recibe mensajes libres, decide una ruta y registra cada
-- decisión en agent_decisions. Cuando la ruta es la máquina de leads
-- (Reto 4), la fila de agent_decisions actúa como "fila original" del
-- lead (source_type = 'agent_message'), igual que cake_requests y
-- cake_designs lo hacen para los Retos 2 y 3. Ver docs/challenge-7.md.

-- Amplía el check de origen de leads para aceptar al agente. Se recrea el
-- constraint de forma idempotente; las filas existentes no se ven
-- afectadas (los valores previos siguen siendo válidos).
alter table public.leads drop constraint if exists leads_source_type_check;
alter table public.leads add constraint leads_source_type_check
  check (source_type in ('cake_request', 'cake_design', 'agent_message'));

create table if not exists public.agent_decisions (
  id uuid primary key default gen_random_uuid(),
  -- Etiqueta de la fuente del mensaje. Las fuentes de la demo llevan
  -- "(simulado)" de forma explícita; los mensajes escritos a mano llegan
  -- como "Mensaje directo (demostración)".
  source text not null,
  -- id del caso de demostración precargado (ej. "caso-1"); null para
  -- mensajes libres.
  source_record_id text,
  input_content text not null,
  intent text not null check (intent in (
    'new_order', 'general_question', 'missing_information',
    'order_change_or_cancellation', 'sensitive_or_urgent_case'
  )),
  route text not null check (route in (
    'lead_automation', 'knowledge_answer', 'request_information',
    'order_review', 'human_escalation'
  )),
  urgency text not null check (urgency in ('low', 'normal', 'high', 'critical')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  requires_human boolean not null,
  reason text not null,
  missing_fields jsonb not null default '[]'::jsonb,
  detected_order_code text,
  recommended_action text not null,
  -- null mientras status = 'processing' (la fila se inserta antes de
  -- ejecutar la ruta, igual que weekly_reports en el Reto 6).
  executed_action text,
  guardrail_corrections jsonb not null default '[]'::jsonb,
  decision_source text not null check (decision_source in ('gemini', 'fallback')),
  status text not null default 'processing' check (status in (
    'processing', 'lead_registered', 'answered', 'waiting_information',
    'escalated_to_human', 'not_executed'
  )),
  created_at timestamptz not null default now()
);

comment on table public.agent_decisions is
  'Decisiones del Agente de Atención Ponquesito (Reto 7): mensaje recibido, decisión estructurada (Gemini o fallback), correcciones de guardrails, ruta y acción ejecutada. Los datos de la demo están claramente marcados como simulados.';
comment on column public.agent_decisions.decision_source is
  'gemini = decisión del modelo validada; fallback = decisión determinista segura (el mensaje pasó a revisión humana).';
comment on column public.agent_decisions.guardrail_corrections is
  'Correcciones aplicadas por reglas deterministas del negocio sobre la decisión del modelo (lista de {rule, description}).';

-- Mismo criterio de seguridad que el resto: RLS habilitado y SIN políticas
-- públicas. Solo service_role desde el servidor (endpoint del agente).
alter table public.agent_decisions enable row level security;

-- Familia Ponquesito — Reto 8: "Agenda Ponquesito" (reservas de producción)
--
-- Un Calendly adaptado a tortas: el recurso reservable es la capacidad de
-- producción diaria, medida en puntos (sencilla = 1, personalizada = 2,
-- varios pisos / diseño especial = 3; capacidad por defecto = 4). La
-- autoridad final sobre capacidad, bloqueos y ventana de reserva es esta
-- base de datos: las funciones de abajo re-validan todo dentro de la
-- transacción, sin confiar en lo que calculó el navegador o el servidor
-- Next.js. Ver docs/challenge-8.md.

-- Amplía el check de origen de leads para aceptar reservas de la agenda
-- (mismo patrón idempotente del Reto 7; las filas existentes siguen siendo
-- válidas).
alter table public.leads drop constraint if exists leads_source_type_check;
alter table public.leads add constraint leads_source_type_check
  check (source_type in ('cake_request', 'cake_design', 'agent_message', 'cake_reservation'));

-- ---------------------------------------------------------------------------
-- Reglas del negocio centralizadas (ÚNICA definición ejecutable).
--
-- Estos helpers son la fuente de verdad en tiempo de ejecución. Las
-- constantes espejo de TypeScript (src/reservations/capacity.ts y
-- src/lib/constants/business.ts) solo existen para etiquetas visuales y
-- validación temprana de formularios; src/reservations/sql-alignment.test.ts
-- compara ambos lados y falla si divergen. Si cambias un valor aquí,
-- cambia también la constante TS (y viceversa).
-- ---------------------------------------------------------------------------

-- Capacidad de producción por día (en puntos) cuando no hay override.
-- Espejo TS: DEFAULT_DAILY_CAPACITY.
create or replace function public.agenda_default_capacity()
returns integer
language sql immutable
as $$ select 4 $$;

-- Anticipación mínima en días (no se reserva para hoy ni para mañana).
-- Espejo TS: MIN_LEAD_DAYS.
create or replace function public.agenda_min_lead_days()
returns integer
language sql immutable
as $$ select 3 $$;

-- Ventana máxima de reserva hacia adelante, en días.
-- Espejo TS: BOOKING_WINDOW_DAYS.
create or replace function public.agenda_booking_window_days()
returns integer
language sql immutable
as $$ select 60 $$;

-- Estados que consumen capacidad del día. 'human_review' NO consume a
-- propósito: aún no se conoce el peso real del pedido y una solicitud
-- ambigua no debe bloquear fechas. Espejo TS: CAPACITY_CONSUMING_STATUSES.
create or replace function public.agenda_capacity_consuming_statuses()
returns text[]
language sql immutable
as $$ select array['pending_deposit', 'confirmed']::text[] $$;

-- Hora y día calendario actuales del negocio (America/Caracas, UTC-4 sin
-- horario de verano). Ninguna regla de fechas usa la zona del servidor.
create or replace function public.agenda_business_now()
returns timestamp
language sql stable
as $$ select now() at time zone 'America/Caracas' $$;

create or replace function public.agenda_business_today()
returns date
language sql stable
as $$ select (now() at time zone 'America/Caracas')::date $$;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

-- Excepciones por día: capacidad distinta a la de defecto y/o día bloqueado
-- (viaje, feriado, descanso). Solo existe fila para los días que difieren
-- del comportamiento normal. Sin panel admin en el MVP: Karem (o quien la
-- ayude) inserta filas desde el editor SQL de Supabase.
create table if not exists public.production_day_overrides (
  id uuid primary key default gen_random_uuid(),
  business_date date not null unique,
  capacity_total integer not null default public.agenda_default_capacity()
    check (capacity_total >= 0),
  is_blocked boolean not null default false,
  -- Nota interna del negocio ("viaje familiar"). JAMÁS se expone al
  -- cliente: get_production_availability no la devuelve.
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.production_day_overrides is
  'Excepciones de capacidad por día (Reto 8): capacidad distinta a la de defecto o día bloqueado. Los días sin fila usan agenda_default_capacity() y no están bloqueados.';
comment on column public.production_day_overrides.internal_note is
  'Nota interna del negocio. Nunca se devuelve al cliente ni aparece en la disponibilidad pública.';

drop trigger if exists production_day_overrides_set_updated_at on public.production_day_overrides;
create trigger production_day_overrides_set_updated_at
  before update on public.production_day_overrides
  for each row
  execute function public.set_updated_at();

alter table public.production_day_overrides enable row level security;

-- Reservas de capacidad. El estado 'expired' queda reservado para una
-- evolución futura (expiración automática de anticipos no pagados); en este
-- MVP ninguna ruta lo asigna y no existe cron que lo produzca. No hay
-- hold_expires_at: el subsistema de "apartados temporales" quedó fuera del
-- alcance a propósito (la reserva nace pending_deposit y Karem confirma al
-- recibir el anticipo del 50%).
create table if not exists public.cake_reservations (
  id uuid primary key default gen_random_uuid(),
  -- Código legible único (ej. "FP-8-K7M2"). Identifica la reserva ante el
  -- cliente, pero NUNCA autoriza por sí solo: gestionar exige además el
  -- token privado (ver manage_token_hash).
  code text not null unique check (btrim(code) <> ''),
  celebration_date date not null,
  capacity_points integer not null check (capacity_points in (1, 2, 3)),
  status text not null default 'pending_deposit' check (
    status in ('pending_deposit', 'confirmed', 'human_review', 'cancelled', 'expired')
  ),
  -- Los datos esenciales no pueden ser vacíos ni solo espacios. El formato
  -- fino de correo/teléfono queda en Zod y el servicio (validaciones de
  -- formato en SQL serían frágiles); aquí solo lo estructural.
  customer_name text not null check (btrim(customer_name) <> ''),
  customer_email text not null check (btrim(customer_email) <> ''),
  customer_phone text not null check (btrim(customer_phone) <> ''),
  guest_count integer not null check (guest_count > 0),
  flavor text not null check (btrim(flavor) <> ''),
  theme text,
  fulfillment_type text not null check (fulfillment_type in ('pickup', 'delivery')),
  delivery_details text,
  -- Ruta dentro del bucket cake-references (misma convención del Reto 2).
  reference_image_path text,
  -- Detalle completo del pedido tal como lo clasificó el servidor
  -- (respuestas del formulario + motivos de la clasificación).
  order_details jsonb not null,
  -- SHA-256 (hex minúscula, 64 chars) del token privado de gestión. El
  -- token en claro solo viaja en el enlace del correo del cliente; aquí
  -- nunca.
  manage_token_hash text not null check (manage_token_hash ~ '^[0-9a-f]{64}$'),
  source text not null default 'agenda',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  -- cancelled_at existe si y solo si la reserva está cancelada: ningún
  -- flujo (ni un insert manual) puede dejar los dos campos incoherentes.
  constraint cake_reservations_cancelled_at_coherence check (
    (status = 'cancelled') = (cancelled_at is not null)
  ),
  -- Una entrega a domicilio sin dirección/indicaciones no es procesable.
  constraint cake_reservations_delivery_details_required check (
    fulfillment_type <> 'delivery' or btrim(coalesce(delivery_details, '')) <> ''
  )
);

comment on table public.cake_reservations is
  'Reservas de capacidad de producción de Agenda Ponquesito (Reto 8). Consumen capacidad solo los estados de agenda_capacity_consuming_statuses(); human_review guarda la solicitud sin apartar cupo.';
comment on column public.cake_reservations.capacity_points is
  'Peso del pedido en puntos de producción (1 sencilla, 2 personalizada, 3 varios pisos/diseño especial). En human_review es la estimación conservadora interna, sin efecto sobre la capacidad.';
comment on column public.cake_reservations.manage_token_hash is
  'Solo el hash SHA-256 del token de gestión. El token en claro jamás se persiste ni se registra en logs o eventos.';

create index if not exists cake_reservations_date_status_idx
  on public.cake_reservations (celebration_date, status);

drop trigger if exists cake_reservations_set_updated_at on public.cake_reservations;
create trigger cake_reservations_set_updated_at
  before update on public.cake_reservations
  for each row
  execute function public.set_updated_at();

alter table public.cake_reservations enable row level security;

-- Historial de eventos por reserva (auditoría del ciclo de vida). Nota:
-- 'rescheduled' es un EVENTO, no un estado — reprogramar conserva el
-- estado previo de la reserva y solo cambia celebration_date.
create table if not exists public.reservation_events (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.cake_reservations(id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'email_sent', 'email_failed', 'rescheduled', 'cancelled',
    'expired', 'lead_registered', 'human_review_requested'
  )),
  -- Contexto del evento (ej. {"previous_date": ..., "new_date": ...}).
  -- PROHIBIDO guardar aquí el token de gestión o el enlace privado.
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on table public.reservation_events is
  'Historial de eventos por reserva (Reto 8): creación, correos, reprogramaciones, cancelaciones. La metadata nunca contiene tokens ni enlaces privados.';

create index if not exists reservation_events_reservation_event_idx
  on public.reservation_events (reservation_id, event_type);

alter table public.reservation_events enable row level security;

-- ---------------------------------------------------------------------------
-- Disponibilidad (única fuente de verdad de la fórmula de capacidad)
--
-- Devuelve SOLO agregados por día: jamás datos de clientes, ids de
-- reservas ni notas internas. can_accept ya incorpora bloqueo, anticipación
-- mínima, ventana de reserva y capacidad restante frente a los puntos del
-- pedido actual; TypeScript no recalcula nada, solo etiqueta.
-- ---------------------------------------------------------------------------
create or replace function public.get_production_availability(
  p_start_date date,
  p_end_date date,
  p_capacity_points integer
)
returns table (
  business_date date,
  capacity_total integer,
  capacity_used integer,
  capacity_remaining integer,
  is_blocked boolean,
  can_accept boolean
)
language plpgsql
as $$
declare
  v_today date := public.agenda_business_today();
  v_min_date date := v_today + public.agenda_min_lead_days();
  v_max_date date := v_today + public.agenda_booking_window_days();
begin
  if p_capacity_points is null or p_capacity_points not in (1, 2, 3) then
    raise exception 'invalid_points';
  end if;
  -- Tope de ~3 meses por consulta: suficiente para pintar un calendario y
  -- evita que un rango arbitrario genere series enormes.
  if p_start_date is null or p_end_date is null
     or p_end_date < p_start_date
     or p_end_date - p_start_date > 92 then
    raise exception 'invalid_range';
  end if;

  return query
  select
    d.day,
    coalesce(o.capacity_total, public.agenda_default_capacity()),
    coalesce(u.used, 0)::integer,
    greatest(coalesce(o.capacity_total, public.agenda_default_capacity()) - coalesce(u.used, 0), 0)::integer,
    coalesce(o.is_blocked, false),
    (
      not coalesce(o.is_blocked, false)
      and d.day >= v_min_date
      and d.day <= v_max_date
      and coalesce(o.capacity_total, public.agenda_default_capacity()) - coalesce(u.used, 0) >= p_capacity_points
    )
  from generate_series(p_start_date, p_end_date, interval '1 day') as g(ts),
       lateral (select g.ts::date as day) as d
  left join public.production_day_overrides o on o.business_date = d.day
  left join (
    select r.celebration_date, sum(r.capacity_points) as used
    from public.cake_reservations r
    where r.status = any (public.agenda_capacity_consuming_statuses())
      and r.celebration_date between p_start_date and p_end_date
    group by r.celebration_date
  ) u on u.celebration_date = d.day
  order by d.day;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reserva atómica de cupo
--
-- Re-valida TODO dentro de la transacción (anticipación, ventana, bloqueo,
-- puntos, estado inicial, capacidad): el navegador y el servidor Next.js
-- solo proponen; aquí se decide. Anti-sobreventa: advisory lock
-- transaccional por fecha (clave bigint estable) que serializa todas las
-- reservas del mismo día; la capacidad se recalcula ya dentro del lock.
--
-- Devuelve jsonb {ok: true, ...} o {ok: false, error: <código>} — los
-- códigos son los de ReservationErrorCode en src/reservations/types.ts.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_production_slot(
  p_celebration_date date,
  p_capacity_points integer,
  p_code text,
  p_manage_token_hash text,
  p_status text,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_guest_count integer,
  p_flavor text,
  p_theme text,
  p_fulfillment_type text,
  p_delivery_details text,
  p_reference_image_path text,
  p_order_details jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_today date := public.agenda_business_today();
  v_capacity_total integer;
  v_is_blocked boolean;
  v_used integer;
  v_consuming boolean;
  v_reservation_id uuid;
begin
  if p_celebration_date is null
     or nullif(trim(p_code), '') is null
     or p_manage_token_hash is null or p_manage_token_hash !~ '^[0-9a-f]{64}$'
     or nullif(trim(p_customer_name), '') is null
     or nullif(trim(p_customer_email), '') is null
     or nullif(trim(p_customer_phone), '') is null
     or p_guest_count is null or p_guest_count <= 0
     or nullif(trim(p_flavor), '') is null
     or p_fulfillment_type is null or p_fulfillment_type not in ('pickup', 'delivery')
     or (p_fulfillment_type = 'delivery' and nullif(trim(p_delivery_details), '') is null)
     or p_order_details is null then
    return jsonb_build_object('ok', false, 'error', 'missing_data');
  end if;

  if p_capacity_points is null or p_capacity_points not in (1, 2, 3) then
    return jsonb_build_object('ok', false, 'error', 'invalid_points');
  end if;

  -- Estados iniciales permitidos. 'confirmed' NUNCA nace aquí: confirmar
  -- exige el anticipo del 50% y eso lo hace el negocio, no el formulario.
  if p_status is null or p_status not in ('pending_deposit', 'human_review') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  if p_celebration_date < v_today + public.agenda_min_lead_days() then
    return jsonb_build_object('ok', false, 'error', 'too_soon');
  end if;

  if p_celebration_date > v_today + public.agenda_booking_window_days() then
    return jsonb_build_object('ok', false, 'error', 'out_of_window');
  end if;

  -- Serializa todas las reservas de esta fecha. El lock se libera solo al
  -- terminar la transacción (commit o rollback).
  perform pg_advisory_xact_lock(hashtextextended('agenda:' || p_celebration_date::text, 0));

  select o.capacity_total, o.is_blocked
    into v_capacity_total, v_is_blocked
    from public.production_day_overrides o
   where o.business_date = p_celebration_date;
  if not found then
    v_capacity_total := public.agenda_default_capacity();
    v_is_blocked := false;
  end if;

  if v_is_blocked then
    return jsonb_build_object('ok', false, 'error', 'date_blocked');
  end if;

  v_consuming := p_status = any (public.agenda_capacity_consuming_statuses());

  select coalesce(sum(r.capacity_points), 0)
    into v_used
    from public.cake_reservations r
   where r.celebration_date = p_celebration_date
     and r.status = any (public.agenda_capacity_consuming_statuses());

  -- human_review no consume capacidad: se guarda la solicitud aunque el
  -- día esté lleno (la fecha queda "solicitada, no reservada").
  if v_consuming and v_used + p_capacity_points > v_capacity_total then
    return jsonb_build_object(
      'ok', false,
      'error', 'capacity_unavailable',
      'capacity_remaining', greatest(v_capacity_total - v_used, 0)
    );
  end if;

  begin
    insert into public.cake_reservations (
      code, celebration_date, capacity_points, status,
      customer_name, customer_email, customer_phone, guest_count,
      flavor, theme, fulfillment_type, delivery_details,
      reference_image_path, order_details, manage_token_hash
    ) values (
      trim(p_code), p_celebration_date, p_capacity_points, p_status,
      trim(p_customer_name), trim(p_customer_email), trim(p_customer_phone), p_guest_count,
      trim(p_flavor), nullif(trim(p_theme), ''), p_fulfillment_type, nullif(trim(p_delivery_details), ''),
      p_reference_image_path, p_order_details, p_manage_token_hash
    )
    returning id into v_reservation_id;
  exception when unique_violation then
    -- Colisión del código legible: el servidor genera otro y reintenta.
    return jsonb_build_object('ok', false, 'error', 'code_taken');
  end;

  insert into public.reservation_events (reservation_id, event_type, metadata)
  values (
    v_reservation_id, 'created',
    jsonb_build_object('status', p_status, 'capacity_points', p_capacity_points)
  );

  if p_status = 'human_review' then
    insert into public.reservation_events (reservation_id, event_type)
    values (v_reservation_id, 'human_review_requested');
  end if;

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_reservation_id,
    'code', trim(p_code),
    'status', p_status,
    'capacity_remaining',
      case when v_consuming
        then greatest(v_capacity_total - v_used - p_capacity_points, 0)
        else greatest(v_capacity_total - v_used, 0)
      end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reprogramación atómica
--
-- Orden de locks (a propósito, para que nunca haya ciclos):
--   1. Fila de la reserva (FOR UPDATE por code + hash): dos
--      reprogramaciones concurrentes de la MISMA reserva se serializan
--      aquí; la segunda re-lee el estado ya actualizado.
--   2. Advisory locks de ambas fechas SIEMPRE en orden ascendente
--      (least/greatest): dos reprogramaciones cruzadas entre las mismas
--      fechas los toman en el mismo orden.
-- reserve_production_slot solo toma el lock de fecha y ninguna fila, así
-- que no puede formar ciclo con esta función.
--
-- Política "sin cambios cuando la preparación ya empezó", modelada como:
-- se puede reprogramar hasta 24h antes del INICIO del día de la
-- celebración en America/Caracas (no existe hora de entrega, así que el
-- límite es la medianoche que inicia el día anterior). Aplica sobre la
-- fecha ACTUAL de la reserva. Misma regla para cancelar.
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_cake_reservation(
  p_code text,
  p_manage_token_hash text,
  p_new_date date
)
returns jsonb
language plpgsql
as $$
declare
  v_today date := public.agenda_business_today();
  v_res public.cake_reservations%rowtype;
  v_capacity_total integer;
  v_is_blocked boolean;
  v_used integer;
begin
  if p_code is null or p_manage_token_hash is null or p_new_date is null then
    return jsonb_build_object('ok', false, 'error', 'missing_data');
  end if;

  select * into v_res
    from public.cake_reservations r
   where r.code = p_code and r.manage_token_hash = p_manage_token_hash
   for update;

  -- Mismo error para código inexistente y token inválido: distinguirlos
  -- permitiría enumerar códigos de reservas reales.
  if not found then
    return jsonb_build_object('ok', false, 'error', 'reservation_not_found');
  end if;

  if v_res.status not in ('pending_deposit', 'confirmed') then
    return jsonb_build_object('ok', false, 'error', 'status_not_modifiable');
  end if;

  if public.agenda_business_now() >= (v_res.celebration_date - 1)::timestamp then
    return jsonb_build_object('ok', false, 'error', 'change_window_closed');
  end if;

  if p_new_date = v_res.celebration_date then
    return jsonb_build_object('ok', false, 'error', 'same_date');
  end if;

  if p_new_date < v_today + public.agenda_min_lead_days() then
    return jsonb_build_object('ok', false, 'error', 'too_soon');
  end if;

  if p_new_date > v_today + public.agenda_booking_window_days() then
    return jsonb_build_object('ok', false, 'error', 'out_of_window');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'agenda:' || least(v_res.celebration_date, p_new_date)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'agenda:' || greatest(v_res.celebration_date, p_new_date)::text, 0));

  select o.capacity_total, o.is_blocked
    into v_capacity_total, v_is_blocked
    from public.production_day_overrides o
   where o.business_date = p_new_date;
  if not found then
    v_capacity_total := public.agenda_default_capacity();
    v_is_blocked := false;
  end if;

  if v_is_blocked then
    return jsonb_build_object('ok', false, 'error', 'date_blocked');
  end if;

  select coalesce(sum(r.capacity_points), 0)
    into v_used
    from public.cake_reservations r
   where r.celebration_date = p_new_date
     and r.status = any (public.agenda_capacity_consuming_statuses());

  if v_used + v_res.capacity_points > v_capacity_total then
    return jsonb_build_object(
      'ok', false,
      'error', 'capacity_unavailable',
      'capacity_remaining', greatest(v_capacity_total - v_used, 0)
    );
  end if;

  -- Reprogramar conserva el estado (pending_deposit sigue pendiente,
  -- confirmed sigue confirmada); solo cambia la fecha. La fecha anterior
  -- libera su cupo automáticamente: la suma de arriba solo cuenta filas
  -- por celebration_date.
  update public.cake_reservations
     set celebration_date = p_new_date
   where id = v_res.id;

  insert into public.reservation_events (reservation_id, event_type, metadata)
  values (
    v_res.id, 'rescheduled',
    jsonb_build_object(
      'previous_date', v_res.celebration_date::text,
      'new_date', p_new_date::text
    )
  );

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_res.id,
    'code', v_res.code,
    'status', v_res.status,
    'previous_date', v_res.celebration_date::text,
    'new_date', p_new_date::text
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancelación
--
-- Solo pending_deposit y confirmed pueden cancelarse, hasta 24h antes del
-- inicio del día de la celebración (misma aproximación de medianoche que
-- la reprogramación). Libera el cupo de inmediato: la fila deja de contar
-- en la suma de estados que consumen.
--
-- Sin advisory lock de fecha a propósito: una reserva concurrente que aún
-- no ve esta cancelación solo puede equivocarse de forma conservadora
-- (ver el día lleno cuando ya no lo está); nunca produce sobreventa.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_cake_reservation(
  p_code text,
  p_manage_token_hash text
)
returns jsonb
language plpgsql
as $$
declare
  v_res public.cake_reservations%rowtype;
begin
  if p_code is null or p_manage_token_hash is null then
    return jsonb_build_object('ok', false, 'error', 'missing_data');
  end if;

  select * into v_res
    from public.cake_reservations r
   where r.code = p_code and r.manage_token_hash = p_manage_token_hash
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'reservation_not_found');
  end if;

  if v_res.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'already_cancelled');
  end if;

  if v_res.status not in ('pending_deposit', 'confirmed') then
    return jsonb_build_object('ok', false, 'error', 'status_not_cancellable');
  end if;

  if public.agenda_business_now() >= (v_res.celebration_date - 1)::timestamp then
    return jsonb_build_object('ok', false, 'error', 'cancellation_window_closed');
  end if;

  update public.cake_reservations
     set status = 'cancelled', cancelled_at = now()
   where id = v_res.id;

  insert into public.reservation_events (reservation_id, event_type, metadata)
  values (
    v_res.id, 'cancelled',
    jsonb_build_object('previous_status', v_res.status)
  );

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_res.id,
    'code', v_res.code,
    'status', 'cancelled',
    'celebration_date', v_res.celebration_date::text
  );
end;
$$;

-- Mismo criterio de seguridad que las tablas: ninguna función de la agenda
-- es invocable por clientes anónimos o autenticados; solo service_role
-- desde el servidor. (El GRANT a PUBLIC que Postgres da por defecto se
-- revoca explícitamente.)
revoke execute on function public.agenda_default_capacity() from public, anon, authenticated;
revoke execute on function public.agenda_min_lead_days() from public, anon, authenticated;
revoke execute on function public.agenda_booking_window_days() from public, anon, authenticated;
revoke execute on function public.agenda_capacity_consuming_statuses() from public, anon, authenticated;
revoke execute on function public.agenda_business_now() from public, anon, authenticated;
revoke execute on function public.agenda_business_today() from public, anon, authenticated;
revoke execute on function public.get_production_availability(date, date, integer) from public, anon, authenticated;
revoke execute on function public.reserve_production_slot(date, integer, text, text, text, text, text, text, integer, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.reschedule_cake_reservation(text, text, date) from public, anon, authenticated;
revoke execute on function public.cancel_cake_reservation(text, text) from public, anon, authenticated;

grant execute on function public.agenda_default_capacity() to service_role;
grant execute on function public.agenda_min_lead_days() to service_role;
grant execute on function public.agenda_booking_window_days() to service_role;
grant execute on function public.agenda_capacity_consuming_statuses() to service_role;
grant execute on function public.agenda_business_now() to service_role;
grant execute on function public.agenda_business_today() to service_role;
grant execute on function public.get_production_availability(date, date, integer) to service_role;
grant execute on function public.reserve_production_slot(date, integer, text, text, text, text, text, text, integer, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.reschedule_cake_reservation(text, text, date) to service_role;
grant execute on function public.cancel_cake_reservation(text, text) to service_role;
