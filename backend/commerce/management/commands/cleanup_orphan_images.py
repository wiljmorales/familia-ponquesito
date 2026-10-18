"""Limpia imágenes privadas que ninguna fila referencia.

La API ya borra el archivo cuando falla el guardado de la solicitud; esto
cubre lo que queda si el proceso muere entre escribir el archivo y confirmar
la fila. Por defecto solo informa: borra únicamente con --delete.
"""

import time
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from commerce.api import valid_image_path
from commerce.models import CakeRequest, CakeReservation


class Command(BaseCommand):
    help = "Informa (o borra con --delete) imágenes privadas huérfanas y antiguas."

    def add_arguments(self, parser):
        parser.add_argument("--delete", action="store_true", help="Borra en vez de solo informar.")
        parser.add_argument(
            "--min-age-hours", type=int, default=24,
            help="Edad mínima del archivo (por defecto 24): nunca toca subidas en curso.",
        )

    def handle(self, *args, delete, min_age_hours, **options):
        if min_age_hours < 1:
            self.stderr.write("--min-age-hours debe ser al menos 1.")
            return
        root = Path(settings.PRIVATE_IMAGE_ROOT)
        if not root.is_dir():
            self.stdout.write("Sin directorio de imágenes: nada que revisar.")
            return
        referenced = set(
            CakeRequest.objects.exclude(reference_image_path=None).values_list("reference_image_path", flat=True)
        ) | set(
            CakeReservation.objects.exclude(reference_image_path=None).values_list("reference_image_path", flat=True)
        )
        cutoff = time.time() - min_age_hours * 3600
        orphans = [
            entry for entry in root.iterdir()
            # Solo nombres generados por la API; cualquier otro archivo se ignora.
            if valid_image_path(entry.name) and entry.is_file() and not entry.is_symlink()
            and entry.name not in referenced and entry.stat().st_mtime < cutoff
        ]
        if delete:
            for entry in orphans:
                entry.unlink(missing_ok=True)
            self.stdout.write(f"Imágenes huérfanas borradas: {len(orphans)}")
        else:
            self.stdout.write(f"Imágenes huérfanas (sin borrar; usa --delete): {len(orphans)}")
