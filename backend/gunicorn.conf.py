# Configuración de Gunicorn para el VPS. Ver backend/README.md.

# Solo localhost: el backend aún no se publica (sin proxy, HTTPS ni DNS).
bind = "127.0.0.1:8000"

# 2 vCPU y 4 GB de RAM; sin preload para que un reload (HUP) cargue el código nuevo.
workers = 3
timeout = 30
graceful_timeout = 20

# stdout/stderr van a journald a través de systemd.
accesslog = "-"
errorlog = "-"
loglevel = "info"

# Socket de control (Gunicorn >= 25.1) desactivado: systemd gestiona el
# servicio con señales y el usuario de servicio no tiene $HOME donde crearlo.
control_socket_disable = True
