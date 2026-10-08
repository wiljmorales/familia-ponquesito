# Página de enlaces (`/linktree`)

Página pública de enlaces de Familia Ponquesito, servida por Next.js en
`/linktree`. **La ruta es permanente:** está impresa en códigos QR. No se
renombra ni se redirige a otra.

- `public/linktree.html`: la página.
- `public/favicon.svg` y `public/assets/logo-familia-ponquesito.png`: sus
  recursos. La página los referencia con rutas relativas (`./favicon.svg`),
  que desde `/linktree` resuelven a la raíz.
- `next.config.ts`: reescribe `/linktree` a `/linktree.html`. `/linktree/`
  redirige con 308 a `/linktree` (comportamiento por defecto de Next.js),
  conservando los parámetros.
- `src/lib/linktree.test.ts`: comprueba la reescritura y el SHA-256 de los
  tres archivos.

`/` no es esta página: pertenece al landing de Next.js.

## Origen

Es una reconstrucción de la página publicada con ChatGPT Sites, capturada en
modo de solo lectura el 2026-10-08:

- `linktree.html` es el HTML que servía el sitio, **byte a byte**, quitando
  solo el script de desafío de bots que inyecta Cloudflare (no formaba parte
  del sitio). SHA-256 `08bc2086…b01ab70c`.
- `favicon.svg` (`70ee414e…`) y `logo-familia-ponquesito.png` (`09e6a7bf…`)
  son los recursos servidos, con el mismo SHA-256.
- Paridad visual comprobada al píxel con Chromium: 0 píxeles distintos en
  escritorio (1440×900) y en móvil (390×844 a 3x). Los tres enlaces
  coinciden en texto, URL, `target` y `rel`.

## Lo que no se conoce

- **No se tuvo acceso al proyecto en ChatGPT Sites.** No sabemos si tiene
  otras páginas, historial de versiones, fuentes distintas del HTML servido
  ni recursos originales (el logo en mayor resolución o vectorial).
- **Las rutas desconocidas del sitio original** (`/robots.txt`,
  `/sitemap.xml`, etc.) respondían 200 con la misma página, así que no
  revelan otras páginas.
- **Tipografías:** el CSS declara `Inter` y `Georgia`, pero no carga ninguna
  fuente web; el aspecto depende de las fuentes del dispositivo. Se conserva
  igual que en el original.

## Cambios

Cualquier cambio de enlaces, textos o datos del negocio debe venir del
negocio, no de suposiciones (ver `CLAUDE.md`). Si cambia el HTML o un
recurso, actualiza el SHA-256 en `src/lib/linktree.test.ts`.
