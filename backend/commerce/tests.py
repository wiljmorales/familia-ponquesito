import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from tempfile import TemporaryDirectory
from unittest.mock import patch

import os
import time
from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.test import Client, TransactionTestCase, override_settings
from django.utils import timezone
from django.db import close_old_connections, connections
from django.core.files.uploadedfile import SimpleUploadedFile

from .models import AgentDecision, CakeDesign, CakeRequest, CakeReservation, EmailDispatch, Lead, LeadAutomationEvent, ProductionDayOverride, RecoveryThrottle, ReservationEvent, WeeklyReport
from .reservations import business_today


KEY = "synthetic-internal-key-only"


def post(operation, body, *, key=KEY):
    return Client().post(
        f"/api/v1/internal/{operation}/",
        data=json.dumps(body), content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {key}",
    ).json()


def reservation_payload(code, day, token="synthetic-token"):
    return {
        "celebration_date": day.isoformat(), "capacity_points": 1,
        "code": code, "manage_token_hash": hashlib.sha256(token.encode()).hexdigest(),
        "status": "pending_deposit", "customer_name": "Cliente sintético",
        "customer_email": "synthetic@example.invalid", "customer_phone": "+584120000000",
        "guest_count": 10, "flavor": "Chocolate", "fulfillment_type": "pickup",
        "order_details": {"test": True},
    }


@override_settings(INTERNAL_API_KEY=KEY)
class InternalApiTests(TransactionTestCase):
    reset_sequences = False

    def test_rejects_missing_or_wrong_machine_credential(self):
        url = "/api/v1/internal/agenda-availability/"
        self.assertEqual(Client().post(url, "{}", content_type="application/json").status_code, 401)
        self.assertEqual(Client().post(url, "{}", content_type="application/json", HTTP_AUTHORIZATION="Bearer wrong").status_code, 401)
        self.assertEqual(Client().get(url, HTTP_AUTHORIZATION=f"Bearer {KEY}").status_code, 405)

    def test_last_slot_is_atomic_with_real_postgres(self):
        day = business_today() + timedelta(days=45)
        ProductionDayOverride.objects.create(business_date=day, capacity_total=1)

        def run(index):
            close_old_connections()
            try:
                return post("agenda-reserve", reservation_payload(f"FP-8-TST{index}", day))
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(run, (1, 2)))
        self.assertEqual(sum(item["ok"] for item in outcomes), 1)
        self.assertEqual({item.get("error") for item in outcomes if not item["ok"]}, {"capacity_unavailable"})
        self.assertEqual(CakeReservation.objects.count(), 1)
        day_view = post("agenda-availability", {
            "start_date": day.isoformat(), "end_date": day.isoformat(), "capacity_points": 1,
        })
        self.assertEqual(day_view["days"][0]["capacity_remaining"], 0)

    def test_token_lookup_reschedule_cancel_and_invalid_token(self):
        first = business_today() + timedelta(days=30)
        second = first + timedelta(days=1)
        created = post("agenda-reserve", reservation_payload("FP-8-TST1", first))
        self.assertTrue(created["ok"])
        valid_hash = hashlib.sha256(b"synthetic-token").hexdigest()
        invalid_hash = hashlib.sha256(b"wrong-token").hexdigest()
        for code, token_hash in (("FP-8-NOPE", valid_hash), ("FP-8-TST1", invalid_hash)):
            self.assertEqual(post("agenda-lookup", {"code": code, "token_hash": token_hash}), {"ok": False, "error": "reservation_not_found"})
            self.assertEqual(post("agenda-cancel", {"code": code, "token_hash": token_hash}), {"ok": False, "error": "reservation_not_found"})
        lookup = post("agenda-lookup", {"code": "FP-8-TST1", "token_hash": valid_hash})
        self.assertTrue(lookup["reservation"]["can_reschedule"])
        self.assertNotIn("manage_token_hash", lookup["reservation"])
        changed = post("agenda-reschedule", {"code": "FP-8-TST1", "token_hash": valid_hash, "new_date": second.isoformat()})
        self.assertEqual(changed["new_date"], second.isoformat())
        cancelled = post("agenda-cancel", {"code": "FP-8-TST1", "token_hash": valid_hash})
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(post("agenda-cancel", {"code": "FP-8-TST1", "token_hash": valid_hash})["error"], "already_cancelled")

    def test_private_image_rejects_invalid_file_and_requires_valid_signature(self):
        with TemporaryDirectory() as image_root, override_settings(PRIVATE_IMAGE_ROOT=image_root):
            url = "/api/v1/internal/cake-request/"
            fields = {
                "customer_name": "Cliente sintético", "whatsapp": "+584120000000",
                "email": "synthetic@example.invalid", "celebration_date": (business_today() + timedelta(days=30)).isoformat(),
                "celebration_type": "cumpleanos", "guest_count": "10",
                "preferred_flavor": "chocolate", "cake_description": "Descripción sintética suficiente",
            }
            invalid = Client().post(url, {**fields, "reference_image": SimpleUploadedFile("bad.jpg", b"not-image", content_type="image/jpeg")}, HTTP_AUTHORIZATION=f"Bearer {KEY}")
            self.assertEqual(invalid.status_code, 400)
            self.assertEqual(CakeRequest.objects.count(), 0)
            valid = Client().post(url, {**fields, "reference_image": SimpleUploadedFile("good.png", b"\x89PNG\r\n\x1a\nsynthetic", content_type="image/png")}, HTTP_AUTHORIZATION=f"Bearer {KEY}")
            self.assertEqual(valid.status_code, 200)
            self.assertEqual(CakeRequest.objects.count(), 1)
            stored = valid.json()["reference_image_path"]
            self.assertNotIn("/", stored)
            with patch.dict("os.environ", {"PONQUESITO_API_PUBLIC_URL": "https://api.example.invalid"}):
                signed = post("image-link", {"path": stored})
            self.assertTrue(signed["ok"])
            self.assertEqual(Client().get(f"/api/v1/private-images/{valid.json()['id']}/").status_code, 404)
            self.assertEqual(Client().get(signed["url"].replace("https://api.example.invalid", "")).status_code, 200)

    def test_recovery_requires_recorded_email_and_rotates_only_when_used(self):
        day = business_today() + timedelta(days=30)
        self.assertTrue(post("agenda-reserve", reservation_payload("FP-8-TST2", day))["ok"])
        replacement = hashlib.sha256(b"new-synthetic-token").hexdigest()
        base = {"code": "FP-8-TST2", "new_token_hash": replacement, "remote_ip": "192.0.2.10"}
        wrong = post("agenda-recovery", {**base, "email": "other@example.invalid"})
        self.assertEqual(wrong, {"ok": True, "deliver": False})
        accepted = post("agenda-recovery", {**base, "email": "synthetic@example.invalid"})
        self.assertTrue(accepted["deliver"])
        self.assertEqual(accepted["recipient"], "synthetic@example.invalid")
        self.assertTrue(post("agenda-lookup", {"code": "FP-8-TST2", "token_hash": hashlib.sha256(b"synthetic-token").hexdigest()})["ok"])
        self.assertTrue(post("agenda-lookup", {"code": "FP-8-TST2", "token_hash": replacement})["ok"])
        self.assertEqual(post("agenda-lookup", {"code": "FP-8-TST2", "token_hash": hashlib.sha256(b"synthetic-token").hexdigest()})["error"], "reservation_not_found")
        self.assertFalse(post("agenda-recovery", {**base, "email": "synthetic@example.invalid"})["deliver"])
        self.assertEqual(CakeReservation.objects.count(), 1)

    def test_email_dispatch_claim_is_idempotent_and_no_real_mail_is_sent(self):
        lead = Lead.objects.create(
            source_type="cake_request", source_id="00000000-0000-4000-8000-000000000001",
            reference_code="FP-2-TST1", customer_name="Cliente sintético",
            customer_email="synthetic@example.invalid", customer_whatsapp="+584120000000",
            celebration_date=business_today() + timedelta(days=30), priority="normal",
            normalized_payload={"test": True},
        )
        payload = {"lead_id": str(lead.id), "event_type": "customer_email"}

        def claim(_):
            close_old_connections()
            try:
                return post("email-claim", payload)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(claim, (1, 2)))
        self.assertEqual({item["state"] for item in results}, {"claimed", "busy"})
        token = next(item["claim"] for item in results if item["state"] == "claimed")
        self.assertFalse(post("email-finish", {**payload, "claim": "wrong", "success": True})["ok"])
        self.assertTrue(post("email-finish", {**payload, "claim": token, "success": True, "provider_id": "local-test"})["ok"])
        self.assertEqual(post("email-claim", payload)["state"], "sent")
        self.assertEqual(LeadAutomationEvent.objects.filter(lead=lead, event_type="customer_email", status="success").count(), 1)

    def test_image_storage_failure_leaves_no_request_or_file(self):
        with TemporaryDirectory() as image_root, override_settings(PRIVATE_IMAGE_ROOT=image_root):
            fields = {
                "customer_name": "Cliente sintético", "whatsapp": "+584120000000",
                "email": "synthetic@example.invalid", "celebration_date": (business_today() + timedelta(days=30)).isoformat(),
                "celebration_type": "cumpleanos", "guest_count": "10",
                "preferred_flavor": "chocolate", "cake_description": "Descripción sintética suficiente",
                "reference_image": SimpleUploadedFile("valid.png", b"\x89PNG\r\n\x1a\nsynthetic", content_type="image/png"),
            }
            with patch("commerce.api.os.open", side_effect=OSError("simulated disk failure")):
                response = Client().post("/api/v1/internal/cake-request/", fields, HTTP_AUTHORIZATION=f"Bearer {KEY}")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["error"], "storage_unavailable")
            self.assertEqual(CakeRequest.objects.count(), 0)

    def test_design_catalog_is_revalidated_by_django(self):
        payload = {
            "design_code": "FP-3-TST1", "design": {
                "version": 1, "tiers": 1, "baseVariant": "invented",
                "standVariant": "stand-blush", "plaqueVariant": None,
                "message": "", "topperVariant": None,
            },
            "customer_name": "Cliente sintético", "whatsapp": "+584120000000",
            "email": "synthetic@example.invalid", "event_date": (business_today() + timedelta(days=30)).isoformat(),
            "guest_count": 10, "zone": "Centro",
        }
        self.assertFalse(post("cake-design", payload)["ok"])
        self.assertEqual(CakeDesign.objects.count(), 0)
        payload["design"]["baseVariant"] = "one-tier-cream"
        self.assertTrue(post("cake-design", payload)["ok"])
        self.assertEqual(CakeDesign.objects.count(), 1)

    def test_lead_idempotence_and_failed_email_retry(self):
        source = "00000000-0000-4000-8000-000000000009"
        payload = {
            "source_type": "cake_request", "source_id": source,
            "reference_code": "FP-2-TST9", "customer_name": "Cliente sintético",
            "customer_email": "synthetic@example.invalid", "customer_whatsapp": "+584120000000",
            "celebration_date": (business_today() + timedelta(days=30)).isoformat(),
            "priority": "normal", "normalized_payload": {"test": True},
        }
        first = post("lead-ensure", payload)
        self.assertFalse(post("lead-ensure", {**payload, "normalized_payload": {"manageUrl": "https://example.invalid/agenda/reservas/FP-8-TST1?token=private"}})["ok"])
        second = post("lead-ensure", payload)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(Lead.objects.count(), 1)
        self.assertEqual(LeadAutomationEvent.objects.filter(event_type="lead_registered").count(), 1)
        claim = post("email-claim", {"lead_id": first["id"], "event_type": "customer_email"})
        self.assertEqual(claim["state"], "claimed")
        self.assertTrue(post("email-finish", {"lead_id": first["id"], "event_type": "customer_email", "claim": claim["claim"], "success": False})["ok"])
        self.assertEqual(EmailDispatch.objects.get(lead_id=first["id"]).state, "failed")
        retry = post("email-claim", {"lead_id": first["id"], "event_type": "customer_email"})
        self.assertEqual(retry["state"], "claimed")
        self.assertNotEqual(retry["claim"], claim["claim"])
        self.assertTrue(post("email-finish", {"lead_id": first["id"], "event_type": "customer_email", "claim": retry["claim"], "success": True})["ok"])
        self.assertEqual(post("email-claim", {"lead_id": first["id"], "event_type": "customer_email"})["state"], "sent")

    def test_agent_and_weekly_report_contracts(self):
        agent = post("agent-create", {
            "source": "synthetic", "input_content": "Mensaje sintético", "intent": "general_question",
            "route": "knowledge_answer", "urgency": "normal", "confidence": 0.9,
            "requires_human": False, "reason": "prueba", "missing_fields": [],
            "recommended_action": "Responder", "guardrail_corrections": [],
            "decision_source": "fallback", "status": "processing",
        })
        self.assertTrue(agent["ok"])
        self.assertTrue(post("agent-update", {"id": agent["id"], "executed_action": "Respondido", "status": "completed"})["ok"])
        self.assertEqual(AgentDecision.objects.get(id=agent["id"]).status, "completed")
        start = (business_today() - timedelta(days=7)).isoformat()
        end = business_today().isoformat()
        report = post("report-reserve", {"period_start": start, "period_end": end, "trigger_type": "scheduled"})
        self.assertTrue(report["ok"])
        self.assertEqual(post("report-reserve", {"period_start": start, "period_end": end, "trigger_type": "scheduled"})["error"], "duplicate")
        self.assertTrue(post("report-update", {"id": report["id"], "status": "sent", "metrics": {"synthetic": 1}, "summary": "Resumen sintético"})["ok"])
        self.assertEqual(WeeklyReport.objects.get(id=report["id"]).status, "sent")
        listing = post("report-list", {})
        self.assertEqual(listing["latest"]["status"], "sent")
        self.assertEqual(len(listing["history"]), 1)

    def test_human_review_is_saved_on_a_full_day_without_taking_capacity(self):
        day = business_today() + timedelta(days=20)
        ProductionDayOverride.objects.create(business_date=day, capacity_total=1)
        self.assertTrue(post("agenda-reserve", reservation_payload("FP-8-HRA1", day))["ok"])
        self.assertEqual(post("agenda-reserve", reservation_payload("FP-8-HRA2", day))["error"], "capacity_unavailable")
        review = post("agenda-reserve", {**reservation_payload("FP-8-HRA3", day), "status": "human_review", "capacity_points": 3})
        self.assertTrue(review["ok"])
        self.assertEqual(review["capacity_remaining"], 0)
        self.assertEqual(review["capacity_used"], 1)
        day_view = post("agenda-availability", {"start_date": day.isoformat(), "end_date": day.isoformat(), "capacity_points": 1})
        self.assertEqual(day_view["days"][0]["capacity_used"], 1)
        self.assertEqual(post("agenda-reserve", {**reservation_payload("FP-8-HRA4", day), "status": "confirmed"})["error"], "invalid_status")

    def test_window_limits_and_arbitrary_image_paths_are_rejected(self):
        today = business_today()
        self.assertEqual(post("agenda-reserve", reservation_payload("FP-8-WIN1", today + timedelta(days=2)))["error"], "too_soon")
        self.assertEqual(post("agenda-reserve", reservation_payload("FP-8-WIN2", today + timedelta(days=61)))["error"], "out_of_window")
        self.assertTrue(post("agenda-reserve", reservation_payload("FP-8-WIN3", today + timedelta(days=60)))["ok"])
        for path in ("../backend.env", "/etc/passwd", "x" * 32 + ".jpg"):
            payload = {**reservation_payload("FP-8-WIN4", today + timedelta(days=10)), "reference_image_path": path}
            self.assertEqual(post("agenda-reserve", payload)["error"], "missing_data")

    def test_recovery_spacing_daily_limit_ip_limit_and_expiry(self):
        day = business_today() + timedelta(days=30)
        self.assertTrue(post("agenda-reserve", reservation_payload("FP-8-REC1", day))["ok"])
        hashes = [hashlib.sha256(f"recovery-{i}".encode()).hexdigest() for i in range(6)]
        base = {"code": "FP-8-REC1", "email": "SYNTHETIC@example.invalid", "remote_ip": "192.0.2.20"}
        self.assertTrue(post("agenda-recovery", {**base, "new_token_hash": hashes[0]})["deliver"])
        # Menos de 15 minutos después: respuesta genérica y el hash no cambia.
        self.assertFalse(post("agenda-recovery", {**base, "new_token_hash": hashes[1]})["deliver"])
        self.assertEqual(CakeReservation.objects.get(code="FP-8-REC1").recovery_token_hash, hashes[0])
        for index in (2, 3):
            CakeReservation.objects.filter(code="FP-8-REC1").update(recovery_requested_at=timezone.now() - timedelta(minutes=16))
            self.assertTrue(post("agenda-recovery", {**base, "new_token_hash": hashes[index]})["deliver"])
        CakeReservation.objects.filter(code="FP-8-REC1").update(recovery_requested_at=timezone.now() - timedelta(minutes=16))
        self.assertFalse(post("agenda-recovery", {**base, "new_token_hash": hashes[4]})["deliver"])  # 3 por día
        # Un enlace de recuperación caducado no autentica ni rota el token.
        CakeReservation.objects.filter(code="FP-8-REC1").update(recovery_expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(post("agenda-lookup", {"code": "FP-8-REC1", "token_hash": hashes[3]})["error"], "reservation_not_found")
        self.assertTrue(post("agenda-lookup", {"code": "FP-8-REC1", "token_hash": hashlib.sha256(b"synthetic-token").hexdigest()})["ok"])
        # Diez solicitudes por IP y hora, existan o no los códigos.
        RecoveryThrottle.objects.all().delete()
        other = {"code": "FP-8-NONE", "email": "nobody@example.invalid", "new_token_hash": hashes[5], "remote_ip": "192.0.2.30"}
        for _ in range(10):
            self.assertEqual(post("agenda-recovery", other), {"ok": True, "deliver": False})
        CakeReservation.objects.filter(code="FP-8-REC1").update(recovery_day=None, recovery_count=0, recovery_requested_at=None)
        self.assertFalse(post("agenda-recovery", {**base, "remote_ip": "192.0.2.30", "new_token_hash": hashes[5]})["deliver"])
        self.assertTrue(post("agenda-recovery", {**base, "remote_ip": "192.0.2.31", "new_token_hash": hashes[5]})["deliver"])

    def test_reservation_event_dedupe_is_idempotent(self):
        created = post("agenda-reserve", reservation_payload("FP-8-EVT1", business_today() + timedelta(days=30)))
        event = {"reservation_id": created["reservation_id"], "event_type": "email_sent", "dedupe_key": "customer_email_sent"}
        self.assertEqual(post("reservation-event", event), {"ok": True})
        self.assertEqual(post("reservation-event", event), {"ok": True, "already_recorded": True})
        self.assertEqual(ReservationEvent.objects.filter(dedupe_key="customer_email_sent").count(), 1)

    def test_orphan_image_cleanup_is_dry_run_by_default_and_keeps_referenced_files(self):
        with TemporaryDirectory() as image_root, override_settings(PRIVATE_IMAGE_ROOT=image_root):
            root = Path(image_root)
            old = time.time() - 48 * 3600
            referenced, orphan, recent, foreign = (
                root / ("a" * 32 + ".png"), root / ("b" * 32 + ".jpg"), root / ("c" * 32 + ".webp"), root / "notes.txt",
            )
            for item in (referenced, orphan, recent, foreign):
                item.write_bytes(b"synthetic")
            for item in (referenced, orphan, foreign):
                os.utime(item, (old, old))
            CakeRequest.objects.create(
                customer_name="Cliente sintético", whatsapp="+584120000000", email="synthetic@example.invalid",
                celebration_date=business_today() + timedelta(days=30), celebration_type="cumpleanos",
                guest_count=10, preferred_flavor="chocolate", cake_description="Descripción sintética suficiente",
                reference_image_path=referenced.name,
            )
            out = StringIO()
            call_command("cleanup_orphan_images", stdout=out)
            self.assertIn(": 1", out.getvalue())
            self.assertTrue(orphan.exists())
            call_command("cleanup_orphan_images", "--delete", stdout=StringIO())
            self.assertFalse(orphan.exists())
            self.assertTrue(referenced.exists() and recent.exists() and foreign.exists())
