"""Autoridad transaccional de agenda, equivalente a las RPC existentes.

Ninguna función recibe puntos o estados desde un navegador: solo la API
autenticada de Next.js puede invocarlas, y aquí se revalidan de nuevo.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta
import hashlib
import hmac
import re
import secrets
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, connection, transaction
from django.db.models import Sum
from django.utils import timezone

from .models import CakeReservation, ProductionDayOverride, RecoveryThrottle, ReservationEvent


CARACAS = ZoneInfo("America/Caracas")
DEFAULT_CAPACITY = 4
MIN_LEAD_DAYS = 3
BOOKING_WINDOW_DAYS = 60
CONSUMING = ("pending_deposit", "confirmed")
MODIFIABLE = ("pending_deposit", "confirmed", "human_review")
IMAGE_NAME = re.compile(r"[0-9a-f]{32}\.(jpg|png|webp)")


def business_now():
    return timezone.now().astimezone(CARACAS).replace(tzinfo=None)


def business_today():
    return business_now().date()


def parse_date(value):
    try:
        return date.fromisoformat(value) if isinstance(value, str) else value if isinstance(value, date) else None
    except ValueError:
        return None


def failure(error):
    return {"ok": False, "error": error}


def date_error(day):
    today = business_today()
    if day < today + timedelta(days=MIN_LEAD_DAYS):
        return "too_soon"
    if day > today + timedelta(days=BOOKING_WINDOW_DAYS):
        return "out_of_window"
    return None


def lock_day(day):
    # La misma clave estable que la RPC original; bloqueo solo transaccional.
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", ["agenda:" + day.isoformat()])


def day_capacity(day):
    override = ProductionDayOverride.objects.filter(business_date=day).first()
    return (override.capacity_total, override.is_blocked) if override else (DEFAULT_CAPACITY, False)


def used_capacity(day):
    return CakeReservation.objects.filter(
        celebration_date=day, status__in=CONSUMING
    ).aggregate(points=Sum("capacity_points"))["points"] or 0


def availability(start, end, points):
    start, end = parse_date(start), parse_date(end)
    if points not in (1, 2, 3):
        return failure("invalid_points")
    if not start or not end or end < start or (end - start).days > 92:
        return failure("invalid_range")
    overrides = {o.business_date: o for o in ProductionDayOverride.objects.filter(business_date__range=(start, end))}
    used = defaultdict(int)
    for row in CakeReservation.objects.filter(
        celebration_date__range=(start, end), status__in=CONSUMING
    ).values("celebration_date").annotate(points=Sum("capacity_points")):
        used[row["celebration_date"]] = row["points"]
    today = business_today()
    rows = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        override = overrides.get(day)
        total = override.capacity_total if override else DEFAULT_CAPACITY
        blocked = override.is_blocked if override else False
        consumed = used[day]
        remaining = max(total - consumed, 0)
        rows.append({
            "business_date": day.isoformat(),
            "capacity_total": total,
            "capacity_used": consumed,
            "capacity_remaining": remaining,
            "is_blocked": blocked,
            "can_accept": not blocked and today + timedelta(days=MIN_LEAD_DAYS) <= day
            <= today + timedelta(days=BOOKING_WINDOW_DAYS) and total - consumed >= points,
        })
    return {"ok": True, "days": rows}


@transaction.atomic
def reserve(values):
    day = parse_date(values.get("celebration_date"))
    required = ("code", "manage_token_hash", "customer_name", "customer_email", "customer_phone", "flavor", "fulfillment_type", "order_details")
    if not day or any(not values.get(k) for k in required) or not isinstance(values.get("order_details"), dict):
        return failure("missing_data")
    if any(not isinstance(values[k], str) or not values[k].strip() for k in ("code", "customer_name", "customer_email", "customer_phone", "flavor")):
        return failure("missing_data")
    if any(len(values[k]) > 160 for k in ("code", "customer_name", "customer_email", "customer_phone", "flavor")):
        return failure("missing_data")
    try:
        validate_email(values["customer_email"])
    except ValidationError:
        return failure("missing_data")
    points = values.get("capacity_points")
    if points not in (1, 2, 3):
        return failure("invalid_points")
    status = values.get("status")
    if status not in ("pending_deposit", "human_review"):
        return failure("invalid_status")
    if len(values["manage_token_hash"]) != 64 or any(c not in "0123456789abcdef" for c in values["manage_token_hash"]):
        return failure("missing_data")
    if values.get("fulfillment_type") not in ("pickup", "delivery") or (values["fulfillment_type"] == "delivery" and (not isinstance(values.get("delivery_details"), str) or not values["delivery_details"].strip())):
        return failure("missing_data")
    if isinstance(values.get("guest_count"), bool) or not isinstance(values.get("guest_count"), int) or not 1 <= values["guest_count"] <= 500:
        return failure("missing_data")
    # La agenda no sube imágenes; si llega una ruta, solo el formato que
    # genera el almacenamiento privado (nunca una ruta arbitraria).
    image_path = values.get("reference_image_path")
    if image_path not in (None, "") and (not isinstance(image_path, str) or not IMAGE_NAME.fullmatch(image_path)):
        return failure("missing_data")
    invalid_date = date_error(day)
    if invalid_date:
        return failure(invalid_date)
    lock_day(day)
    total, blocked = day_capacity(day)
    if blocked:
        return failure("date_blocked")
    used = used_capacity(day)
    consuming = status in CONSUMING
    if consuming and used + points > total:
        return {"ok": False, "error": "capacity_unavailable", "capacity_remaining": max(total - used, 0)}
    try:
        with transaction.atomic():
            reservation = CakeReservation.objects.create(
                code=values["code"].strip(), celebration_date=day, capacity_points=points,
                status=status, customer_name=values["customer_name"].strip(),
                customer_email=values["customer_email"].strip(), customer_phone=values["customer_phone"].strip(),
                guest_count=values["guest_count"], flavor=values["flavor"].strip(),
                theme=values.get("theme") or None, fulfillment_type=values["fulfillment_type"],
                delivery_details=values.get("delivery_details") or None,
                reference_image_path=values.get("reference_image_path") or None,
                order_details=values["order_details"], manage_token_hash=values["manage_token_hash"],
            )
    except IntegrityError:
        return failure("code_taken")
    ReservationEvent.objects.create(reservation=reservation, event_type="created", metadata={"status": status, "capacity_points": points})
    if status == "human_review":
        ReservationEvent.objects.create(reservation=reservation, event_type="human_review_requested")
    new_used = used + points if consuming else used
    return {
        "ok": True, "reservation_id": str(reservation.id), "code": reservation.code,
        "status": status, "capacity_total": total, "capacity_used": new_used,
        "capacity_remaining": max(total - new_used, 0),
    }


def credential_reservation(code, token_hash, *, lock=False):
    if not isinstance(code, str) or not isinstance(token_hash, str) or len(token_hash) != 64 or any(c not in "0123456789abcdef" for c in token_hash):
        return None
    query = CakeReservation.objects
    if lock:
        query = query.select_for_update()
    reservation = query.filter(code=code).first()
    if not reservation:
        return None
    if secrets.compare_digest(reservation.manage_token_hash, token_hash):
        return reservation
    if (reservation.recovery_token_hash and reservation.recovery_expires_at
            and reservation.recovery_expires_at > timezone.now()
            and secrets.compare_digest(reservation.recovery_token_hash, token_hash)):
        # Un enlace de recuperación se vuelve el único válido al usarse.
        reservation.manage_token_hash = token_hash
        reservation.recovery_token_hash = None
        reservation.recovery_expires_at = None
        reservation.save(update_fields=["manage_token_hash", "recovery_token_hash", "recovery_expires_at", "updated_at"])
        return reservation
    return None


def public_reservation(reservation):
    can_modify = reservation.status in MODIFIABLE and business_now() < datetime.combine(
        reservation.celebration_date - timedelta(days=1), datetime.min.time()
    )
    reason = None if can_modify else (
        "status_not_modifiable" if reservation.status in ("cancelled", "expired") else "change_window_closed"
    )
    cancel_reason = (
        "already_cancelled" if reservation.status == "cancelled" else
        "status_not_cancellable" if reservation.status == "expired" else
        "cancellation_window_closed" if not can_modify else None
    )
    return {
        "code": reservation.code, "celebration_date": reservation.celebration_date.isoformat(),
        "status": reservation.status, "customer_name": reservation.customer_name,
        "guest_count": reservation.guest_count, "flavor": reservation.flavor,
        "theme": reservation.theme, "fulfillment_type": reservation.fulfillment_type,
        "delivery_details": reservation.delivery_details, "created_at": reservation.created_at.isoformat(),
        "capacity_points": reservation.capacity_points, "can_reschedule": can_modify,
        "can_cancel": can_modify, "reschedule_reason": reason, "cancellation_reason": cancel_reason,
    }


@transaction.atomic
def lookup(code, token_hash):
    reservation = credential_reservation(code, token_hash, lock=True)
    return {"ok": True, "reservation": public_reservation(reservation)} if reservation else failure("reservation_not_found")


@transaction.atomic
def request_recovery(code, email, new_token_hash, remote_ip):
    """Respuesta pública siempre genérica; el correo solo va al registrado.

    Diez peticiones por IP/hora y tres correos por reserva/día, separados 15
    minutos. No se guarda IP, email solicitante ni token en claro.
    """
    generic = {"ok": True, "deliver": False}
    if not isinstance(code, str) or not isinstance(email, str) or not isinstance(new_token_hash, str):
        return generic
    if len(new_token_hash) != 64 or any(c not in "0123456789abcdef" for c in new_token_hash):
        return generic
    ip = remote_ip if isinstance(remote_ip, str) else "unknown"
    key_hash = hmac.new(settings.SECRET_KEY.encode(), ip.encode(), hashlib.sha256).hexdigest()
    now = timezone.now()
    throttle, _ = RecoveryThrottle.objects.select_for_update().get_or_create(
        key_hash=key_hash, defaults={"window_started_at": now},
    )
    if throttle.window_started_at <= now - timedelta(hours=1):
        throttle.window_started_at, throttle.attempts = now, 0
    if throttle.attempts >= 10:
        return generic
    throttle.attempts += 1
    throttle.save(update_fields=["window_started_at", "attempts"])
    reservation = CakeReservation.objects.select_for_update().filter(code=code, customer_email__iexact=email.strip()).first()
    if not reservation:
        return generic
    today = business_today()
    if reservation.recovery_day != today:
        reservation.recovery_day, reservation.recovery_count = today, 0
    if reservation.recovery_count >= 3 or (reservation.recovery_requested_at and reservation.recovery_requested_at > now - timedelta(minutes=15)):
        return generic
    reservation.recovery_token_hash = new_token_hash
    reservation.recovery_expires_at = now + timedelta(hours=1)
    reservation.recovery_requested_at = now
    reservation.recovery_count += 1
    reservation.save(update_fields=["recovery_token_hash", "recovery_expires_at", "recovery_requested_at", "recovery_day", "recovery_count", "updated_at"])
    return {"ok": True, "deliver": True, "recipient": reservation.customer_email}


@transaction.atomic
def reschedule(code, token_hash, new_date):
    day = parse_date(new_date)
    if not day:
        return failure("missing_data")
    reservation = credential_reservation(code, token_hash, lock=True)
    if not reservation:
        return failure("reservation_not_found")
    if reservation.status not in MODIFIABLE:
        return failure("status_not_modifiable")
    if business_now() >= datetime.combine(reservation.celebration_date - timedelta(days=1), datetime.min.time()):
        return failure("change_window_closed")
    if day == reservation.celebration_date:
        return failure("same_date")
    invalid_date = date_error(day)
    if invalid_date:
        return failure(invalid_date)
    for locked_day in sorted((reservation.celebration_date, day)):
        lock_day(locked_day)
    total, blocked = day_capacity(day)
    if blocked:
        return failure("date_blocked")
    if reservation.status in CONSUMING and used_capacity(day) + reservation.capacity_points > total:
        return failure("capacity_unavailable")
    previous = reservation.celebration_date
    reservation.celebration_date = day
    reservation.save(update_fields=["celebration_date", "updated_at"])
    ReservationEvent.objects.create(reservation=reservation, event_type="rescheduled", metadata={"previous_date": previous.isoformat(), "new_date": day.isoformat()})
    return {"ok": True, "reservation_id": str(reservation.id), "code": code, "status": reservation.status, "previous_date": previous.isoformat(), "new_date": day.isoformat()}


@transaction.atomic
def cancel(code, token_hash):
    reservation = credential_reservation(code, token_hash, lock=True)
    if not reservation:
        return failure("reservation_not_found")
    if reservation.status == "cancelled":
        return failure("already_cancelled")
    if reservation.status not in MODIFIABLE:
        return failure("status_not_cancellable")
    if business_now() >= datetime.combine(reservation.celebration_date - timedelta(days=1), datetime.min.time()):
        return failure("cancellation_window_closed")
    prior_status = reservation.status
    reservation.status = "cancelled"
    reservation.cancelled_at = timezone.now()
    reservation.save(update_fields=["status", "cancelled_at", "updated_at"])
    ReservationEvent.objects.create(reservation=reservation, event_type="cancelled", metadata={"previous_status": prior_status})
    return {"ok": True, "reservation_id": str(reservation.id), "code": code, "status": "cancelled", "celebration_date": reservation.celebration_date.isoformat()}
