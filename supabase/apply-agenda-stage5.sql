-- Familia Ponquesito — Reto 8, Etapa 5 (incremental e idempotente).
-- Aplicar después de apply-agenda-stage4.sql. No inserta ni elimina datos.

create or replace function public.get_cake_reservation(
  p_code text,
  p_manage_token_hash text
)
returns jsonb
language plpgsql
as $$
declare
  v_res public.cake_reservations%rowtype;
  v_change_window_open boolean;
  v_modifiable boolean;
  v_reason text;
begin
  if nullif(trim(p_code), '') is null
     or p_manage_token_hash is null
     or p_manage_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'reservation_not_found');
  end if;

  select * into v_res
    from public.cake_reservations r
   where r.code = trim(p_code)
     and r.manage_token_hash = p_manage_token_hash;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'reservation_not_found');
  end if;

  v_change_window_open :=
    public.agenda_business_now() < (v_res.celebration_date - 1)::timestamp;
  v_modifiable :=
    v_res.status in ('pending_deposit', 'confirmed', 'human_review')
    and v_change_window_open;
  v_reason := case
    when v_res.status in ('cancelled', 'expired') then 'status_not_modifiable'
    when not v_change_window_open then 'change_window_closed'
    else null
  end;

  return jsonb_build_object(
    'ok', true,
    'reservation', jsonb_build_object(
      'code', v_res.code,
      'celebration_date', v_res.celebration_date::text,
      'status', v_res.status,
      'customer_name', v_res.customer_name,
      'guest_count', v_res.guest_count,
      'flavor', v_res.flavor,
      'theme', v_res.theme,
      'fulfillment_type', v_res.fulfillment_type,
      'delivery_details', v_res.delivery_details,
      'created_at', v_res.created_at,
      'capacity_points', v_res.capacity_points,
      'can_reschedule', v_modifiable,
      'can_cancel', v_modifiable,
      'reschedule_reason', v_reason,
      'cancellation_reason', case
        when v_reason = 'change_window_closed' then 'cancellation_window_closed'
        when v_res.status = 'cancelled' then 'already_cancelled'
        when v_res.status = 'expired' then 'status_not_cancellable'
        else null
      end
    )
  );
end;
$$;

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

  if not found then
    return jsonb_build_object('ok', false, 'error', 'reservation_not_found');
  end if;
  if v_res.status not in ('pending_deposit', 'confirmed', 'human_review') then
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

  if v_res.status = any (public.agenda_capacity_consuming_statuses()) then
    select coalesce(sum(r.capacity_points), 0)
      into v_used
      from public.cake_reservations r
     where r.celebration_date = p_new_date
       and r.status = any (public.agenda_capacity_consuming_statuses());
    if v_used + v_res.capacity_points > v_capacity_total then
      return jsonb_build_object(
        'ok', false, 'error', 'capacity_unavailable',
        'capacity_remaining', greatest(v_capacity_total - v_used, 0)
      );
    end if;
  end if;

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
  if v_res.status not in ('pending_deposit', 'confirmed', 'human_review') then
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

revoke execute on function public.get_cake_reservation(text, text)
  from public, anon, authenticated;
revoke execute on function public.reschedule_cake_reservation(text, text, date)
  from public, anon, authenticated;
revoke execute on function public.cancel_cake_reservation(text, text)
  from public, anon, authenticated;

grant execute on function public.get_cake_reservation(text, text) to service_role;
grant execute on function public.reschedule_cake_reservation(text, text, date) to service_role;
grant execute on function public.cancel_cake_reservation(text, text) to service_role;
