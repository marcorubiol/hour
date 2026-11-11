# Recuperar la contraseña: lo que pide el panel de Supabase

> Tarea 132 (2026-11-11). El código está en `routes/api/auth/recover`, `routes/api/auth/reset`,
> `$lib/server/session.ts` (`requestRecovery`, `verifyRecovery`, `updatePassword`) y el modo `recover` / `reset` de
> `routes/login`. Nunca se toca `auth.users` a mano: todo pasa por Supabase Auth.

## Cómo funciona

1. En `/login`, «¿Olvidaste la contraseña?» lleva a `/login?mode=recover`. El correo va a `POST /api/auth/recover`,
   que pide a Supabase `POST /auth/v1/recover` con `redirect_to=<origen>/login?mode=reset`. La respuesta es la misma
   haya o no cuenta con ese correo. Límite: 5 peticiones por IP cada 15 min y 3 correos por dirección cada hora.
2. Supabase manda el correo. Su enlace vuelve a `/login?mode=reset`, con una de dos formas:
   - **`?token_hash=…`** (plantilla de abajo, la recomendada): el token se canjea en el Worker al guardar la
     contraseña, no al abrir la página, así que un antivirus de correo que abre el enlace no lo gasta y ningún token
     pasa por JavaScript.
   - **`#access_token=…&refresh_token=…`** (plantilla por defecto de Supabase): la página lee el fragmento, lo borra
     de la barra y lo manda con la contraseña. Funciona sin tocar la plantilla.
3. `POST /api/auth/reset` pone la contraseña nueva (`PUT /auth/v1/user`) y deja la sesión en las cookies httpOnly,
   como el login. La persona entra en Hoy.

## Configuración en el panel (una vez, Marco)

Proyecto `hour-phase0`, Authentication:

1. **URL Configuration → Redirect URLs**: añadir `https://hour.zerosense.studio/login*` (y el origen de
   `workers.dev` si se usa). Sin esto Supabase ignora el `redirect_to` y manda el enlace a la *Site URL*.
   Comprobar también que la *Site URL* es `https://hour.zerosense.studio`.
2. **Email Templates → Reset Password** (recomendado): el enlace del cuerpo pasa a
   ```html
   <a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery">Poner una contraseña nueva</a>
   ```
   `RedirectTo` ya lleva `?mode=reset`, por eso el `&`. Asunto y texto, en castellano, a gusto.
3. Sin SMTP propio, Supabase manda pocos correos por hora en todo el proyecto (los de alta incluidos). Antes de la
   beta, SMTP propio (tarea 9, plan Pro).

## Probarlo en local

La Supabase local manda el correo a Mailpit (`http://127.0.0.1:54324`). Su `site_url` es `http://127.0.0.1:5173`
(`supabase/config.toml`): con `vite dev` en otro puerto el enlace cae ahí. Para probar el canje sin correo, la API
de admin genera un enlace (`POST /auth/v1/admin/generate_link` con `type: recovery`) y su `hashed_token` va en
`/login?mode=reset&token_hash=…`.

## Cómo se revierte

Quitar el enlace «¿Olvidaste la contraseña?» de `routes/login/+page.svelte` basta para que nadie llegue; los dos
endpoints pueden quedarse.
