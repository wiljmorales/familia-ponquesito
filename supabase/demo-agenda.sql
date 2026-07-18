-- ============================================================================
-- Agenda Ponquesito — escenario oficial de demostración del Reto 8
-- ============================================================================
--
-- Uso seguro en Supabase SQL Editor:
--   1. Ejecuta únicamente PREPARACIÓN + INSPECCIÓN.
--   2. Realiza el recorrido documentado en docs/challenge-8.md.
--   3. Al terminar, selecciona y ejecuta únicamente LIMPIEZA.
--
-- La fecha demo es hoy del negocio + 45 días: siempre respeta los 3 días de
-- anticipación y la ventana de 60 días. El bloque se niega a tocarla si
-- encuentra reservas u overrides ajenos a este escenario.
--
-- No contiene tokens en claro ni secretos. La reserva semilla usa un hash
-- sintético que no corresponde a un enlace privado utilizable.

-- ============================================================================
-- PREPARACIÓN
-- ============================================================================
do $$
declare
  v_date date := public.agenda_business_today() + 45;
  v_demo_code constant text := 'FP-8-DEMO';
  v_demo_note constant text := 'DEMO RETO 8 — capacidad 3, semilla 2 puntos';
begin
  if exists (
    select 1
      from public.cake_reservations
     where celebration_date = v_date
       and code <> v_demo_code
  ) then
    raise exception
      '[demo Agenda] La fecha % contiene reservas ajenas al demo. No se modificó nada.',
      v_date;
  end if;

  if exists (
    select 1
      from public.production_day_overrides
     where business_date = v_date
       and internal_note is distinct from v_demo_note
  ) then
    raise exception
      '[demo Agenda] La fecha % contiene un override comercial. No se modificó nada.',
      v_date;
  end if;

  delete from public.cake_reservations where code = v_demo_code;

  insert into public.production_day_overrides (
    business_date, capacity_total, is_blocked, internal_note
  ) values (
    v_date, 3, false, v_demo_note
  )
  on conflict (business_date) do update
     set capacity_total = excluded.capacity_total,
         is_blocked = excluded.is_blocked,
         internal_note = excluded.internal_note;

  insert into public.cake_reservations (
    code,
    celebration_date,
    capacity_points,
    status,
    customer_name,
    customer_email,
    customer_phone,
    guest_count,
    flavor,
    theme,
    fulfillment_type,
    order_details,
    manage_token_hash
  ) values (
    v_demo_code,
    v_date,
    2,
    'confirmed',
    'DEMOSTRACIÓN RETO 8',
    'demo-agenda@example.invalid',
    '0000-0000000',
    20,
    'Chocolate (demo)',
    'Escenario último espacio',
    'pickup',
    '{"demo":true,"challenge":8,"purpose":"leave_exactly_one_capacity_point"}'::jsonb,
    repeat('d8', 32)
  );
end $$;

-- ============================================================================
-- INSPECCIÓN
-- Debe mostrar total=3, usado=2, restante=1 y can_accept=true para 1 punto.
-- ============================================================================
select
  a.business_date as fecha_demo,
  a.capacity_total as capacidad_total,
  a.capacity_used as capacidad_usada,
  a.capacity_remaining as capacidad_restante,
  a.can_accept as acepta_torta_sencilla
from public.get_production_availability(
  public.agenda_business_today() + 45,
  public.agenda_business_today() + 45,
  1
) a;

select
  r.code,
  r.celebration_date,
  r.capacity_points,
  r.status,
  r.customer_name
from public.cake_reservations r
where r.code = 'FP-8-DEMO';

-- ============================================================================
-- LIMPIEZA — NO se ejecuta automáticamente.
-- Selecciona desde "do $$" hasta "$$;" y ejecútalo al terminar la demo.
-- Solo elimina filas inequívocamente marcadas por este escenario.
-- ============================================================================
-- do $$
-- declare
--   v_date date := public.agenda_business_today() + 45;
-- begin
--   delete from public.cake_reservations
--    where code = 'FP-8-DEMO'
--      and customer_email = 'demo-agenda@example.invalid'
--      and coalesce((order_details->>'demo')::boolean, false);
--
--   delete from public.production_day_overrides
--    where business_date = v_date
--      and internal_note = 'DEMO RETO 8 — capacidad 3, semilla 2 puntos';
-- end $$;
