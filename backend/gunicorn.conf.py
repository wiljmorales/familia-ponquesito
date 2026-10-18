# Configuración de Gunicorn para el VPS. Ver backend/README.md.

# Solo localhost: Caddy publica exclusivamente la API aprobada.
bind = "127.0.0.1:8000"

# 2 vCPU y 4 GB de RAM; sin preload para que un reload (HUP) cargue el código nuevo.
workers = 3
timeout = 30
graceful_timeout = 20

# stdout/stderr van a journald a través de systemd.
accesslog = "-"
# %(U)s omite el query string: contiene firmas de imágenes privadas.
access_log_format = '%(h)s %(t)s "%(m)s %(U)s %(H)s" %(s)s %(b)s'
errorlog = "-"
loglevel = "info"

# Socket de control (Gunicorn >= 25.1) desactivado: systemd gestiona el
# servicio con señales y el usuario de servicio no tiene $HOME donde crearlo.
control_socket_disable = True
