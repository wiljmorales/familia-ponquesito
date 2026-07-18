-- ============================================================================
-- Familia Ponquesito — Reto 8, Etapa 4: verificación incremental
-- ============================================================================
--
-- Ejecutar DESPUÉS de supabase/apply-agenda-stage4.sql.
-- Las comprobaciones de catálogo son de solo lectura. Los datos demo se crean
-- dentro de BEGIN/ROLLBACK y no sobreviven, incluso cuando todo sale bien.

-- 1. Esquema y firma.
do $$
declare
  v_indexdef text;
  v_functiondef text;
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'reservation_events'
       and column_name = 'dedupe_key'
       and is_nullable = 'YES'
  ) then
    raise exception '[verificación Etapa 4] falta reservation_events.dedupe_key nullable';
  end if;

  select indexdef into v_indexdef
    from pg_indexes
   where schemaname = 'public'
     and indexname = 'reservation_events_dedupe_idx';

  if v_indexdef is null
     or v_indexdef not like 'CREATE UNIQUE INDEX%'
     or v_indexdef not like '%(reservation_id, dedupe_key)%'
     or v_indexdef not like '%WHERE (dedupe_key IS NOT NULL)%' then
    raise exception '[verificación Etapa 4] índice parcial único incorrecto: %',
      coalesce(v_indexdef, 'ausente');
  end if;

  if to_regprocedure(
    'public.reserve_production_slot(date, integer, text, text, text, text, text, text, integer, text, text, text, text, text, jsonb)'
  ) is null then
    raise exception '[verificación Etapa 4] falta reserve_production_slot con la firma actual';
  end if;

  select pg_get_functiondef(
    to_regprocedure(
      'public.reserve_production_slot(date, integer, text, text, text, text, text, text, integer, text, text, text, text, text, jsonb)'
    )::oid
  ) into v_functiondef;

  if position(quote_literal('capacity_total') in v_functiondef) = 0
     or position(quote_literal('capacity_used') in v_functiondef) = 0
     or position(quote_literal('capacity_remaining') in v_functiondef) = 0 then
    raise exception '[verificación Etapa 4] el RPC no proyecta los tres campos de capacidad';
  end if;
end $$;

-- 2. Seguridad: todos los RPC de agenda conservan su ACL.
do $$
declare
  v_fn regprocedure;
  v_public_can boolean;
begin
  foreach v_fn in array array[
    'public.get_production_availability(date, date, integer)',
    'public.reserve_production_slot(date, integer, text, text, text, text, text, text, integer, text, text, text, text, text, jsonb)',
    'public.reschedule_cake_reservation(text, text, date)',
    'public.cancel_cake_reservation(text, text)'
  ]::regprocedure[] loop
    select (p.proacl is null)
           or exists (
             select 1
               from aclexplode(p.proacl) a
              where a.grantee = 0
                and a.privilege_type = 'EXECUTE'
           )
      into v_public_can
      from pg_proc p
     where p.oid = v_fn::oid;

    if v_public_can then
      raise exception '[verificación Etapa 4] PUBLIC puede ejecutar %', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '[verificación Etapa 4] anon puede ejecutar %', v_fn;
    end if;
    if has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '[verificación Etapa 4] authenticated puede ejecutar %', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '[verificación Etapa 4] service_role NO puede ejecutar %', v_fn;
    end if;
  end loop;
end $$;

-- 3. Idempotencia de eventos y fotografía transaccional de capacidad.
begin;

do $$
declare
  v_date date := public.agenda_business_today() + 40;
  v_result jsonb;
  v_reservation_id uuid;
  v_count integer;
begin
  if exists (
    select 1
      from public.cake_reservations
     where celebration_date = v_date
  ) or exists (
    select 1
      from public.production_day_overrides
     where business_date = v_date
  ) then
    raise exception '[verificación Etapa 4] la fecha demo % ya contiene datos; cambia el offset', v_date;
  end if;

  insert into public.production_day_overrides (
    business_date, capacity_total, internal_note
  ) values (
    v_date, 1, 'Reto 8 Etapa 4 — verificación temporal'
  );

  v_result := public.reserve_production_slot(
    v_date, 1, 'FP-8-ST4A', repeat('d4', 32), 'pending_deposit',
    'Reto 8 Etapa 4 — verificación', 'stage4-agenda-demo@example.com',
    '0412-0000000', 10, 'Chocolate (demo)', null, 'pickup', null, null,
    '{"demo": true, "source": "verify-agenda-stage4"}'::jsonb
  );

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception '[verificación Etapa 4] no se pudo crear la reserva demo: %', v_result;
  end if;

  if not (v_result ? 'capacity_total')
     or not (v_result ? 'capacity_used')
     or not (v_result ? 'capacity_remaining') then
    raise exception '[verificación Etapa 4] faltan campos de capacidad: %', v_result;
  end if;

  if (v_result->>'capacity_remaining')::integer
       <> (v_result->>'capacity_total')::integer
        - (v_result->>'capacity_used')::integer then
    raise exception '[verificación Etapa 4] remaining != total - used: %', v_result;
  end if;

  if (v_result->>'capacity_total')::integer <> 1
     or (v_result->>'capacity_used')::integer <> 1
     or (v_result->>'capacity_remaining')::integer <> 0 then
    raise exception '[verificación Etapa 4] el último punto no dejó capacidad 1/1/0: %', v_result;
  end if;

  v_reservation_id := (v_result->>'reservation_id')::uuid;

  insert into public.reservation_events (
    reservation_id, event_type, dedupe_key, metadata
  ) values (
    v_reservation_id, 'lead_registered', 'lead_registered', null
  );

  begin
    insert into public.reservation_events (
      reservation_id, event_type, dedupe_key, metadata
    ) values (
      v_reservation_id, 'lead_registered', 'lead_registered', null
    );
    raise exception '[verificación Etapa 4] el índice permitió duplicar lead_registered';
  exception
    when unique_violation then
      null;
  end;

  select count(*) into v_count
    from public.reservation_events
   where reservation_id = v_reservation_id
     and dedupe_key = 'lead_registered';
  if v_count <> 1 then
    raise exception '[verificación Etapa 4] se esperaban 1 evento terminal; hay %', v_count;
  end if;

  insert into public.reservation_events (
    reservation_id, event_type, dedupe_key, metadata
  ) values
    (v_reservation_id, 'email_failed', null, '{"recipient":"customer"}'::jsonb),
    (v_reservation_id, 'email_failed', null, '{"recipient":"customer"}'::jsonb);

  select count(*) into v_count
    from public.reservation_events
   where reservation_id = v_reservation_id
     and event_type = 'email_failed'
     and dedupe_key is null;
  if v_count <> 2 then
    raise exception '[verificación Etapa 4] los fallos sin dedupe_key no conservaron historial: %', v_count;
  end if;
end $$;

rollback;

select 'VERIFICACIÓN ETAPA 4' as resultado,
       'OK' as estado,
       'Todos los datos demo fueron revertidos con ROLLBACK' as limpieza;
