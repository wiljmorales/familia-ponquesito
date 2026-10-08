from django.urls import include, path

from config.views import health

# Mismo origen que Next.js: Caddy solo envía a Django /health/ y /api/v1/*.
# El resto de rutas, incluido el resto de /api/*, pertenece a Next.js.
urlpatterns = [
    path("health/", health, name="health"),
    path("api/v1/", include("config.api_v1")),
]
