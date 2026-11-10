# Contrato de visualización de actividades

`buildActivityDisplayItems(records)` es puro y síncrono. Recibe únicamente coincidencias ya filtradas y autorizadas. No consulta Firebase, no muta sus entradas, no modifica `entry.records` y no sustituye la colección utilizada por gráficas, mapas, estadísticas o exportación.

```js
{
  key: 'payment:gestor_activities/root-id', // estable; también prospect:/activity:
  kind: 'payment' | 'prospect' | 'activity',
  record, // raíz visible o proyección prospecto consolidada; si falta raíz, hoja cargada
  relatedRecords, // etapas realmente cargadas, ordenadas cronológicamente, con id y _activity_path
  owner: { uid, name, email, role, plaza }, // creador original, nunca líder/gestor de última etapa
  hasEvidence, // true sólo por metadatos booleanos exactos de alguna etapa/raíz autorizada
  root_id, // ID final; usar root_path para evitar perder el contenedor histórico
  root_path, // gestor_activities/id o gestor_activities/contenedor/id
  latestMovementAt,
  loadedCount // no implica que se cargó toda la cadena
}
```

`record` mantiene estado/etapa y responsable más recientes del prospecto. Su autor escalar conserva la semántica histórica del CSV; la UI debe utilizar exclusivamente `owner` para plaza/autor/rol de la tarjeta. Cuando no existe identidad original verificable, `owner.name` es **Autor original no disponible** y no se inventan UID, correo o rol a partir del último seguimiento. `record.id` puede ser una hoja cuando la raíz está fuera de rango; `root_path` es la referencia explícita para abrir la raíz bajo demanda.

`relatedRecords` sólo contiene las etapas cargadas y coincidentes. La expansión de la bitácora debe ser local y decir “movimientos cargados”; no anuncia cobertura completa del expediente ni lee historia/medios. Los IDs y `_activity_path` de todas las etapas permanecen accesibles para botones de detalle/foto. `hasEvidence` incluye la bandera canónica verificada de la raíz aunque esté fuera de rango, sin insertar esa raíz como movimiento; la foto de una etapa debe comprobar su propio `tiene_evidencia === true`.

## Enlaces canónicos

La agrupación de pagos usa sólo `promesa_pago_id`, `recepcion_pago_id`, `comprobacion_id`, `comprobacion_digital_id`, `renuencia_pago_id`, `ultima_llamada_control_id` y `origen_pago_id`, verificados en `loadPaymentChain` y en la app operativa consultada en modo de lectura. Acepta promesa, recepción, comprobación, llamada de control y renuencia. No agrupa por persona, nombre, cliente, teléfono, número, plaza o `hilo_prospecto`.

`activityDisplayPaymentLinks(record)` es un extractor puro para el detalle bajo demanda. Devuelve IDs explícitos únicos relativos a `gestor_activities`, preservando contenedores históricos:

```js
// record._activity_path = 'gestor_activities/historico/promesa'
// record.recepcion_pago_id = 'recibo'
activityDisplayPaymentLinks(record); // ['historico/recibo']
// Para mantener la ruta al cargar: { id: link.split('/').pop(), _activity_path: `gestor_activities/${link}` }
```

El extractor no hace lecturas ni valida permisos por sí solo. El caller de detalle debe verificar el alcance canónico antes de descargar cada registro completo. Los vínculos de medios, perfiles o índices se rechazan. La solicitud explícita de detalle puede usar los loaders canónicos existentes; la renderización normal no los invoca.

## Hidratación dirigida y caché

`hydrateActivityDisplayMetadata(records, ensureActive)` se integra en el batch ligero **después** de filtrar las coincidencias y **antes** de consolidar prospectos. Una raíz visible no requiere lecturas adicionales. Si hay una referencia explícita a raíz ausente, se leen sólo sus hojas de identidad, discriminador mínimo, enlace hacia raíz y banderas de evidencia. Una comprobación puede resolver recepción → promesa por enlaces dirigidos; no enumera raíces ni busca etapas por plaza o persona.

`activityReadDisplayRootIdentity(path, ensureActive)` lee `plaza` primero. Si es gerente y la plaza canónica está fuera del alcance, retorna `null` sin consultar identidad/evidencia. Las hojas permitidas son `uid`, `user_uid`, `nombre_usuario`, `correo_usuario`, `rol`, `tipo`, `gestion_realizada`, `expediente_prospeccion_id`, `prospecto_raiz_id`, `seguimiento_de`, `es_expediente_prospeccion`, `promesa_pago_id`, `recepcion_pago_id`, `origen_pago_id`, `origen_pago_tipo`, `tiene_evidencia` y `has_evidence`. Nunca descarga raíz completa, historial, fotos, firma, GPS o medios. Reutiliza `activityBoundedRead` (máximo seis lecturas globales), `_activityMetadataCache`, contexto UID/email/rol/plaza, TTL existente de cinco minutos e `invalidateActivityQueryCache`.

Se añadieron a `ACTIVITY_LIGHT_FIELDS` y a `activityPreview` los siete vínculos de pago y `origen_pago_tipo`. `activityPreview` también conserva enlaces raíz de prospecto y `has_evidence` booleano; `activityAnalysisPreview` mantiene esos campos y no convierte strings o números en evidencia.

## Compatibilidad de prospectos y CSV

`consolidateProspectFiles` conserva `...root, ...latest`, columnas escalares y etapa actual para no modificar semántica de exportación/filtros/gráficas. Añade una proyección de pantalla no enumerable: `_display_owner`, `_display_related_records`, `_display_root_id`, `_display_root_path`, `_display_root_identity`, `_display_has_evidence`. `activityCopyDisplayMetadata` transporta estas propiedades explícitamente a través de ambos previews y de la normalización de prospectos. No aparecen en `Object.keys`, JSON ni nuevas columnas CSV. Reconsolidar tampoco sustituye la identidad original por el autor de la última etapa.

Los pagos se consolidan sólo al llamar al helper de pantalla; sus cinco registros siguen siendo cinco registros semánticos para el resto del panel. Las nuevas páginas vuelven a agrupar la colección cargada completa, de modo que las etapas de una misma cadena que cruzan el corte de 50 se fusionan sin duplicar tarjetas.

## Pruebas

`tests/activity-display-model.test.cjs` extrae los helpers verdaderos de `index.html` y usa únicamente fixtures/mocks de hojas sintéticas. Cubre enlaces forward/backward, comprobación digital, llamadas/renuencia, creador gerente original, raíz ausente, evidencia exacta, filtros previos, paginación 50+, rutas anidadas, reconsolidación, identidad fuera de rango, alcance gerente antes de identidad, contexto/TTL/invalidación y cancelación de sesión.

```bash
node --test tests/activity-display-model.test.cjs
TYPESCRIPT_PATH=/tmp/FredineroOperativo-fix169/node_modules/typescript node --test tests/*.test.cjs
node tests/check-inline-scripts.cjs
```
