-- ============================================================================
-- Familia Ponquesito — Reto 8, Etapa 4: actualización incremental
-- ============================================================================
--
-- Aplicar sobre un esquema que ya superó el checkpoint de Etapa 2.
-- Es idempotente, no elimina datos ni inserta filas. Puede ejecutarse más
-- de una vez. Después ejecutar supabase/verify-agenda-stage4.sql.

-- Eventos terminales idempotentes. Las filas existentes quedan con NULL y
-- se conservan sin cambios.
alter table public.reservation_events
  add column if not exists dedupe_key text;

create unique index if not exists reservation_events_dedupe_idx
  on public.reservation_events (reservation_id, dedupe_key)
  where dedupe_key is not null;

-- Misma firma de Etapa 2. Solo amplía el JSON exitoso con la fotografía de
-- capacidad calculada dentro de la transacción y protegida por el mismo lock.
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

  if p_status is null or p_status not in ('pending_deposit', 'human_review') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  if p_celebration_date < v_today + public.agenda_min_lead_days() then
    return jsonb_build_object('ok', false, 'error', 'too_soon');
  end if;

  if p_celebration_date > v_today + public.agenda_booking_window_days() then
    return jsonb_build_object('ok', false, 'error', 'out_of_window');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('agenda:' || p_celebration_date::text, 0)
  );

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
      trim(p_customer_name), trim(p_customer_email), trim(p_customer_phone),
      p_guest_count, trim(p_flavor), nullif(trim(p_theme), ''),
      p_fulfillment_type, nullif(trim(p_delivery_details), ''),
      p_reference_image_path, p_order_details, p_manage_token_hash
    )
    returning id into v_reservation_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'code_taken');
  end;

  insert into public.reservation_events (reservation_id, event_type, metadata)
  values (
    v_reservation_id, 'created',
    jsonb_build_object(
      'status', p_status,
      'capacity_points', p_capacity_points
    )
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
    'capacity_total', v_capacity_total,
    'capacity_used',
      case when v_consuming then v_used + p_capacity_points else v_used end,
    'capacity_remaining',
      case when v_consuming
        then greatest(v_capacity_total - v_used - p_capacity_points, 0)
        else greatest(v_capacity_total - v_used, 0)
      end
  );
end;
$$;

-- CREATE OR REPLACE conserva la ACL actual, pero se reafirman los permisos
-- para que el incremental sea autosuficiente y seguro ante ACL divergentes.
revoke execute on function public.reserve_production_slot(
  date, integer, text, text, text, text, text, text, integer,
  text, text, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.reserve_production_slot(
  date, integer, text, text, text, text, text, text, integer,
  text, text, text, text, text, jsonb
) to service_role;
