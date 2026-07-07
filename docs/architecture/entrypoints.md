# Entrypoints del proyecto

Mapa rápido de "qué es cada cosa" en la raíz del repo, para no perder el hilo cuando se
acumulan HTML y archivos sueltos. Complementa a [`docs/mapa-del-proyecto.md`](../mapa-del-proyecto.md)
(que explica el porqué y los riesgos); este documento solo responde "¿qué es este archivo y
lo puedo mover?".

## HTML

| Archivo | Rol | ¿Se puede mover? |
| --- | --- | --- |
| `panel.html` | Panel principal de trabajo diario (GitHub Pages). Publicar, curar frases, agregar frases, armar carruseles, preview. | No — es un entrypoint de GitHub Pages y lo exige `scripts/dev/doctor.js`. |
| `index.html` | Motor visual/render. Lo usa Playwright (`scripts/libs/render-lib.js`) para generar el PNG de producción, y `panel.html` lo carga en un `<iframe>` oculto para su preview (`postMessage` + `canvas.toDataURL()`). | No — `serve-static` lo sirve desde la raíz del repo y el iframe de `panel.html` depende de esa ruta. |
| `publicar.html` | Redirect de compatibilidad hacia `panel.html#publish` (meta refresh + `location.replace`). Sin lógica propia. | Todavía no. Pendiente confirmar que no haya enlaces externos (bio, bookmarks) apuntando a esta URL antes de moverlo. |
| `tools/archivo-x-curator.html` | Fallback **activo en producción**: es lo que sirve `scripts/dev/archive-curator-server.js` (ruta catch-all) cuando se visita el servicio de Render (`archivo-x-curator.onrender.com`, definido en `render.yaml`) fuera de las rutas de API. `panel.html` usa esa misma URL como backend por defecto. | Todavía no. Moverlo requiere actualizar el `path.join(...)` en `archive-curator-server.js` y `REQUIRED_FILES` en `doctor.js` en el mismo cambio — no es un simple mover de archivo. |

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
