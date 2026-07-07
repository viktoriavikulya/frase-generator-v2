# Entrypoints del proyecto

Mapa rápido de "qué es cada cosa" en la raíz del repo, para no perder el hilo cuando se
acumulan HTML y archivos sueltos. Complementa a [`docs/architecture/mapa-del-proyecto.md`](mapa-del-proyecto.md)
(que explica el porqué y los riesgos); este documento solo responde "¿qué es este archivo y
lo puedo mover?".

## HTML

| Archivo | Rol | ¿Se puede mover? |
| --- | --- | --- |
| `panel.html` | Panel principal de trabajo diario (GitHub Pages). Publicar, curar frases, agregar frases, armar carruseles, preview. | No — es un entrypoint de GitHub Pages y lo exige `scripts/dev/doctor.js`. |
| `index.html` | Motor visual/render. Lo usa Playwright (`scripts/libs/render-lib.js`) para generar el PNG de producción, y `panel.html` lo carga en un `<iframe>` oculto para su preview (`postMessage` + `canvas.toDataURL()`). | No — `serve-static` lo sirve desde la raíz del repo y el iframe de `panel.html` depende de esa ruta. |
| `publicar.html` | Redirect de compatibilidad hacia `panel.html#publish` (meta refresh + `location.replace`). Sin lógica propia. | Todavía no. Pendiente confirmar que no haya enlaces externos (bio, bookmarks) apuntando a esta URL antes de moverlo. |

## Archivos de compatibilidad que NO se deben mover todavía

Este ya tiene un comentario HTML al inicio del propio archivo con la misma advertencia,
para que quede visible incluso si alguien abre el archivo sin pasar por este doc:

- **`publicar.html`** — redirect de compatibilidad hacia `panel.html#publish`, sin lógica propia.
  Se queda en la raíz por si hay links externos, bookmarks o accesos guardados apuntando a esta
  URL — algo que no se puede confirmar ni descartar solo auditando el repo. No mover sin antes
  confirmar eso.

## `tools/archivo-x-curator.html` — eliminado en la Fase C5

Este archivo **ya no existe físicamente en el repo**. Era la UI legacy de curaduría
("Curaduría" + "Publicar carruseles"); en la Fase C3 dejó de ser el fallback visible
(`scripts/dev/archive-curator-server.js` empezó a redirigir en vez de servirlo), y en la Fase C5
se borró del todo con `git rm`. La URL `/archivo-x-curator.html` **se conserva** como redirect
(302) hacia `panel.html#curate` — igual que la raíz del servicio — así que ningún link viejo
queda roto, solo redirige en vez de mostrar la UI vieja. `scripts/dev/doctor.js` ya no la exige
en `REQUIRED_FILES`.

## Cómo servir cada cosa en local

`panel.html` es el panel principal — el resto (`index.html`, la API de Archivo X) existe para
que `panel.html` funcione. En local hacen falta **dos procesos**:

```bash
# Terminal 1 — API del curador (Archivo X)
npm run curate:archivo-x   # levanta SOLO la API en http://localhost:5177

# Terminal 2 — el panel
npm run panel              # sirve panel.html e index.html en http://localhost:5173/panel.html
```

- `npm run curate:archivo-x` **no sirve el panel completo** — es un servidor de API (con
  credenciales de Google Sheets). Visitar su raíz (`/`) o `/archivo-x-curator.html` en el
  navegador redirige (302) a `panel.html#curate` en vez de mostrar una UI ahí. Mezclarlo con
  servir `panel.html` acoplaría un frontend público a un backend con credenciales.
- `index.html` sigue siendo el motor de render/preview: `panel.html` lo carga en un `<iframe>`
  oculto, y ambos quedan en el mismo origen (`localhost:5173`) al levantarlos con `npm run panel`.
- **No abrir `panel.html` con doble clic ni `file://`** — el navegador manda `Origin: null`, que
  no pasa el CORS de `archive-curator-server.js`, y las llamadas a la API fallan con
  "Failed to fetch".

## Datos y artefactos

| Ruta | Contenido | Notas |
| --- | --- | --- |
| `data/exports/` | Exports/snapshots de las hojas de Google Sheets (`archivo_x`, Hoja 2) y CSV auxiliares similares. No son insumos que lea ningún script — son backups puntuales. | `catalogador-frases - Hoja 2.csv` está versionado en git (movido con `git mv`, conserva historial). `catalogador-frases - archivo_x.csv` está cubierto por `.gitignore` (`*.csv`) y no se fuerza su tracking. |
| `archive/repomix/` | Dumps generados por la herramienta [Repomix](https://github.com/yamadashy/repomix) para darle contexto del repo a un LLM. No es código fuente ni se usa en ningún script. | Cubierto por `.gitignore` (`repomix-output.xml`); si vuelves a correr `repomix`, recuerda apuntar la salida a esta carpeta o moverla después. |
| `data/tweets-guardados-x.txt` | Insumo real de `npm run import:saved-tweets`. | Este sí es un archivo vivo del pipeline — no confundir con `data/exports/`. |

## Regla general

Ningún archivo listado como "No" o "Todavía no" se mueve sin antes revisar referencias con
`rg` y actualizar en el mismo cambio: `scripts/dev/doctor.js` (`REQUIRED_FILES`), cualquier
`path.join(ROOT, ...)` en código, y las menciones en `README.md` / `CLAUDE.md`.
