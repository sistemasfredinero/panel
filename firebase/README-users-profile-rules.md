# Alta de perfiles desde Soporte y propuesta de reglas `users`

**Estado: formulario preparado; reglas NO DESPLEGADAS.** No se modificaron datos productivos, Authentication, reglas desplegadas, Functions ni plan de Firebase. Las pruebas de reglas se ejecutaron exclusivamente en un emulador local con datos sintéticos.

## Uso del formulario

Primero crea la cuenta en Firebase Console → Authentication. Copia su UID y correo de la misma cuenta. En el inicio del panel, con `soporte@fredinero.com`, abre **Alta de perfiles**. Captura UID, correo, nombre completo, apellido paterno, rol y clave de plaza; confirma la correspondencia manual, pulsa **Revisar datos** y después **Guardar perfil nuevo**.

El UID conserva sus mayúsculas. El correo se guarda en minúsculas y la plaza se normaliza a su clave en mayúsculas, por ejemplo `POZA`, no `Poza Rica`. El alta escribe únicamente `uid`, `correo`, `nombre_completo`, `apellido_paterno`, `rol`, `plaza` y `creado_en` en `users/{UID}`. El último campo representa la creación del perfil, no una fecha verificada de creación de Authentication.

Se admiten `GERENTE`, `LIDER A`, `LIDER B`, `LIDER C`, `CANJES`, `GESTOR`, `GESTOR DE COBRANZA` y `ADMINISTRATIVO`. Los privilegios especiales que dependen de correos concretos no se conceden por escribir un rol. No se ofrece el alias histórico `COBRANZA` para altas nuevas.

El formulario puede guardar una clave de plaza nueva, pero **no configura una sucursal completa**. También deben revisarse los catálogos `OPERATIONAL_PLAZAS`, `PANEL_PLAZAS`, `ANNUAL_FEEDBACK_PLAZAS`, centros de sucursal, filtros y responsables de sus flujos. La cobertura gerencial opcional `plazas_a_cargo` no se configura en este formulario básico.

## Conservación de datos

La creación usa una transacción exclusivamente sobre `users/{UID_NUEVO}`: devuelve el perfil sólo si el valor existente es `null`. Si hay cualquier contenido —incluidos sólo métricas, conexión, tokens o actividades históricas— aborta sin completar, reemplazar ni borrar nada. No hace `set(users)`, transacciones en todo `users` ni borrados previos.

La revisión consulta el UID indicado y un filtro de correo con límite de dos coincidencias. No descarga todo `users` ni expedientes. Los controles bloquean doble clic y cambios del formulario después de revisarlo. La revisión de correo ayuda a detectar duplicados, pero no es una garantía de unicidad global frente a altas simultáneas en UIDs distintos.

El SDK web no puede comprobar administrativamente que el UID de otra cuenta exista en Authentication ni que pertenezca al correo capturado. Esa correspondencia la confirma Soporte en Firebase Console. El formulario no crea cuentas, buzones, contraseñas, consentimientos ni avisos externos.

El botón y las funciones están limitados a la sesión de Soporte. **La protección efectiva frente a llamadas directas depende de las reglas desplegadas**, no de ocultar un botón. Un bloqueo temporal del navegador no constituye protección contra ataques distribuidos de solicitudes.

## Alcance de las reglas propuestas

`users-profile-rules.fragment.json` contiene únicamente el objeto que sustituiría `rules.users`. **No es un archivo completo de reglas ni una copia de datos.** No debe desplegarse como configuración completa de la base: faltan intencionalmente todas las demás ramas.

La autoridad se basa en `auth.uid === '__SUPPORT_AUTH_UID__'` y `auth.token.email === 'soporte@fredinero.com'` conjuntamente. El UID debe obtenerse de Authentication, no de un perfil editable en RTDB. El placeholder sigue sin configurar: reemplazarlo en una copia de revisión sólo cuando se confirme el UID real. No se exige `email_verified`, cuyo estado actual no está confirmado.

La propuesta elimina el permiso general de escritura en `users`, permite a Soporte administrar cada perfil y reserva al propietario las hojas técnicas auditadas de un perfil ya existente:

- `app_connection/version`, `version_code` y `last_connected_at`, escritas por `App.tsx`.
- `fcm_token` y `expo_push_token`, escritos mediante `update(users/{uid})` por `notifications.ts`.
- Las ocho hojas de `data_usage_metrics/{día}/{acción}` que escribe la app y el panel; permite la eliminación del día vencido de retención sin eliminar la ficha completa.

No exige reparar campos históricos para registrar telemetría. Un UID interno antiguo, campos ausentes o roles previos sin cambios no bloquean esas actualizaciones. Los datos anidados desconocidos permanecen almacenados y legibles según las reglas de lectura; no tienen permiso de escritura implícito para usuarios normales. No se garantiza compatibilidad con escritores históricos que no estén en los repositorios revisados.

`activity_summaries/users/{uid}` es otra rama: **no es `/users/{uid}`**. Las actividades canónicas, sus fichas ligeras, asistencia, solicitudes, viajes y la cola de sincronización no se modifican en este fragmento. Cambiar contraseña usa Authentication, no `users`.

Se conserva `.read: true` y los índices `correo`, `rol`, `plaza`, `uid` de las reglas versionadas para no cambiar el alcance de lecturas. **Advertencia: esto mantiene públicamente legibles los perfiles y tokens; no es una revisión integral de privacidad.** El flujo antiguo de recuperación de contraseña lee perfiles antes del inicio de sesión. Restringir esas lecturas requiere una revisión separada y autorización expresa.

## Excepción importante: autorregistro antiguo

`RegisterScreen.tsx` crea una cuenta en Authentication y después intenta guardar por sí mismo un perfil mínimo, sin rol/plaza. **Ese guardado quedaría bloqueado al aplicar estas reglas**, aunque la cuenta Auth ya pudiera haberse creado. El alta manual en Authentication seguida por Soporte sí es compatible.

Antes de un despliegue futuro hay que aceptar ese cambio o rediseñar el autorregistro. No se modificó esa pantalla ni se habilitó una excepción silenciosa. La alternativa de permitir un perfil inicial sin privilegios requiere una decisión y autorización aparte.

## Validación realizada

El formulario pasó **33 pruebas** con sus funciones reales y Firebase/DOM simulados; las **22 regresiones** de proyección de Prospección continuaron pasando. Las reglas pasaron **7 pruebas estructurales**. El conjunto predeterminado tiene un test adicional de emulador opcional omitido; no se presenta como prueba ejecutada.

Se ejecutó por separado `tests/users-profile-rules.emulator.cjs` contra Realtime Database Emulator **4.11.2**, en `127.0.0.1`, proyecto `demo-fredinero-users`: **13 casos reales aprobados**, incluido el análisis sintáctico del fragmento por Firebase. Se comprobaron alta por transacción, identidad exacta de Soporte, denegación de escalada y acceso ajeno, rechazo de perfiles incompletos, tokens y conexión propios, incrementos/retención de métricas, UID histórico discordante y conservación de datos anidados al abortar una creación sobre una ficha existente. Se corrigieron antes de esta validación cuatro expresiones regulares incompatibles con el dialecto del motor.

La sintaxis del script inline pasó `node --check`. El formulario se verificó a 360, 390, 768 y 1440 píxeles sin desbordamiento horizontal, sin campos de contraseña y con toda conexión externa bloqueada.

Para repetir las pruebas de unidad:

```sh
node --test tests/*.test.cjs
node tests/check-inline-scripts.cjs
```

La prueba real requiere un emulador local dedicado ya iniciado y dependencias de prueba `@firebase/rules-unit-testing` y `firebase`. No forman parte del panel ni se necesitan para usarlo. Apuntar `NODE_PATH` a su instalación separada:

```sh
NODE_PATH=/ruta/dependencias/node_modules \
FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
node tests/users-profile-rules.emulator.cjs
```

La prueba rechaza hosts no locales, sube reglas y limpia sólo la base demo local. No debe ejecutarse contra un emulador con datos importantes.

## Antes de cualquier aplicación futura

Exportar las reglas realmente desplegadas y compararlas con esta propuesta. No sustituirlas por las reglas completas versionadas de la app. Confirmar el UID de Soporte, conservar los índices adicionales si existen y revisar cualquier escritor legítimo fuera de los repositorios auditados.

En una copia de revisión, sustituir únicamente `rules.users`, sin duplicar claves ni conservar el antiguo permiso `users/.write: auth != null`. Revisar también los ancestros: si producción concede escritura en `/`, una regla descendiente no puede revocarla. En ese caso, detenerse; cambiar ese ancestro excedería el alcance autorizado.

Probar las reglas fusionadas y resolver la excepción de autorregistro antes de solicitar autorización independiente para desplegar. No se ha consultado ni modificado la base productiva para este trabajo.
