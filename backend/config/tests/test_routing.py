"""URLs, redirecciones y cookies de Django detrás de Caddy, en el mismo
origen que Next.js: Django solo atiende /health/ y /api/v1/*.

Simula lo que hace Caddy: Django recibe la ruta completa, sin recortes, con
X-Forwarded-Proto: https. No necesita base de datos."""

import json

from django.test import SimpleTestCase, override_settings
from django.urls import Resolver404, resolve

PROXY = {
    "SECURE_PROXY_SSL_HEADER": ("HTTP_X_FORWARDED_PROTO", "https"),
    "SESSION_COOKIE_SECURE": True,
    "CSRF_COOKIE_SECURE": True,
    "ALLOWED_HOSTS": ["staging.example.test"],
}
COMMON = {
    "ROOT_URLCONF": "config.tests.probe_urls",
    "SESSION_ENGINE": "django.contrib.sessions.backends.signed_cookies",
}
HTTPS = {"HTTP_HOST": "staging.example.test", "HTTP_X_FORWARDED_PROTO": "https"}


@override_settings(**COMMON, **PROXY)
class BehindProxyTests(SimpleTestCase):
    def test_reverse_and_absolute_urls(self):
        response = self.client.get("/api/v1/probe/cookies/", **HTTPS)
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertEqual(data["health"], "/health/")
        self.assertEqual(data["probe"], "/api/v1/probe/cookies/")
        self.assertEqual(data["path"], "/api/v1/probe/cookies/")
        self.assertEqual(data["absolute"], "https://staging.example.test/health/")
        self.assertTrue(data["secure"])

    def test_redirect_stays_in_api(self):
        response = self.client.get("/api/v1/probe/redirect/", **HTTPS)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/api/v1/probe/cookies/")

    def test_append_slash(self):
        for path in ("/api/v1/probe/redirect", "/health"):
            response = self.client.get(path, **HTTPS)
            self.assertEqual(response.status_code, 301, path)
            self.assertEqual(response["Location"], f"{path}/")

    def test_cookies_scoped_to_api_and_secure(self):
        response = self.client.get("/api/v1/probe/cookies/", **HTTPS)
        for name in ("sessionid", "csrftoken"):
            self.assertEqual(response.cookies[name]["path"], "/api/v1/", name)
            self.assertTrue(response.cookies[name]["secure"], name)
        self.assertTrue(response.cookies["sessionid"]["httponly"])

    def test_foreign_host_rejected(self):
        response = self.client.get(
            "/api/v1/probe/cookies/", HTTP_HOST="evil.example", HTTP_X_FORWARDED_PROTO="https"
        )
        self.assertEqual(response.status_code, 400)


@override_settings(**COMMON, ALLOWED_HOSTS=["127.0.0.1"])
class WithoutProxyTests(SimpleTestCase):
    """Acceso directo por túnel: sin HTTPS ni cookies Secure."""

    def test_urls_and_cookies_without_proxy(self):
        response = self.client.get("/api/v1/probe/cookies/", HTTP_HOST="127.0.0.1")
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertEqual(data["health"], "/health/")
        self.assertFalse(data["secure"])
        self.assertEqual(response.cookies["csrftoken"]["path"], "/api/v1/")
        self.assertFalse(response.cookies["csrftoken"]["secure"])


class RouteContractTests(SimpleTestCase):
    """config.urls real: Django solo es dueño de /health/ y /api/v1/*."""

    def test_django_only_owns_health_and_api_v1(self):
        self.assertEqual(resolve("/health/").url_name, "health")
        for path in ("/", "/linktree", "/agenda", "/api/assistant", "/api/agent", "/api/reports/weekly"):
            with self.assertRaises(Resolver404, msg=path):
                resolve(path)
