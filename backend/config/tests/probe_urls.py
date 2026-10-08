"""URLs solo para pruebas: ejercitan URLs, redirecciones y cookies dentro de
/api/v1/. No forman parte de config.urls ni se sirven en el VPS."""

from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import redirect
from django.urls import path, reverse

from config.urls import urlpatterns as app_urlpatterns


def probe_cookies(request):
    request.session["probe"] = True
    get_token(request)
    return JsonResponse(
        {
            "health": reverse("health"),
            "probe": reverse("probe-cookies"),
            "absolute": request.build_absolute_uri(reverse("health")),
            "secure": request.is_secure(),
            "path": request.path,
        }
    )


def probe_redirect(request):
    return redirect("probe-cookies")


urlpatterns = app_urlpatterns + [
    path("api/v1/probe/cookies/", probe_cookies, name="probe-cookies"),
    path("api/v1/probe/redirect/", probe_redirect, name="probe-redirect"),
]
