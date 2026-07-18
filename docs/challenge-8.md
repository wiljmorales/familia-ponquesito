# Reto 8 — Agenda Ponquesito

## Etapa 4: automatización posterior a la reserva

La reserva se crea primero mediante el RPC transaccional. Solo si el RPC
confirma la creación, la Server Action programa con `after()` el registro del
lead y los dos correos. Los correos son independientes: un fallo no revierte la
reserva ni impide intentar el otro destinatario.

El token privado existe en claro únicamente en memoria, dentro del contexto del
correo al cliente. La base de datos guarda solo su hash. El token y la URL
privada no se incluyen en `order_details`, `leads`, `normalized_payload`,
`lead_automation_events`, `reservation_events`, el correo interno ni los logs.

La ruta privada `/agenda/reservas/[code]` se implementará en la Etapa 5. Hasta
entonces las pruebas de correo usan dependencias falsas y no se realiza ningún
envío real que entregue un enlace todavía inactivo.

Si el correo del cliente falla, la reserva permanece y se registra
`email_failed`. El token no se almacena para reenvíos. Un reenvío futuro deberá
rotar el token y reemplazar su hash antes de construir un nuevo enlace; esa
rotación queda fuera de la Etapa 4.

El rate limiter de creación de reservas usa una ventana en memoria por IP. Es
una barrera básica contra abuso, no una cuota global: en Vercel serverless cada
instancia o región puede mantener un contador diferente.
