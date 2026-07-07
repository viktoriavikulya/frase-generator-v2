# Entrypoints del proyecto

Mapa rápido de "qué es cada cosa" en la raíz del repo, para no perder el hilo cuando se
acumulan HTML y archivos sueltos. Complementa a [`docs/architecture/mapa-del-proyecto.md`](mapa-del-proyecto.md)
(que explica el porqué y los riesgos); este documento solo responde "¿qué es este archivo y
lo puedo mover?".

## HTML

| Archivo | Rol | ¿Se puede mover? |
| --- | --- | --- |
| `panel.html` | **La única página HTML principal.** Panel de trabajo diario (GitHub Pages): publicar, curar frases, agregar frases, armar carruseles, preview. Además, con `?renderEngine=1` actúa como **motor de render**: lo usa Playwright (`scripts/libs/render-lib.js`) para el PNG de producción y su propio `<iframe>` oculto para el preview (`postMessage` + `canvas.toDataURL()`). La entrada oficial es `/panel.html` — la raíz pelada de GitHub Pages ya no se mantiene como entrada (da 404 desde C7B). | No — es el entrypoint de GitHub Pages, el motor de render, y lo exige `scripts/dev/doctor.js`. |

## HTML eliminados (histórico)

- **`index.html`** — **eliminado en la Fase C7B**. Era el motor visual/render original. En la
  Fase C7A el motor se migró a `panel.html?renderEngine=1` (mismo DOM mínimo, misma cadena de
  scripts `js/`, mismas fuentes), y en C7B se borró el archivo con `git rm`. `render-lib.js` y
  `debug-layout-tmp.js` ya navegan a `/panel.html?renderEngine=1&...` explícitamente y su
  `serveStatic` usa `index: false` — nada depende ya de un directory-index. Se aceptó
  explícitamente que la raíz pelada de GitHub Pages (`https://.../frase-generator-v2/`) dé 404;
  la entrada oficial es `/panel.html`. `scripts/dev/doctor.js` ya no lo exige en
  `REQUIRED_FILES`.

- **`publicar.html`** — **eliminado en la Fase C6**. Era un redirect de compatibilidad hacia
  `panel.html#publish`, sin lógica propia. La publicación vive enteramente en `panel.html#publish`
  ahora. Se aceptó explícitamente el riesgo de que links externos viejos a `publicar.html` den
  404 en GitHub Pages — no se mantiene compatibilidad con esa URL. `scripts/dev/doctor.js` ya no
  la exige en `REQUIRED_FILES`.
- **`tools/archivo-x-curator.html`** — **eliminado en la Fase C5**. Era la UI legacy de curaduría
  ("Curaduría" + "Publicar carruseles"); en la Fase C3 dejó de ser el fallback visible
  (`scripts/dev/archive-curator-server.js` empezó a redirigir en vez de servirlo), y en la Fase C5
  se borró del todo con `git rm`. A diferencia de `publicar.html`, acá **sí se conserva** la URL
  `/archivo-x-curator.html` como redirect (302) hacia `panel.html#curate` — igual que la raíz del
  servicio — porque ese backend está desplegado en Render y sigue siendo alcanzable en producción.
  `scripts/dev/doctor.js` ya no la exige en `REQUIRED_FILES`.

## Cómo servir cada cosa en local

`panel.html` es el panel principal — la API de Archivo X existe para que `panel.html` funcione.
En local hacen falta **dos procesos**:

```bash
# Terminal 1 — API del curador (Archivo X)
npm run curate:archivo-x   # levanta SOLO la API en http://localhost:5177

# Terminal 2 — el panel
npm run panel              # sirve panel.html en http://localhost:5173/panel.html
```

- `npm run curate:archivo-x` **no sirve el panel completo** — es un servidor de API (con
  credenciales de Google Sheets). Visitar su raíz (`/`) o `/archivo-x-curator.html` en el
  navegador redirige (302) a `panel.html#curate` en vez de mostrar una UI ahí. Mezclarlo con
  servir `panel.html` acoplaría un frontend público a un backend con credenciales.
- El motor de render/preview es el propio `panel.html` en modo `?renderEngine=1`: el panel lo
  carga en un `<iframe>` oculto, y ambos quedan en el mismo origen (`localhost:5173`) al
  levantarlos con `npm run panel`.
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
