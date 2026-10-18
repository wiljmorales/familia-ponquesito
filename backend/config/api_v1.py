"""Solo API de servicio y archivos privados; sin API de tablas para el navegador."""

from django.urls import path

from commerce.api import internal_api, private_image

urlpatterns = [
    path("internal/<slug:operation>/", internal_api, name="internal-api"),
    path("private-images/<uuid:request_id>/", private_image, name="private-image"),
]
