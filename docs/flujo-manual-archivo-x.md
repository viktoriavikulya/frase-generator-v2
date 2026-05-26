# Flujo Manual de Curaduría - Archivo X

## Cambios Principales

El proyecto ha sido migrado de un **flujo de clasificación automática** a un **flujo de curaduría 100% manual**.

### Antes (Deprecated)
- ❌ Clasificación automática con `scoreTweet()`
- ❌ Asignación automática de grupo, prioridad, calidad, riesgo
- ❌ Recomendaciones automáticas en `accion`
- ❌ Decisiones editoriales basadas en scoring

### Ahora (Nuevo)
- ✅ Importación de frases crudas sin clasificación
- ✅ Todas las frases comienzan como `decision_editorial = pendiente`
- ✅ **TÚ** decides manualmente:
  - ✅ Aprobar o descartar
  - ✅ Asignar grupo de carrusel
  - ✅ Editar texto final
  - ✅ Agregar notas
  - ✅ Marcar temporalidad

---

## Nueva Estructura de Columnas en `archivo_x`

### Columnas Principales (Nuevo Flujo Manual)
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | ID único | SHA1 hash de texto normalizado |
| `frase_original` | Texto | Frase cruda importada |
| `frase_final` | Texto (editable) | Texto final / reescritura manual |
| `decision_editorial` | Enum | `pendiente`, `aprobada`, `descartada` |
| `grupo_carrusel` | Enum | Uno de los 20 grupos de taxonomía |
| `notas` | Texto | Observaciones del curador |
| `temporalidad` | Enum | `atemporal`, `temporada`, `coyuntural`, `fecha_especial` |
| `temporada` | Texto | Ej: "San Valentín", "Navidad" |
| `capturado_en` | DateTime | Timestamp de importación |
| `actualizado_en` | DateTime | Última modificación |
| `lote_importacion` | ID | Batch de importación |
| `fuente` | Texto | Origen (ej: "tweets-guardados-x") |

### Columnas Legacy (Eliminadas del contrato)

Estas columnas **NO pertenecen al contrato `archivo_x`** y no deben existir en la hoja:

| Columna | Razón |
|---------|-------|
| `sirve` | ~~Recomendación automática~~ — eliminada |
| `estado` | ~~Estado editorial automático~~ — eliminada |
| `prioridad` | ~~Prioridad calculada~~ — eliminada |
| `accion` | ~~Acción sugerida~~ — eliminada |
| `recomendacion_auto` | ~~Recomendación automática~~ — eliminada |
| `calidad` | ~~Score de calidad~~ — eliminada |
| `riesgo` | ~~Score de riesgo~~ — eliminada |
| `subtema` | ~~Subtema clasificado~~ — eliminada |
| `clasificado_manual` | ~~Bandera de clasificación manual~~ — eliminada |
| `fila_txt` | ~~Índice legacy de archivo de texto~~ — eliminada |

**Si la pestaña `archivo_x` ya existe con estas columnas:**

> ⚠️ El importador (`import:saved-tweets`) y el servidor (`curate:archivo-x`) detectarán las columnas legacy al arrancar y emitirán un warning con la lista de columnas encontradas. No borrarán nada automáticamente.

**Opciones para limpiar:**

1. **Opción simple (recomendada):** Borrar la pestaña `archivo_x` completa en el Google Sheet y volver a ejecutar `npm run import:saved-tweets`. Las frases se reimportan con las 12 columnas limpias.

2. **Opción manual en el Sheet:** Seleccionar y eliminar manualmente las columnas legacy en Google Sheets, conservando solo las 12 columnas del contrato.

El importador y el servidor **nunca crean ni escriben** columnas legacy.

---

## Flujo de Trabajo

### 1. Importar Frases Crudas
```bash
npm run import:saved-tweets
```
**Qué hace:**
- Lee `data/tweets-guardados-x.txt`
- Normaliza y deduplica
- Crea IDs únicos
- Importa a `archivo_x` con:
  - `decision_editorial = "pendiente"`
  - `grupo_carrusel = ""` (vacío)
  - `frase_final = ""` (vacío)
  - Todos los campos de temporalidad/notas vacíos

**No hace:**
- ❌ Scoring automático
- ❌ Asignación automática de grupo
- ❌ Recomendaciones

### 2. Curar Frases Manualmente (Web/Móvil)
```bash
npm run curate:archivo-x
```
**URL:** `http://localhost:5177`

Interfaz de curador con:
- ✅ Visualización de frase original
- ✅ Campo editable para `frase_final`
- ✅ Selector de grupo (20 opciones de taxonomía)
- ✅ Botones: Aprobar / Descartar / Pendiente
- ✅ Campo de notas
- ✅ Selector de temporalidad
- ✅ Contador de avance

**Importante:**
- Cambiar `grupo_carrusel` **no aprueba automáticamente**.
- Editar `frase_final` o `notas` **no aprueba automáticamente**.
- Solo el botón **Aprobar** cambia `decision_editorial = aprobada`.
- El botón **Guardar y siguiente** guarda los campos editables y avanza a la siguiente frase visible sin modificar `decision_editorial`.
- `plan_carruseles` se genera **exclusivamente** desde frases con `decision_editorial = aprobada`.

### 3. Generar Plan de Carruseles
```bash
npm run build:carousel-plan
```
**Qué hace:**
- Lee **solo** frases con `decision_editorial = aprobada`
- Agrupa por `grupo_carrusel`
- Requiere mínimo 8 frases por grupo
- Para cada frase:
  - Usa `frase_final` si existe
  - Si no, usa `frase_original`
- Genera `output/carousel-plan.json`
- Escribe plan a Sheet `plan_carruseles`

**No hace:**
- ❌ Filtrar por scoring
- ❌ Calcular tiers automáticos
- ❌ Ignorar decisiones manuales

---

## Parámetros de Importación

### Variables de Entorno para `import:saved-tweets`

```env
# Fuente de entrada
SAVED_TWEETS_INPUT=data/tweets-guardados-x.txt
SAVED_TWEETS_ONE_PER_LINE=true              # Formato de entrada

# Pestaña destino
SAVED_TWEETS_WORKSHEET_NAME=archivo_x

# Limites
SAVED_TWEETS_IMPORT_LIMIT=0                 # 0 = sin límite

# Modo prueba
SAVED_TWEETS_DRY_RUN=false                  # true = sin escribir a Sheet
```

### Variables de Entorno para `curate:archivo-x`

```env
# Puerto del servidor
CURATOR_PORT=5177

# Seguridad (opcional)
CURATOR_TOKEN=tu-token-secreto             # Si se define, requiere autenticación

# Pestaña a curar
SAVED_TWEETS_WORKSHEET_NAME=archivo_x
```

**Protección:**
- Sin `CURATOR_TOKEN`: Modo desarrollo, acceso abierto
- Con `CURATOR_TOKEN`: Requiere enviar header `X-Curator-Token` o query param `token`

---

## Decisiones Editoriales

### Valores Válidos para `decision_editorial`

| Valor | Significado | Incluido en Carruseles |
|-------|------------|----------------------|
| `pendiente` | Aún no revisada | ❌ No |
| `aprobada` | Aprobada para usar | ✅ Sí |
| `descartada` | Rechazada / no sirve | ❌ No |

### Valores Válidos para `temporalidad`

| Valor | Significado |
|-------|------------|
| `atemporal` | Válida cualquier época |
| `temporada` | Válida en estación específica (temporal, verano, etc) |
| `coyuntural` | Válida solo en momento específico (evento, fecha clave) |
| `fecha_especial` | Reservada para fecha específica (San Valentín, Navidad, etc) |

---

## Grupos de Taxonomía

Los 20 grupos válidos para `grupo_carrusel`:

1. Amor romántico
2. Desamor y tusa
3. Ex y contacto cero
4. Coqueteo y deseo
5. Vínculos confusos
6. Sexo y cuerpo
7. Dinámica de pareja
8. Hombres y género
9. Actitud, autoestima y límites
10. Autorretrato y mood
11. Salud mental
12. Universidad y estudio
13. Plata, trabajo y vida adulta
14. Bogotá, Colombia y calle
15. Fiesta, alcohol y sustancias
16. Tecnología, IA y redes
17. Política, actualidad y cultura pop
18. Familia, amigos y hogar
19. Místico y destino
20. Humor cotidiano y absurdo

---

## Migración de Datos Legacy

Si tienes datos previos con la estructura automática, puedes hacer migración manual:

### Mapeo de `sirve` → `decision_editorial`
| sirve | → decision_editorial |
|-------|-----|
| `si`, `aprobada`, `aprobado` | `aprobada` |
| `no`, `rechazada`, `rechazado` | `descartada` |
| Cualquier otro valor | `pendiente` |

### Mapeo de `estado` → `decision_editorial`
| estado | → decision_editorial |
|--------|-----|
| `listo`, `done`, `approved` | `aprobada` |
| `descartada`, `rejected`, `no` | `descartada` |
| Cualquier otro valor | `pendiente` |

---

## Troubleshooting

### ¿Por qué el plan de carruseles está vacío?
1. ✅ Verifica que hay al menos 8 frases con `decision_editorial = aprobada`
2. ✅ Verifica que cada frase tiene `grupo_carrusel` asignado
3. ✅ Verifica que el grupo está en la lista de 20 grupos válidos

### ¿Cambié grupo pero no se aprobó?
✅ **Correcto.** Cambiar grupo no aprueba la frase. Debes hacer clic en "Aprobar".

### ¿Edité `frase_final` pero no se aprobó?
✅ **Correcto.** Editar el texto no aprueba. Debes hacer clic en "Aprobar".

### ¿Cómo restauro datos si me equivoco?
1. En el curador, cambia `decision_editorial` a `pendiente` haciendo clic en el botón **Pendiente**.
2. O usa las funciones de deshacer de Google Sheets.
3. Los datos no se eliminan, solo cambian de estado.

---

## Scripts Afectados

| Script | Cambio |
|--------|--------|
| `import-saved-tweets-to-sheet.js` | ✅ Reescrito - solo importa sin scoring |
| `build-carousel-plan.js` | ✅ Actualizado - lee `decision_editorial = aprobada` |
| `archive-curator-server.js` | ✅ Actualizado - endpoints para decisiones manuales |
| `curate-saved-tweets.js` | ⚠️ Deprecado - herramienta offline, no escribe al Sheet |
| `archivo-x-curator.html` | ✅ Actualizado - interfaz 100% manual, usa `decision_editorial` |

---

## Próximos Pasos

- [x] Actualizar interfaz `archivo-x-curator.html` ✅ completado
- [x] Tests con `npm run doctor` ✅ completado (60 OK, 0 FAIL)
- [ ] Migración de datos históricos (si aplica)
- [ ] Agregar protección robusta de `CURATOR_TOKEN` en producción
- [ ] Documentación de riesgos y límites

---

**Generado:** 26 de mayo de 2026
**Versión:** Flujo Manual 1.0