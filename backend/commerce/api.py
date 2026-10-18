"""Operaciones cerradas de Next.js servidor -> Django.

No se aceptan cookies ni autenticación de navegador. La única credencial es
PONQUESITO_INTERNAL_API_KEY, verificada en cada POST. Nunca se registra el
header Authorization, payloads de clientes o tokens de gestión.
"""

import json
import os
import secrets
import uuid
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlencode

from django.conf import settings
from django.core import signing
from django.db import IntegrityError, transaction
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import FileResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from . import reservations
from .models import (
    AgentDecision, CakeDesign, CakeRequest, EmailDispatch, Lead, LeadAutomationEvent,
    ReservationEvent, WeeklyReport,
)

MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_TYPES = {
    "jpg": "image/jpeg", "png": "image/png", "webp": "image/webp",
}
DESIGN_BASES = {
    1: {"one-tier-cream", "one-tier-blush", "one-tier-yellow", "one-tier-lilac", "one-tier-chocolate"},
    2: {"two-tier-cream", "two-tier-cream-blush", "two-tier-cream-yellow"},
}
DESIGN_STANDS = {"stand-blush", "stand-white-gold"}
DESIGN_PLAQUES = {"plaque-blush-gold", "plaque-lilac-gold"}
DESIGN_TOPPERS = {"topper-happy-birthday-gold", "topper-feliz-cumpleanos-bow", "topper-happy-birthday-30", "topper-princess"}


def reply(data, status=200):
    response = JsonResponse(data, status=status)
    response["Cache-Control"] = "no-store"
    return response


def image_type(data):
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def store_image(upload):
    if not upload:
        return None
    if upload.size > MAX_IMAGE_BYTES:
        raise ValueError("image_too_large")
    content = upload.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise ValueError("image_too_large")
    extension = image_type(content)
    if not extension or upload.content_type != IMAGE_TYPES[extension]:
        raise ValueError("invalid_image")
    root = Path(settings.PRIVATE_IMAGE_ROOT)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{extension}"
    destination = root / name
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return name


def valid_image_path(path):
    if not isinstance(path, str) or len(path) != 36:
        return False
    stem, dot, ext = path.partition(".")
    return dot == "." and len(stem) == 32 and all(c in "0123456789abcdef" for c in stem) and ext in IMAGE_TYPES


def text_field(value, minimum=1, maximum=1000):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        raise ValueError("invalid_request")
    return value.strip()


def email_field(value):
    value = text_field(value, 3, 160)
    try:
        validate_email(value)
    except ValidationError as exc:
        raise ValueError("invalid_request") from exc
    return value


def date_field(value):
    try:
        parsed = date.fromisoformat(value)
    except (ValueError, TypeError):
        raise ValueError("invalid_request") from None
    if parsed < reservations.business_today() + timedelta(days=3):
        raise ValueError("invalid_request")
    return parsed


def guests_field(value):
    if isinstance(value, bool) or not str(value).isdigit() or not 1 <= int(value) <= 500:
        raise ValueError("invalid_request")
    return int(value)


def design_field(value):
    if not isinstance(value, dict) or value.get("version") != 1 or value.get("tiers") not in (1, 2):
        raise ValueError("invalid_request")
    if value.get("baseVariant") not in DESIGN_BASES[value["tiers"]] or value.get("standVariant") not in DESIGN_STANDS:
        raise ValueError("invalid_request")
    if value.get("plaqueVariant") not in DESIGN_PLAQUES | {None} or value.get("topperVariant") not in DESIGN_TOPPERS | {None}:
        raise ValueError("invalid_request")
    if not isinstance(value.get("message"), str) or len(value["message"]) > 40:
        raise ValueError("invalid_request")
    return value


def contains_private_context(value):
    forbidden = {"manageurl", "managetoken", "managetokenhash", "manage_token_hash", "token", "authorization", "password", "service_role_key"}
    if isinstance(value, dict):
        return any(str(key).lower() in forbidden or contains_private_context(child) for key, child in value.items())
    if isinstance(value, list):
        return any(contains_private_context(child) for child in value)
    return isinstance(value, str) and "/agenda/reservas/" in value and ("?token=" in value or "&token=" in value)


def create_request(request):
    path = None
    try:
        path = store_image(request.FILES.get("reference_image"))
        values = request.POST
        with transaction.atomic():
            item = CakeRequest.objects.create(
                customer_name=text_field(values["customer_name"], 2, 80),
                whatsapp=text_field(values["whatsapp"], 7, 20),
                email=email_field(values["email"]), celebration_date=date_field(values["celebration_date"]),
                celebration_type=text_field(values["celebration_type"], 2, 40), guest_count=guests_field(values["guest_count"]),
                preferred_flavor=text_field(values["preferred_flavor"], 2, 40),
                cake_description=text_field(values["cake_description"], 10, 1000),
                reference_image_path=path,
            )
        return reply({"ok": True, "id": str(item.id), "reference_image_path": path})
    except (KeyError, ValueError, IntegrityError) as exc:
        if path:
            (Path(settings.PRIVATE_IMAGE_ROOT) / path).unlink(missing_ok=True)
        return reply({"ok": False, "error": str(exc) if isinstance(exc, ValueError) and str(exc) in ("invalid_image", "image_too_large") else "invalid_request"}, 400)
    except Exception:
        if path:
            (Path(settings.PRIVATE_IMAGE_ROOT) / path).unlink(missing_ok=True)
        return reply({"ok": False, "error": "storage_unavailable"}, 503)


def create_design(values):
    try:
        with transaction.atomic():
            item = CakeDesign.objects.create(
                design_code=text_field(values["design_code"], 4, 40),
                design=design_field(values["design"]),
                customer_name=text_field(values["customer_name"], 2, 80),
                whatsapp=text_field(values["whatsapp"], 7, 20),
                email=email_field(values["email"]), event_date=date_field(values["event_date"]),
                guest_count=guests_field(values["guest_count"]), zone=text_field(values["zone"], 2, 120),
            )
        return reply({"ok": True, "id": str(item.id)})
    except IntegrityError:
        return reply({"ok": False, "error": "code_taken"}, 409)
    except (KeyError, ValueError, TypeError):
        return reply({"ok": False, "error": "invalid_request"}, 400)
def lead_ensure(values):
    try:
        if not isinstance(values.get("normalized_payload"), dict) or contains_private_context(values["normalized_payload"]):
            return reply({"ok": False, "error": "invalid_request"}, 400)
        with transaction.atomic():
            lead = Lead.objects.filter(source_type=values["source_type"], source_id=values["source_id"]).first()
            if not lead:
                lead = Lead.objects.create(**{key: values[key] for key in (
                    "source_type", "source_id", "reference_code", "customer_name", "customer_email",
                    "customer_whatsapp", "celebration_date", "priority", "normalized_payload",
                )})
                LeadAutomationEvent.objects.create(lead=lead, event_type="lead_registered", status="success")
        return reply({"ok": True, "id": str(lead.id), "reference_code": lead.reference_code, "priority": lead.priority})
    except IntegrityError:
        return reply({"ok": False, "error": "code_taken"}, 409)
    except (KeyError, ValueError, TypeError):
        return reply({"ok": False, "error": "invalid_request"}, 400)


def lead_event(values):
    try:
        lead = Lead.objects.get(id=values["lead_id"])
        kind, status = values["event_type"], values["status"]
        if kind not in ("customer_email", "owner_email") or status not in ("success", "error"):
            return reply({"ok": False, "error": "invalid_request"}, 400)
        if status == "success" and LeadAutomationEvent.objects.filter(lead=lead, event_type=kind, status="success").exists():
            return reply({"ok": True, "already_recorded": True})
        LeadAutomationEvent.objects.create(
            lead=lead, event_type=kind, status=status,
            error_message=values.get("error_message"), metadata=values.get("metadata"),
        )
        return reply({"ok": True})
    except (Lead.DoesNotExist, KeyError, ValueError):
        return reply({"ok": False, "error": "invalid_request"}, 400)


@transaction.atomic
def email_claim(values):
    kind = values.get("event_type")
    if kind not in ("customer_email", "owner_email"):
        return reply({"ok": False, "error": "invalid_request"}, 400)
    lead = Lead.objects.filter(id=values.get("lead_id")).first()
    if not lead:
        return reply({"ok": False, "error": "invalid_request"}, 400)
    dispatch, _ = EmailDispatch.objects.select_for_update().get_or_create(lead=lead, event_type=kind)
    now = timezone.now()
    if dispatch.state == "sent":
        return reply({"ok": True, "state": "sent"})
    if dispatch.state == "sending" and dispatch.lease_until and dispatch.lease_until > now:
        return reply({"ok": True, "state": "busy"})
    dispatch.state = "sending"
    dispatch.claim_token = uuid.uuid4()
    dispatch.lease_until = now + timedelta(minutes=5)
    dispatch.attempts += 1
    dispatch.save(update_fields=["state", "claim_token", "lease_until", "attempts", "updated_at"])
    return reply({"ok": True, "state": "claimed", "claim": str(dispatch.claim_token)})


@transaction.atomic
def email_finish(values):
    dispatch = EmailDispatch.objects.select_for_update().filter(
        lead_id=values.get("lead_id"), event_type=values.get("event_type")
    ).first()
    if not dispatch or dispatch.state != "sending" or str(dispatch.claim_token) != values.get("claim"):
        return reply({"ok": False, "error": "claim_invalid"}, 409)
    success = values.get("success") is True
    dispatch.state = "sent" if success else "failed"
    dispatch.claim_token = None
    dispatch.lease_until = None
    dispatch.save(update_fields=["state", "claim_token", "lease_until", "updated_at"])
    LeadAutomationEvent.objects.create(
        lead=dispatch.lead, event_type=dispatch.event_type,
        status="success" if success else "error",
        error_message=None if success else "smtp_failed",
        metadata={"providerId": str(values.get("provider_id"))[:120]} if success and values.get("provider_id") else None,
    )
    return reply({"ok": True})


def reservation_event(values):
    try:
        reservation = reservations.CakeReservation.objects.get(id=values["reservation_id"])
        kind = values["event_type"]
        if kind not in ("lead_registered", "email_sent", "email_failed"):
            return reply({"ok": False, "error": "invalid_request"}, 400)
        dedupe = values.get("dedupe_key")
        if dedupe and ReservationEvent.objects.filter(reservation=reservation, dedupe_key=dedupe).exists():
            return reply({"ok": True, "already_recorded": True})
        try:
            with transaction.atomic():
                ReservationEvent.objects.create(reservation=reservation, event_type=kind, dedupe_key=dedupe, metadata=values.get("metadata"))
        except IntegrityError:
            # Dos procesos registraron la misma clave a la vez: el índice
            # parcial conserva uno y el otro es un duplicado esperado.
            if dedupe:
                return reply({"ok": True, "already_recorded": True})
            raise
        return reply({"ok": True})
    except (reservations.CakeReservation.DoesNotExist, KeyError, ValueError):
        return reply({"ok": False, "error": "invalid_request"}, 400)


def image_link(values):
    path = values.get("path")
    if not valid_image_path(path):
        return reply({"ok": False, "error": "not_found"}, 404)
    item = CakeRequest.objects.filter(reference_image_path=path).only("id").first()
    if not item:
        return reply({"ok": False, "error": "not_found"}, 404)
    origin = os.environ.get("PONQUESITO_API_PUBLIC_URL", "").rstrip("/")
    if not origin.startswith("https://"):
        return reply({"ok": False, "error": "not_configured"}, 503)
    signature = signing.dumps({"id": str(item.id), "path": path}, salt="ponquesito-private-image")
    url = f"{origin}/api/v1/private-images/{item.id}/?{urlencode({'sig': signature})}"
    return reply({"ok": True, "url": url})


def report_operation(operation, values):
    if operation == "report-reserve":
        try:
            report = WeeklyReport.objects.create(
                period_start=values["period_start"], period_end=values["period_end"],
                trigger_type=values["trigger_type"],
            )
            return reply({"ok": True, "id": str(report.id)})
        except IntegrityError:
            return reply({"ok": False, "error": "duplicate"}, 409)
    if operation == "report-data":
        start, end = values["start_utc"], values["end_exclusive_utc"]
        leads = list(Lead.objects.filter(created_at__gte=start, created_at__lt=end).values("id", "source_type", "celebration_date", "priority", "created_at"))
        events = list(LeadAutomationEvent.objects.filter(created_at__gte=start, created_at__lt=end).values("lead_id", "event_type", "status", "created_at"))
        upcoming = Lead.objects.filter(celebration_date__gte=values["upcoming_from"], celebration_date__lte=values["upcoming_to"]).count()
        return reply({"ok": True, "leads_in_period": leads, "total_leads": Lead.objects.count(), "upcoming_celebrations": upcoming, "events_in_period": events})
    if operation == "report-update":
        allowed = ("metrics", "summary", "summary_source", "recipient_masked", "status", "sent_at", "error_message")
        report = WeeklyReport.objects.filter(id=values["id"]).first()
        if not report:
            return reply({"ok": False, "error": "not_found"}, 404)
        for key in allowed:
            if key in values:
                setattr(report, key, values[key])
        report.save(update_fields=[key for key in allowed if key in values])
        return reply({"ok": True})
    if operation == "report-list":
        fields = ("period_start", "period_end", "status", "trigger_type", "summary", "summary_source", "metrics", "generated_at")
        latest = WeeklyReport.objects.order_by("-generated_at").values(*fields).first()
        history = list(WeeklyReport.objects.order_by("-generated_at").values("period_start", "period_end", "trigger_type", "status", "generated_at")[:5])
        return reply({"ok": True, "latest": latest, "history": history})
    return reply({"ok": False, "error": "not_found"}, 404)


def agent_operation(operation, values):
    if operation == "agent-create":
        allowed = ("source", "source_record_id", "input_content", "intent", "route", "urgency", "confidence", "requires_human", "reason", "missing_fields", "detected_order_code", "recommended_action", "guardrail_corrections", "decision_source", "status")
        item = AgentDecision.objects.create(**{key: values[key] for key in allowed if key in values})
        return reply({"ok": True, "id": str(item.id)})
    if operation == "agent-update":
        item = AgentDecision.objects.filter(id=values["id"]).first()
        if not item:
            return reply({"ok": False, "error": "not_found"}, 404)
        item.executed_action, item.status = values["executed_action"], values["status"]
        item.save(update_fields=["executed_action", "status"])
        return reply({"ok": True})
    return reply({"ok": False, "error": "not_found"}, 404)


@csrf_exempt  # La API usa Bearer, no cookies; CSRF del navegador no autentica.
def internal_api(request, operation):
    if request.method != "POST":
        return reply({"ok": False, "error": "method_not_allowed"}, 405)
    key = settings.INTERNAL_API_KEY
    supplied = request.headers.get("Authorization", "")
    if not key:
        return reply({"ok": False, "error": "not_configured"}, 503)
    if not secrets.compare_digest(supplied, "Bearer " + key):
        return reply({"ok": False, "error": "unauthorized"}, 401)
    if operation == "cake-request":
        return create_request(request)
    try:
        values = json.loads(request.body)
        if not isinstance(values, dict):
            raise ValueError("object_required")
    except (json.JSONDecodeError, ValueError):
        return reply({"ok": False, "error": "invalid_request"}, 400)
    try:
        return dispatch(operation, values)
    except (KeyError, TypeError, ValueError, ValidationError, IntegrityError):
        return reply({"ok": False, "error": "invalid_request"}, 400)


def dispatch(operation, values):
    if operation == "cake-design":
        return create_design(values)
    if operation == "agenda-availability":
        return reply(reservations.availability(values.get("start_date"), values.get("end_date"), values.get("capacity_points")))
    if operation == "agenda-reserve":
        return reply(reservations.reserve(values))
    if operation == "agenda-lookup":
        return reply(reservations.lookup(values.get("code"), values.get("token_hash")))
    if operation == "agenda-reschedule":
        return reply(reservations.reschedule(values.get("code"), values.get("token_hash"), values.get("new_date")))
    if operation == "agenda-cancel":
        return reply(reservations.cancel(values.get("code"), values.get("token_hash")))
    if operation == "agenda-recovery":
        return reply(reservations.request_recovery(
            values.get("code"), values.get("email"), values.get("new_token_hash"), values.get("remote_ip"),
        ))
    if operation == "lead-ensure":
        return lead_ensure(values)
    if operation == "lead-event":
        return lead_event(values)
    if operation == "email-claim":
        return email_claim(values)
    if operation == "email-finish":
        return email_finish(values)
    if operation == "lead-success":
        exists = LeadAutomationEvent.objects.filter(lead_id=values.get("lead_id"), event_type=values.get("event_type"), status="success").exists()
        return reply({"ok": True, "exists": exists})
    if operation == "lead-by-source":
        lead = Lead.objects.filter(source_type=values.get("source_type"), source_id=values.get("source_id")).values("id", "reference_code", "priority").first()
        return reply({"ok": True, "lead": lead})
    if operation == "reservation-event":
        return reservation_event(values)
    if operation == "image-link":
        return image_link(values)
    if operation.startswith("report-"):
        return report_operation(operation, values)
    if operation.startswith("agent-"):
        return agent_operation(operation, values)
    return reply({"ok": False, "error": "not_found"}, 404)


def private_image(request, request_id):
    if request.method != "GET":
        return reply({"ok": False, "error": "method_not_allowed"}, 405)
    try:
        signed = signing.loads(request.GET.get("sig", ""), salt="ponquesito-private-image", max_age=3600)
    except signing.BadSignature:
        return reply({"ok": False, "error": "not_found"}, 404)
    if signed.get("id") != str(request_id) or not valid_image_path(signed.get("path")):
        return reply({"ok": False, "error": "not_found"}, 404)
    if not CakeRequest.objects.filter(id=request_id, reference_image_path=signed["path"]).exists():
        return reply({"ok": False, "error": "not_found"}, 404)
    path = Path(settings.PRIVATE_IMAGE_ROOT) / signed["path"]
    try:
        stream = path.open("rb")
    except OSError:
        return reply({"ok": False, "error": "not_found"}, 404)
    response = FileResponse(stream, content_type=IMAGE_TYPES[path.suffix[1:]])
    response["Cache-Control"] = "private, no-store"
    response["Referrer-Policy"] = "no-referrer"
    response["X-Content-Type-Options"] = "nosniff"
    return response
