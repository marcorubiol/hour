# Fase 0 · Prueba técnica CalDAV (iCloud desde Cloudflare Workers)

Comprueba desde `workerd` (el runtime real de Cloudflare Workers, en local con `wrangler dev`) los dos riesgos abiertos antes de construir la Fase 2:

1. Si `fetch()` en Workers acepta los verbos `PROPFIND`, `MKCALENDAR` (o `MKCOL` extendido RFC 5689), `PUT`, `REPORT` y `DELETE` contra `caldav.icloud.com`.
   - **Verificado en `workerd` contra iCloud real (22-11-2026):** `workerd` rechaza `MKCALENDAR`, pero **iCloud acepta `MKCOL` extendido (RFC 5689, `201 Created`)** junto con `PROPFIND` (`207`), `PUT` con `TZID` + `VALARM` (`201`/`204`, `ETag` cambia), `REPORT sync-collection` (`207`) y `DELETE`.
2. Si iCloud devuelve/avanza `sync-token` en `REPORT sync-collection`: **sí** (`syncTokenPresent: true`, `syncTokenAdvanced: true`), con respaldo por comparación de `ETag` (`PROPFIND` Depth: 1) y `decodeURIComponent(href)` al emparejar.

La prueba crea un calendario temporal `Hour · prueba fase 0`, escribe un evento con `TZID=Europe/Madrid` y `VALARM` (`-PT2H`), actualiza su `SEQUENCE`, lee el delta y **borra tanto el evento como el calendario temporal** al terminar.

## 1. Verificar el runtime local (sin credenciales)

```bash
node scripts/caldav-probe/run.mjs --mock
```

## 2. Ejecutar contra tu cuenta real de iCloud

Genera una **contraseña de app** en `account.apple.com` y guárdala en **uno** de estos sitios (nunca en git ni en el chat):

### Opción A · Keychain de macOS (recomendada)

```bash
security add-generic-password -U -s hour-caldav-probe -a "tu@icloud.com" -w
ICLOUD_APPLE_ID="tu@icloud.com" node scripts/caldav-probe/run.mjs
```

### Opción B · Fichero `.env.icloud` (en `.gitignore`)

```dotenv
ICLOUD_APPLE_ID=tu@icloud.com
ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

```bash
node scripts/caldav-probe/run.mjs
```

## 3. Lista de verificación paralela de Fase 0 (fuera de código)

- **Apple OAuth piloto (iCloud):** enviar el formulario de interés del programa piloto con la cuenta del Apple Developer Program (no bloquea Fase 2).
- **Google Cloud Console (antes de Fase 5):** revisar en OAuth Consent Screen en qué categoría de verificación (Sensitive vs Restricted) caen:
  - `https://www.googleapis.com/auth/calendar.app.created`
  - `https://www.googleapis.com/auth/calendar.events.freebusy` / `calendar.freebusy`
  - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
