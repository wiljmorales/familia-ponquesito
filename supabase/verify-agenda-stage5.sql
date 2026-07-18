-- Familia Ponquesito — Reto 8, Etapa 5: verificación local/transaccional.
-- Ejecutar después de apply-agenda-stage5.sql. Todos los datos hacen ROLLBACK.

do $$
declare
  v_fn regprocedure;
  v_public_can boolean;
begin
  foreach v_fn in array array[
    'public.get_cake_reservation(text, text)',
    'public.reschedule_cake_reservation(text, text, date)',
    'public.cancel_cake_reservation(text, text)'
  ]::regprocedure[] loop
    if v_fn is null then
      raise exception '[verificación Etapa 5] falta un RPC';
    end if;
    select (p.proacl is null) or exists (
      select 1 from aclexplode(p.proacl) a
       where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) into v_public_can from pg_proc p where p.oid = v_fn::oid;
    if v_public_can
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '[verificación Etapa 5] ACL insegura para %', v_fn;
    end if;
  end loop;
end $$;

begin;

do $$
declare
  v_today date := public.agenda_business_today();
  v_old date := v_today + 20;
  v_new date := v_today + 22;
  v_full date := v_today + 24;
  v_blocked date := v_today + 26;
  v_hash text := repeat('a5', 32);
  v_wrong_hash text := repeat('ff', 32);
  v_pending_id uuid;
  v_review_id uuid;
  v_close_id uuid;
  v_result jsonb;
  v_invalid_code jsonb;
  v_invalid_token jsonb;
  v_count integer;
begin
  insert into public.production_day_overrides (business_date, capacity_total, is_blocked)
  values
    (v_old, 2, false),
    (v_new, 2, false),
    (v_full, 1, false),
    (v_blocked, 4, true);

  insert into public.cake_reservations (
    code, celebration_date, capacity_points, status, customer_name,
    customer_email, customer_phone, guest_count, flavor, theme,
    fulfillment_type, order_details, manage_token_hash
  ) values (
    'FP-8-ST5A', v_old, 2, 'pending_deposit', 'Cliente etapa 5',
    'stage5@example.com', '0412-0000000', 20, 'Chocolate', 'Flores',
    'pickup', '{"private":"must-not-leak"}', v_hash
  ) returning id into v_pending_id;

  insert into public.cake_reservations (
    code, celebration_date, capacity_points, status, customer_name,
    customer_email, customer_phone, guest_count, flavor,
    fulfillment_type, order_details, manage_token_hash
  ) values (
    'FP-8-ST5H', v_old, 3, 'human_review', 'Revisión etapa 5',
    'review@example.com', '0412-0000001', 40, 'Vainilla',
    'pickup', '{"private":"must-not-leak"}', repeat('b5', 32)
  ) returning id into v_review_id;

  insert into public.cake_reservations (
    code, celebration_date, capacity_points, status, customer_name,
    customer_email, customer_phone, guest_count, flavor,
    fulfillment_type, order_details, manage_token_hash
  ) values (
    'FP-8-ST5C', v_today + 1, 1, 'pending_deposit', 'Ventana cerrada',
    'close@example.com', '0412-0000003', 8, 'Vainilla',
    'pickup', '{}', repeat('d5', 32)
  ) returning id into v_close_id;

  insert into public.cake_reservations (
    code, celebration_date, capacity_points, status, customer_name,
    customer_email, customer_phone, guest_count, flavor,
    fulfillment_type, order_details, manage_token_hash
  ) values (
    'FP-8-ST5F', v_full, 1, 'confirmed', 'Ocupa capacidad',
    'full@example.com', '0412-0000002', 10, 'Vainilla',
    'pickup', '{}', repeat('c5', 32)
  );

  v_result := public.get_cake_reservation('FP-8-ST5A', v_hash);
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception '[verificación Etapa 5] lectura válida falló: %', v_result;
  end if;
  if (v_result->'reservation') ?| array[
    'id', 'manage_token_hash', 'order_details', 'reference_image_path',
    'customer_email', 'customer_phone', 'updated_at', 'cancelled_at'
  ] then
    raise exception '[verificación Etapa 5] lectura filtró datos privados: %', v_result;
  end if;

  v_invalid_code := public.get_cake_reservation('FP-8-NOPE', v_hash);
  v_invalid_token := public.get_cake_reservation('FP-8-ST5A', v_wrong_hash);
  if v_invalid_code <> v_invalid_token
     or v_invalid_code <> '{"ok":false,"error":"reservation_not_found"}'::jsonb then
    raise exception '[verificación Etapa 5] anti-enumeración divergente: % / %',
      v_invalid_code, v_invalid_token;
  end if;

  v_result := public.reschedule_cake_reservation('FP-8-ST5A', v_hash, v_old);
  if v_result->>'error' <> 'same_date' then
    raise exception '[verificación Etapa 5] misma fecha no fue rechazada: %', v_result;
  end if;
  v_result := public.reschedule_cake_reservation('FP-8-ST5A', v_hash, v_today + 2);
  if v_result->>'error' <> 'too_soon' then
    raise exception '[verificación Etapa 5] regla de 3 días falló: %', v_result;
  end if;
  v_result := public.reschedule_cake_reservation('FP-8-ST5A', v_hash, v_today + 61);
  if v_result->>'error' <> 'out_of_window' then
    raise exception '[verificación Etapa 5] ventana de 60 días falló: %', v_result;
  end if;
  v_result := public.reschedule_cake_reservation('FP-8-ST5A', v_hash, v_blocked);
  if v_result->>'error' <> 'date_blocked' then
    raise exception '[verificación Etapa 5] fecha bloqueada falló: %', v_result;
  end if;
  v_result := public.reschedule_cake_reservation('FP-8-ST5A', v_hash, v_full);
  if v_result->>'error' <> 'capacity_unavailable' then
    raise exception '[verificación Etapa 5] capacidad insuficiente falló: %', v_result;
  end if;

  v_result := public.reschedule_cake_reservation(
    'FP-8-ST5C', repeat('d5', 32), v_today + 10
  );
  if v_result->>'error' <> 'change_window_closed' then
    raise exception '[verificación Etapa 5] regla de 24h al reprogramar falló: %', v_result;
  end if;
  v_result := public.cancel_cake_reservation('FP-8-ST5C', repeat('d5', 32));
  if v_result->>'error' <> 'cancellation_window_closed' then
    raise exception '[verificación Etapa 5] regla de 24h al cancelar falló: %', v_result;
  end if;

  v_result := public.reschedule_cake_reservation('FP-8-ST5A', v_hash, v_new);
  if not coalesce((v_result->>'ok')::boolean, false)
     or v_result->>'previous_date' <> v_old::text
     or v_result->>'new_date' <> v_new::text then
    raise exception '[verificación Etapa 5] reprogramación atómica falló: %', v_result;
  end if;
  select count(*) into v_count from public.reservation_events
   where reservation_id = v_pending_id and event_type = 'rescheduled';
  if v_count <> 1 then
    raise exception '[verificación Etapa 5] falta evento rescheduled';
  end if;

  -- human_review puede mover su preferencia incluso a un día sin cupo y
  -- continúa sin formar parte de la capacidad consumida.
  v_result := public.reschedule_cake_reservation(
    'FP-8-ST5H', repeat('b5', 32), v_full
  );
  if not coalesce((v_result->>'ok')::boolean, false)
     or v_result->>'status' <> 'human_review' then
    raise exception '[verificación Etapa 5] human_review no cambió preferencia: %', v_result;
  end if;
  select coalesce(sum(capacity_points), 0) into v_count
    from public.cake_reservations
   where celebration_date = v_full
     and status = any (public.agenda_capacity_consuming_statuses());
  if v_count <> 1 then
    raise exception '[verificación Etapa 5] human_review consumió capacidad: %', v_count;
  end if;

  v_result := public.cancel_cake_reservation('FP-8-ST5H', repeat('b5', 32));
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception '[verificación Etapa 5] cancelación human_review falló: %', v_result;
  end if;
  if not exists (
    select 1 from public.cake_reservations
     where id = v_review_id and status = 'cancelled' and cancelled_at is not null
  ) then
    raise exception '[verificación Etapa 5] cancelled_at incoherente';
  end if;

  v_result := public.cancel_cake_reservation('FP-8-ST5A', v_hash);
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception '[verificación Etapa 5] cancelación falló: %', v_result;
  end if;
  if exists (
    select 1 from public.cake_reservations
     where id = v_pending_id
       and status = any (public.agenda_capacity_consuming_statuses())
  ) then
    raise exception '[verificación Etapa 5] cancelación no liberó capacidad';
  end if;
  v_result := public.cancel_cake_reservation('FP-8-ST5A', v_hash);
  if v_result->>'error' <> 'already_cancelled' then
    raise exception '[verificación Etapa 5] segunda cancelación no fue rechazada: %', v_result;
  end if;
end $$;

rollback;

select 'VERIFICACIÓN ETAPA 5' as resultado,
       'OK' as estado,
       'Todos los datos demo fueron revertidos con ROLLBACK' as limpieza;
