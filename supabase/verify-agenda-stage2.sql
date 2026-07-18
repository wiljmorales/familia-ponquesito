-- ============================================================================
-- Familia Ponquesito — Reto 8, Etapa 2: verificación del esquema de la agenda
-- ============================================================================
--
-- CÓMO USARLO
--   1. Aplica ANTES la sección del Reto 8 de supabase/schema.sql (desde el
--      marcador «Reto 8: "Agenda Ponquesito"» hasta el final del archivo).
--   2. Pega este archivo COMPLETO en el SQL Editor de Supabase y ejecútalo.
--
-- CÓMO LEER EL RESULTADO
--   - Si TODO pasa: la última consulta muestra una tabla con la
--     configuración efectiva, una muestra de disponibilidad real y la fila
--     final «VERIFICACIÓN COMPLETA: OK».
--   - Si ALGO falla: la ejecución se detiene con un error cuyo mensaje
--     empieza por «[verificación Reto 8]» e indica exactamente qué
--     comprobación falló. Un "Success" sin esa tabla final NO cuenta como
--     verificación superada.
--
-- SEGURIDAD / REPETIBILIDAD
--   - Las secciones 1–3 son de SOLO LECTURA (catálogo del sistema y
--     get_production_availability, que devuelve únicamente agregados).
--   - La sección 4 crea datos de demostración inequívocamente falsos
--     (stage2-agenda-demo@example.com, 0412-0000000) dentro de un bloque
--     begin/rollback: TODO lo que inserta se revierte al final y no queda
--     ninguna fila. Puede ejecutarse cuantas veces se quiera.
--   - No contiene tokens reales ni secretos: los "hashes" de demostración
--     son patrones hexadecimales repetidos, sin token en claro asociado.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Estructura: tablas, RLS, índices, constraints, funciones
-- ----------------------------------------------------------------------------
do $$
declare
  v_table text;
  v_rls boolean;
begin
  -- Tablas y RLS habilitado en cada una.
  foreach v_table in array array[
    'production_day_overrides', 'cake_reservations', 'reservation_events'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception '[verificación Reto 8] falta la tabla public.%', v_table;
    end if;
    select relrowsecurity into v_rls
      from pg_class where oid = to_regclass('public.' || v_table);
    if not v_rls then
      raise exception '[verificación Reto 8] RLS no está habilitado en public.%', v_table;
    end if;
  end loop;

  -- Índices esperados.
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                  and indexname = 'cake_reservations_date_status_idx') then
    raise exception '[verificación Reto 8] falta el índice cake_reservations_date_status_idx';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                  and indexname = 'reservation_events_reservation_event_idx') then
    raise exception '[verificación Reto 8] falta el índice reservation_events_reservation_event_idx';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                  and indexname = 'reservation_events_dedupe_idx'
                  and indexdef like '%UNIQUE%'
                  and indexdef like '%WHERE (dedupe_key IS NOT NULL)%') then
    raise exception '[verificación Reto 8] falta el índice parcial único reservation_events_dedupe_idx';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public'
                    and table_name = 'reservation_events'
                    and column_name = 'dedupe_key'
                    and is_nullable = 'YES') then
    raise exception '[verificación Reto 8] falta reservation_events.dedupe_key nullable';
  end if;

  -- Constraints importantes (los nombrados y los generados por columna).
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cake_reservations'::regclass
                    and conname = 'cake_reservations_code_key') then
    raise exception '[verificación Reto 8] falta el unique de cake_reservations.code';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cake_reservations'::regclass
                    and conname = 'cake_reservations_cancelled_at_coherence') then
    raise exception '[verificación Reto 8] falta cake_reservations_cancelled_at_coherence';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cake_reservations'::regclass
                    and conname = 'cake_reservations_delivery_details_required') then
    raise exception '[verificación Reto 8] falta cake_reservations_delivery_details_required';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cake_reservations'::regclass
                    and contype = 'c'
                    and pg_get_constraintdef(oid) like '%capacity_points%') then
    raise exception '[verificación Reto 8] falta el check de capacity_points';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cake_reservations'::regclass
                    and contype = 'c'
                    and pg_get_constraintdef(oid) like '%manage_token_hash%') then
    raise exception '[verificación Reto 8] falta el check de manage_token_hash';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.production_day_overrides'::regclass
                    and conname = 'production_day_overrides_business_date_key') then
    raise exception '[verificación Reto 8] falta el unique de production_day_overrides.business_date';
  end if;

  -- leads_source_type_check acepta cake_reservation.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.leads'::regclass
                    and conname = 'leads_source_type_check'
                    and pg_get_constraintdef(oid) like '%cake_reservation%') then
    raise exception '[verificación Reto 8] leads_source_type_check no incluye cake_reservation';
  end if;

  -- Helpers agenda_* y los cuatro RPC, con sus firmas exactas.
  if to_regprocedure('public.agenda_default_capacity()') is null
     or to_regprocedure('public.agenda_min_lead_days()') is null
     or to_regprocedure('public.agenda_booking_window_days()') is null
     or to_regprocedure('public.agenda_capacity_consuming_statuses()') is null
     or to_regprocedure('public.agenda_business_now()') is null
     or to_regprocedure('public.agenda_business_today()') is null then
    raise exception '[verificación Reto 8] falta algún helper agenda_*';
  end if;
  if to_regprocedure('public.get_production_availability(date, date, integer)') is null then
    raise exception '[verificación Reto 8] falta get_production_availability(date, date, integer)';
  end if;
  if to_regprocedure('public.reserve_production_slot(date, integer, text, text, text, text, text, text, integer, text, text, text, text, text, jsonb)') is null then
    raise exception '[verificación Reto 8] falta reserve_production_slot con la firma esperada';
  end if;
  if to_regprocedure('public.reschedule_cake_reservation(text, text, date)') is null then
    raise exception '[verificación Reto 8] falta reschedule_cake_reservation(text, text, date)';
  end if;
  if to_regprocedure('public.cancel_cake_reservation(text, text)') is null then
    raise exception '[verificación Reto 8] falta cancel_cake_reservation(text, text)';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Permisos: PUBLIC/anon/authenticated NO ejecutan; service_role SÍ
-- ----------------------------------------------------------------------------
do $$
declare
  v_fn regprocedure;
  v_public_can boolean;
begin
  foreach v_fn in array array[
    'public.agenda_default_capacity()',
    'public.agenda_min_lead_days()',
    'public.agenda_booking_window_days()',
    'public.agenda_capacity_consuming_statuses()',
    'public.agenda_business_now()',
    'public.agenda_business_today()',
    'public.get_production_availability(date, date, integer)',
    'public.reserve_production_slot(date, integer, text, text, text, text, text, text, integer, text, text, text, text, text, jsonb)',
    'public.reschedule_cake_reservation(text, text, date)',
    'public.cancel_cake_reservation(text, text)'
  ]::regprocedure[] loop
    -- PUBLIC: sin ACL explícita, Postgres da EXECUTE a todo el mundo; aquí
    -- exigimos ACL explícita y sin entrada para PUBLIC (grantee = 0).
    select (p.proacl is null)
           or exists (select 1 from aclexplode(p.proacl) a
                       where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      into v_public_can
      from pg_proc p where p.oid = v_fn::oid;
    if v_public_can then
      raise exception '[verificación Reto 8] PUBLIC puede ejecutar %', v_fn;
    end if;

    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '[verificación Reto 8] anon puede ejecutar %', v_fn;
    end if;
    if has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '[verificación Reto 8] authenticated puede ejecutar %', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '[verificación Reto 8] service_role NO puede ejecutar %', v_fn;
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Disponibilidad real (solo lectura): agregados, anticipación y ventana
-- ----------------------------------------------------------------------------
do $$
declare
  v_result_columns text;
  v_today date := public.agenda_business_today();
  v_bad_row record;
begin
  -- Estructura del resultado: SOLO los seis agregados, nunca internal_note
  -- ni datos de clientes (garantía estructural: la función no puede
  -- devolver columnas que no declara).
  v_result_columns := pg_get_function_result(
    to_regprocedure('public.get_production_availability(date, date, integer)')::oid);
  if v_result_columns <> 'TABLE(business_date date, capacity_total integer, capacity_used integer, capacity_remaining integer, is_blocked boolean, can_accept boolean)' then
    raise exception '[verificación Reto 8] get_production_availability devuelve columnas inesperadas: %', v_result_columns;
  end if;
  if v_result_columns like '%internal_note%' or v_result_columns like '%customer%' then
    raise exception '[verificación Reto 8] la disponibilidad expone datos internos';
  end if;

  -- Anticipación mínima: ningún día antes de hoy + agenda_min_lead_days()
  -- puede aceptar pedidos.
  select * into v_bad_row
    from public.get_production_availability(v_today, v_today + 70, 1) a
   where a.business_date < v_today + public.agenda_min_lead_days()
     and a.can_accept
   limit 1;
  if found then
    raise exception '[verificación Reto 8] % acepta pedidos dentro de la anticipación mínima', v_bad_row.business_date;
  end if;

  -- Ventana: ningún día después de hoy + agenda_booking_window_days()
  -- puede aceptar pedidos.
  select * into v_bad_row
    from public.get_production_availability(v_today, v_today + 70, 1) a
   where a.business_date > v_today + public.agenda_booking_window_days()
     and a.can_accept
   limit 1;
  if found then
    raise exception '[verificación Reto 8] % acepta pedidos fuera de la ventana de reserva', v_bad_row.business_date;
  end if;

  -- Un día sin override usa la capacidad predeterminada.
  select * into v_bad_row
    from public.get_production_availability(v_today, v_today + 70, 1) a
   where not exists (select 1 from public.production_day_overrides o
                      where o.business_date = a.business_date)
     and a.capacity_total <> public.agenda_default_capacity()
   limit 1;
  if found then
    raise exception '[verificación Reto 8] % no usa la capacidad predeterminada sin override', v_bad_row.business_date;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Prueba transaccional SIN dejar datos (begin … rollback)
--
-- Escenario: un día futuro seguro (hoy + 30) con capacidad 3. Reserva de
-- 2 puntos → queda 1 → una segunda reserva de 1 punto toma el último
-- cupo → una tercera recibe capacity_unavailable → reprogramar libera la
-- fecha → cancelar libera el resto. Nada de esto sobrevive al rollback.
-- ----------------------------------------------------------------------------
begin;

do $$
declare
  v_date date := public.agenda_business_today() + 30;
  v_new_date date := public.agenda_business_today() + 31;
  v_r jsonb;
  v_row record;
begin
  -- (1–2) Override de demostración: capacidad total 3. Falla si la fecha
  -- ya tuviera reservas reales que consumen (no debería: es un proyecto de
  -- demostración; preferimos abortar antes que razonar sobre datos mezclados).
  if exists (select 1 from public.cake_reservations r
              where r.celebration_date in (v_date, v_new_date)
                and r.status = any (public.agenda_capacity_consuming_statuses())) then
    raise exception '[verificación Reto 8] las fechas de demo (% / %) ya tienen reservas reales; elige otro offset', v_date, v_new_date;
  end if;
  insert into public.production_day_overrides (business_date, capacity_total, internal_note)
  values (v_date, 3, 'Reto 8 — verificación transaccional');

  -- (3) Reserva de 2 puntos vía RPC.
  v_r := public.reserve_production_slot(
    v_date, 2, 'FP-8-ST2A', repeat('a1', 32), 'pending_deposit',
    'Reto 8 — verificación transaccional', 'stage2-agenda-demo@example.com',
    '0412-0000000', 10, 'Chocolate (demo)', null, 'pickup', null, null,
    '{"demo": true, "source": "verify-agenda-stage2"}'::jsonb);
  if not (v_r->>'ok')::boolean then
    raise exception '[verificación Reto 8] paso 3: la reserva de 2 puntos falló: %', v_r;
  end if;
  if (v_r->>'capacity_total')::integer <> 3
     or (v_r->>'capacity_used')::integer <> 2
     or (v_r->>'capacity_remaining')::integer <> 1 then
    raise exception '[verificación Reto 8] paso 3: fotografía transaccional de capacidad incorrecta: %', v_r;
  end if;

  -- (4–5) Disponibilidad para un pedido de 1 punto: acepta y es el último cupo.
  select * into v_row from public.get_production_availability(v_date, v_date, 1);
  if not v_row.can_accept or v_row.capacity_remaining <> 1 then
    raise exception '[verificación Reto 8] paso 4: se esperaba último cupo (remaining=1, acepta); hay %', to_jsonb(v_row);
  end if;

  -- (6) Segunda reserva: toma el último punto.
  v_r := public.reserve_production_slot(
    v_date, 1, 'FP-8-ST2B', repeat('b2', 32), 'pending_deposit',
    'Reto 8 — verificación transaccional', 'stage2-agenda-demo@example.com',
    '0412-0000000', 8, 'Vainilla (demo)', null, 'pickup', null, null,
    '{"demo": true, "source": "verify-agenda-stage2"}'::jsonb);
  if not (v_r->>'ok')::boolean then
    raise exception '[verificación Reto 8] paso 6: la reserva del último cupo falló: %', v_r;
  end if;

  -- (7) La fecha quedó llena.
  select * into v_row from public.get_production_availability(v_date, v_date, 1);
  if v_row.can_accept or v_row.capacity_remaining <> 0 then
    raise exception '[verificación Reto 8] paso 7: la fecha debía estar llena; hay %', to_jsonb(v_row);
  end if;

  -- (8–9) Tercera reserva → capacity_unavailable.
  v_r := public.reserve_production_slot(
    v_date, 1, 'FP-8-ST2C', repeat('c3', 32), 'pending_deposit',
    'Reto 8 — verificación transaccional', 'stage2-agenda-demo@example.com',
    '0412-0000000', 6, 'Fresa (demo)', null, 'pickup', null, null,
    '{"demo": true, "source": "verify-agenda-stage2"}'::jsonb);
  if (v_r->>'ok')::boolean or v_r->>'error' <> 'capacity_unavailable' then
    raise exception '[verificación Reto 8] paso 8: se esperaba capacity_unavailable; llegó %', v_r;
  end if;

  -- (10) Reprogramar la reserva de 2 puntos a otra fecha.
  v_r := public.reschedule_cake_reservation('FP-8-ST2A', repeat('a1', 32), v_new_date);
  if not (v_r->>'ok')::boolean then
    raise exception '[verificación Reto 8] paso 10: la reprogramación falló: %', v_r;
  end if;

  -- (11) La fecha original liberó los 2 puntos (queda 1 usado de ST2B).
  select * into v_row from public.get_production_availability(v_date, v_date, 1);
  if not v_row.can_accept or v_row.capacity_remaining <> 2 then
    raise exception '[verificación Reto 8] paso 11: se esperaba remaining=2 tras reprogramar; hay %', to_jsonb(v_row);
  end if;

  -- (12) Cancelar la reserva restante (a 30 días, la regla de 24h lo permite).
  v_r := public.cancel_cake_reservation('FP-8-ST2B', repeat('b2', 32));
  if not (v_r->>'ok')::boolean then
    raise exception '[verificación Reto 8] paso 12: la cancelación falló: %', v_r;
  end if;

  -- (13) La capacidad volvió a liberarse por completo.
  select * into v_row from public.get_production_availability(v_date, v_date, 1);
  if v_row.capacity_used <> 0 or v_row.capacity_remaining <> 3 then
    raise exception '[verificación Reto 8] paso 13: se esperaba la capacidad libre (3); hay %', to_jsonb(v_row);
  end if;

  -- Anti-enumeración: código correcto + token equivocado = mismo error que
  -- código inexistente.
  v_r := public.cancel_cake_reservation('FP-8-ST2A', repeat('ff', 32));
  if v_r->>'error' <> 'reservation_not_found' then
    raise exception '[verificación Reto 8] anti-enumeración: se esperaba reservation_not_found; llegó %', v_r;
  end if;
end $$;

-- (14) Nada de lo anterior se conserva.
rollback;

-- ----------------------------------------------------------------------------
-- 5. Resumen final (si llegaste aquí, TODO pasó)
-- ----------------------------------------------------------------------------
select 'capacidad predeterminada (puntos/día)' as item,
       public.agenda_default_capacity()::text as valor
union all
select 'anticipación mínima (días)', public.agenda_min_lead_days()::text
union all
select 'ventana de reserva (días)', public.agenda_booking_window_days()::text
union all
select 'estados que consumen capacidad',
       array_to_string(public.agenda_capacity_consuming_statuses(), ', ')
union all
select 'hoy (día del negocio, America/Caracas)', public.agenda_business_today()::text
union all
select 'disponibilidad ' || a.business_date::text,
       format('total=%s usado=%s libre=%s bloqueado=%s acepta_1pt=%s',
              a.capacity_total, a.capacity_used, a.capacity_remaining,
              a.is_blocked, a.can_accept)
from public.get_production_availability(
       public.agenda_business_today() + public.agenda_min_lead_days(),
       public.agenda_business_today() + public.agenda_min_lead_days() + 6,
       1) a
union all
select 'VERIFICACIÓN COMPLETA', 'OK';
