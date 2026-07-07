# Artefactos generados, exports y reglas de `.gitignore`

Qué carpetas/archivos son código real del proyecto y cuáles son generados, exportados o
credenciales locales — para no volver a ensuciar la raíz. Complementa a
[`docs/architecture/entrypoints.md`](../architecture/entrypoints.md) (qué es cada HTML) y
[`docs/operations/scripts.md`](scripts.md) (qué comando genera qué).

## Carpetas con artefactos generados/locales

| Carpeta | Contenido | Ignorada por `.gitignore` | Notas |
| --- | --- | --- | --- |
| `output/` | `carousel-plan.json` (generado por `npm run build:carousel-plan`), y cualquier PNG que genere `render-preview.js` / `render-all-retro-colors.js` / `debug-layout-tmp.js`. | Sí (`output/`) | Es el único destino correcto para renders/preview locales. Nunca guardar un PNG generado en `assets/`. |
| `data/exports/` | Exports/snapshots puntuales de las hojas de Google Sheets (`archivo_x`, Hoja 2) u otros CSV auxiliares. No los lee ningún script. | Sí, vía `*.csv` (excepto el `.csv` que ya estaba versionado antes de esa regla — ver más abajo) | Guardar acá cualquier CSV exportado a mano del Sheet. No es un insumo del pipeline. |
| `archive/repomix/` | Dumps de la herramienta [Repomix](https://github.com/yamadashy/repomix) (contexto del repo para pegarle a un LLM). No es código fuente. | Sí, vía la regla `repomix-output.xml` (por nombre exacto — ver propuesta pendiente en README de esta carpeta) | Si volvés a correr `npx repomix`, el archivo cae en la raíz por defecto (`repomix-output.xml`) — queda ignorado igual, pero conviene moverlo después a esta carpeta para no ensuciar la raíz visualmente. |
| `config/` | `service_account.json` — credencial real de la cuenta de servicio de Google. | Sí (`service_account.json`) | **Nunca commitear.** Solo debe existir en local y en el secret `SERVICE_ACCOUNT_JSON` de GitHub Actions/Render. |
| `node_modules/` | Dependencias instaladas por `npm ci`/`npm install`. | Sí (`node_modules/`) | Estándar, no requiere explicación. |

## Qué NO se debe versionar nunca

- `.env` — variables de entorno reales (tokens, `SHEET_ID`, credenciales de Cloudinary/Meta/Telegram).
- `config/service_account.json` — credencial de Google Sheets.
- Cualquier archivo que contenga un token, API key o secret, sin importar la carpeta.

## Qué exports pueden quedar en `data/exports/`

CSV o snapshots puntuales del Sheet, sacados manualmente para revisión o respaldo. No deben ser
insumo de ningún script — si un archivo en `data/exports/` empieza a ser leído por código, ya no
es un "export", es un insumo real y debería documentarse aparte (como `data/tweets-guardados-x.txt`,
que sí es insumo de `npm run import:saved-tweets` y por eso vive en `data/` directo, no en
`data/exports/`).

## Qué dumps van en `archive/repomix/`

Cualquier salida de la herramienta Repomix (`npx repomix@latest`, mencionado en
`docs/operations/orden-para-ejecucion.md`). Son solo para pegarle contexto del repo a un LLM —
nunca se leen desde código ni se commitean.

## Qué está ignorado por `.gitignore` (y por qué)

```gitignore
.env                        # credenciales
node_modules/                # dependencias instaladas
output/                      # renders y previews locales
config/service_account.json  # credencial de Google Sheets
service_account.json         # mismo archivo, por si se genera fuera de config/
repomix-output.xml           # dumps de Repomix, cualquier carpeta
*.csv                        # cualquier CSV, cualquier carpeta
data/*.txt                   # archivos .txt sueltos directo en data/ (no data/exports/, ver nota)
```

**Nota sobre `data/*.txt`:** este patrón no cubre `data/exports/*.txt` (los patrones de
`.gitignore` con `/` no cruzan subcarpetas con `*`). Hoy no hay ningún `.txt` en
`data/exports/`, así que no rompe nada, pero si algún día aparece uno ahí, revisar si hace falta
ampliar la regla.

**Nota sobre `.claude/`:** no aparece nunca en `git status` de este repo, pero **no es por una
regla de este `.gitignore`** — está cubierto por un gitignore global de usuario
(`~/.config/git/ignore` → `**/.claude/settings.local.json`) y por `.git/info/exclude` local
(`**/.claude/scheduled_tasks.lock`, entre otros). Es config de la herramienta Claude Code, no del
proyecto — no requiere ninguna entrada en el `.gitignore` versionado.

## Qué SÍ son assets reales (no confundir con outputs)

- `assets/*.otf`, `*.woff`, `*.ttf` — fuentes de marca reales, usadas por el render.
- `assets/marca.png`, `marca2.png`, `marca3.png` — logos reales.

Estos están trackeados en git a propósito. Un PNG generado por un render nunca debería terminar
en `assets/` — si aparece uno ahí, es una señal de que algo se guardó en el lugar equivocado.

## Excepción histórica: `data/exports/catalogador-frases - Hoja 2.csv`

Este archivo **sí está versionado en git**, a diferencia de su par
`catalogador-frases - archivo_x.csv`. Se commiteó en un commit único (`ee7d555 "asdfasdf"`)
antes de que existiera la regla `*.csv` en `.gitignore` — por eso el ignore no lo afecta
retroactivamente (`.gitignore` nunca "des-trackea" archivos ya versionados). Contiene un snapshot
real de la hoja principal del pipeline. No lo toqué en esta auditoría; si se quisiera dejar de
trackear del todo, la vía sería `git rm --cached` en una fase aparte, con confirmación explícita.

## Qué hacer si aparece un CSV o dump de Repomix nuevo en la raíz

1. No entrar en pánico — `*.csv` y `repomix-output.xml` ya están en `.gitignore`, así que **no
   se van a commitear por accidente** aunque queden sueltos en la raíz.
2. Igual, para mantener la raíz ordenada: mover el CSV a `data/exports/` y el dump de Repomix a
   `archive/repomix/` con un `mv` normal (no hace falta `git mv`, ninguno de los dos está
   trackeado, salvo que sea justo el caso especial de la sección anterior).
3. Correr `npm run doctor` después de mover cualquier cosa, aunque estos archivos en particular no
   están en ninguna validación de `doctor.js` (no son código).
