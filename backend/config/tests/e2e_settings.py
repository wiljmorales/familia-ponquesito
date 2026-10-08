"""Ajustes para la prueba local de extremo a extremo detrás de Caddy.

Usa SQLite temporal y sesiones en cookie firmada: no toca PostgreSQL ni datos
reales. Solo para pruebas locales; no se usa en el VPS."""

import os

from config.settings import *  # noqa: F401,F403

ROOT_URLCONF = "config.tests.probe_urls"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": os.environ["E2E_SQLITE_PATH"]}}
SESSION_ENGINE = "django.contrib.sessions.backends.signed_cookies"
