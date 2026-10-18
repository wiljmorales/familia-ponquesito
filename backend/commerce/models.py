"""Persistencia privada de los flujos existentes de Familia Ponquesito.

Las tablas no se exponen al navegador. Solo las operaciones cerradas de la API
interna pueden consultarlas, con un secreto distinto de la clave de Django.
"""

import uuid

from django.db import models
from django.db.models import Q
from django.utils import timezone


def uuid_key():
    return uuid.uuid4()


class Timestamped(models.Model):
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class CakeRequest(Timestamped):
    id = models.UUIDField(primary_key=True, default=uuid_key, editable=False)
    customer_name = models.TextField()
    whatsapp = models.TextField()
    email = models.TextField(null=True, blank=True)
    celebration_date = models.DateField()
    celebration_type = models.TextField()
    guest_count = models.PositiveIntegerField()
    preferred_flavor = models.TextField()
    cake_description = models.TextField()
    reference_image_path = models.TextField(null=True, blank=True)
    status = models.TextField(default="new")
    source = models.TextField(default="landing")

    class Meta:
        db_table = "cake_requests"
        constraints = [
            models.CheckConstraint(condition=Q(guest_count__gt=0), name="cake_requests_guest_positive"),
            models.CheckConstraint(
                condition=Q(status__in=["new", "contacted", "quoted", "confirmed", "cancelled", "completed"]),
                name="cake_requests_status_valid",
            ),
        ]


class CakeDesign(Timestamped):
    id = models.UUIDField(primary_key=True, default=uuid_key, editable=False)
    design_code = models.TextField(unique=True)
    design = models.JSONField()
    customer_name = models.TextField()
    whatsapp = models.TextField()
    email = models.TextField(null=True, blank=True)
    event_date = models.DateField()
    guest_count = models.PositiveIntegerField()
    zone = models.TextField()
    status = models.TextField(default="new")
    source = models.TextField(default="cake-builder")

    class Meta:
        db_table = "cake_designs"
        constraints = [
            models.CheckConstraint(condition=Q(guest_count__gt=0), name="cake_designs_guest_positive"),
            models.CheckConstraint(
                condition=Q(status__in=["new", "contacted", "quoted", "confirmed", "cancelled", "completed"]),
                name="cake_designs_status_valid",
            ),
        ]


class Lead(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid_key, editable=False)
    source_type = models.TextField()
    source_id = models.UUIDField()
    reference_code = models.TextField(unique=True)
    customer_name = models.TextField()
    customer_email = models.TextField()
    customer_whatsapp = models.TextField()
    celebration_date = models.DateField()
    priority = models.TextField()
    normalized_payload = models.JSONField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "leads"
        constraints = [
            models.UniqueConstraint(fields=["source_type", "source_id"], name="leads_source_unique"),
            models.CheckConstraint(
                condition=Q(source_type__in=["cake_request", "cake_design", "agent_message", "cake_reservation"]),
                name="leads_source_type_valid",
            ),
            models.CheckConstraint(
                condition=Q(priority__in=["not_viable", "urgent", "high", "normal"]),
                name="leads_priority_valid",
            ),
        ]


class LeadAutomationEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid_key, editable=False)
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, db_column="lead_id", related_name="events")
    event_type = models.TextField()
    status = models.TextField()
    error_message = models.TextField(null=True, blank=True)
    metadata = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "lead_automation_events"
        indexes = [models.Index(fields=["lead", "event_type", "status"], name="lead_event_status_idx")]
        constraints = [
            models.CheckConstraint(
                condition=Q(event_type__in=["lead_registered", "customer_email", "owner_email"]),
                name="lead_event_type_valid",
            ),
            models.CheckConstraint(condition=Q(status__in=["success", "error"]), name="lead_event_status_valid"),
        ]


class EmailDispatch(models.Model):
    """Reserva exclusiva por lead/destinatario antes de hablar con SMTP."""

    id = models.UUIDField(primary_key=True, default=uuid_key, editable=False)
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="dispatches")
    event_type = models.TextField()
    state = models.TextField(default="pending")
    claim_token = models.UUIDField(null=True, blank=True)
    lease_until = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "email_dispatches"
        constraints = [models.UniqueConstraint(fields=["lead", "event_type"], name="email_dispatch_unique")]


class ProductionDayOverride(Timestamped):
    id = models.UUIDField(primary_key=True, default=uuid_key, editable=False)
    business_date = models.DateField(unique=True)
    capacity_total = models.PositiveIntegerField(default=4)
    is_blocked = models.BooleanField(default=False)
    internal_note = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "production_day_overrides"


class CakeReservation(Timestamped):
    id = models.UUIDField(primary_key=True, default=uuid_key, editable=False)
    code = models.TextField(unique=True)
    celebration_date = models.DateField()
    capacity_points = models.PositiveSmallIntegerField()
    status = models.TextField(default="pending_deposit")
    customer_name = models.TextField()
    customer_email = models.TextField()
    customer_phone = models.TextField()
    guest_count = models.PositiveIntegerField()
    flavor = models.TextField()
    theme = models.TextField(null=True, blank=True)
    fulfillment_type = models.TextField()
    delivery_details = models.TextField(null=True, blank=True)
    reference_image_path = models.TextField(null=True, blank=True)
    order_details = models.JSONField()
    manage_token_hash = models.CharField(max_length=64)
    source = models.TextField(default="agenda")
    cancelled_at = models.DateTimeField(null=True, blank=True)
    recovery_token_hash = models.CharField(max_length=64, null=True, blank=True)
    recovery_expires_at = models.DateTimeField(null=True, blank=True)
    recovery_requested_at = models.DateTimeField(null=True, blank=True)
    recovery_day = models.DateField(null=True, blank=True)
    recovery_count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "cake_reservations"
        indexes = [models.Index(fields=["celebration_date", "status"], name="reservation_date_status_idx")]
        constraints = [
            models.CheckConstraint(condition=Q(capacity_points__in=[1, 2, 3]), name="reservation_points_valid"),
            models.CheckConstraint(condition=Q(guest_count__gt=0), name="reservation_guests_positive"),
            models.CheckConstraint(
                condition=Q(status__in=["pending_deposit", "confirmed", "human_review", "cancelled", "expired"]),
                name="reservation_status_valid",
            ),
            models.CheckConstraint(condition=Q(fulfillment_type__in=["pickup", "delivery"]), name="reservation_fulfillment_valid"),
            models.CheckConstraint(condition=~Q(code=""), name="reservation_code_present"),
            models.CheckConstraint(condition=~Q(customer_name=""), name="reservation_name_present"),
            models.CheckConstraint(condition=~Q(customer_email=""), name="reservation_email_present"),
            models.CheckConstraint(condition=~Q(customer_phone=""), name="reservation_phone_present"),
            models.CheckConstraint(condition=~Q(flavor=""), name="reservation_flavor_present"),
            models.CheckConstraint(condition=Q(fulfillment_type="pickup") | (Q(fulfillment_type="delivery") & Q(delivery_details__isnull=False) & ~Q(delivery_details="")), name="reservation_delivery_details"),
            models.CheckConstraint(condition=Q(manage_token_hash__regex=r"^[0-9a-f]{64}$"), name="reservation_token_sha256"),
            models.CheckConstraint(condition=Q(recovery_token_hash__isnull=True) | Q(recovery_token_hash__regex=r"^[0-9a-f]{64}$"), name="reservation_recovery_sha256"),
            models.CheckConstraint(
                condition=Q(status="cancelled", cancelled_at__isnull=False)
                | (~Q(status="cancelled") & Q(cancelled_at__isnull=True)),
                name="reservation_cancelled_at_coherent",
            ),
        ]


class ReservationEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid_key, editable=False)
    reservation = models.ForeignKey(CakeReservation, on_delete=models.CASCADE, db_column="reservation_id", related_name="events")
    event_type = models.TextField()
    metadata = models.JSONField(null=True, blank=True)
    dedupe_key = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "reservation_events"
        indexes = [models.Index(fields=["reservation", "event_type"], name="reservation_event_idx")]
        constraints = [
            models.UniqueConstraint(fields=["reservation", "dedupe_key"], condition=Q(dedupe_key__isnull=False), name="reservation_event_dedupe"),
            models.CheckConstraint(
                condition=Q(event_type__in=["created", "email_sent", "email_failed", "rescheduled", "cancelled", "expired", "lead_registered", "human_review_requested"]),
                name="reservation_event_type_valid",
            ),
        ]


class AgentDecision(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid_key, editable=False)
    source = models.TextField()
    source_record_id = models.TextField(null=True, blank=True)
    input_content = models.TextField()
    intent = models.TextField()
    route = models.TextField()
    urgency = models.TextField()
    confidence = models.DecimalField(max_digits=4, decimal_places=3)
    requires_human = models.BooleanField()
    reason = models.TextField()
    missing_fields = models.JSONField(default=list)
    detected_order_code = models.TextField(null=True, blank=True)
    recommended_action = models.TextField()
    executed_action = models.TextField(null=True, blank=True)
    guardrail_corrections = models.JSONField(default=list)
    decision_source = models.TextField()
    status = models.TextField(default="processing")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "agent_decisions"


class WeeklyReport(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid_key, editable=False)
    period_start = models.DateField()
    period_end = models.DateField()
    trigger_type = models.TextField()
    status = models.TextField(default="processing")
    metrics = models.JSONField(null=True, blank=True)
    summary = models.TextField(null=True, blank=True)
    summary_source = models.TextField(null=True, blank=True)
    recipient_masked = models.TextField(null=True, blank=True)
    error_message = models.TextField(null=True, blank=True)
    generated_at = models.DateTimeField(default=timezone.now)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "weekly_reports"
        constraints = [
            models.UniqueConstraint(fields=["period_start", "period_end"], condition=Q(trigger_type="scheduled"), name="weekly_scheduled_period_unique"),
            models.CheckConstraint(condition=Q(period_end__gte=models.F("period_start")), name="weekly_period_valid"),
        ]


class RecoveryThrottle(models.Model):
    """Conteo por IP ofuscada; no almacena IP, correo ni token en claro."""

    key_hash = models.CharField(max_length=64, primary_key=True)
    window_started_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "recovery_throttles"
