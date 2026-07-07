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
| `tools/archivo-x-curator.html` | Fallback **activo en producción**: es lo que sirve `scripts/dev/archive-curator-server.js` (ruta catch-all) cuando se visita el servicio de Render (`archivo-x-curator.onrender.com`, definido en `render.yaml`) fuera de las rutas de API. `panel.html` usa esa misma URL como backend por defecto. | Todavía no. Moverlo requiere actualizar el `path.join(...)` en `archive-curator-server.js` y `REQUIRED_FILES` en `doctor.js` en el mismo cambio — no es un simple mover de archivo. |

## Archivos de compatibilidad que NO se deben mover todavía

Estos dos ya tienen un comentario HTML al inicio del propio archivo con la misma advertencia,
para que quede visible incluso si alguien abre el archivo sin pasar por este doc:

- **`publicar.html`** — redirect de compatibilidad hacia `panel.html#publish`, sin lógica propia.
  Se queda en la raíz por si hay links externos, bookmarks o accesos guardados apuntando a esta
  URL — algo que no se puede confirmar ni descartar solo auditando el repo. No mover sin antes
  confirmar eso.
- **`tools/archivo-x-curator.html`** — **no es HTML muerto**. Es el fallback que
  `scripts/dev/archive-curator-server.js` sirve (ruta catch-all) cuando no matchea ninguna ruta
  de `/api/*`, y ese servidor está desplegado en producción en Render (`render.yaml`, servicio
  `archivo-x-curator`) — la misma URL que `panel.html` usa por defecto como backend del curador.
  Es decir: reachable en producción, no solo un leftover local. No mover ni borrar sin actualizar
  en el mismo cambio `scripts/dev/archive-curator-server.js` (el `path.join(...)` del fallback),
  `scripts/dev/doctor.js` (`REQUIRED_FILES`) y las menciones en `README.md`/`CLAUDE.md`.

## Cómo servir cada cosa en local

`panel.html` es el panel principal — el resto (`index.html`, la API de Archivo X) existe para
que `panel.html` funcione. En local hacen falta **dos procesos**:

```bash
# Terminal 1 — API del curador (Archivo X)
npm run curate:archivo-x   # levanta SOLO la API + el fallback legacy, en http://localhost:5177

# Terminal 2 — el panel
npm run panel              # sirve panel.html e index.html en http://localhost:5173/panel.html
```

- `npm run curate:archivo-x` **no sirve el panel completo** — es un servidor de API (con
  credenciales de Google Sheets) que además sirve `tools/archivo-x-curator.html` como fallback.
  Mezclarlo con servir `panel.html` acoplaría un frontend público a un backend con credenciales.
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
