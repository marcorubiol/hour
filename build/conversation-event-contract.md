# `conversation_event` — contrato de integración

Estado: **contrato fijado; tabla, API y timeline todavía no construidos**.

Este documento cierra el sobre común para una futura llamada, reunión, nota,
email o mensaje sin adelantar la UI ni escoger todavía el proveedor de correo o
WhatsApp. Es el límite entre Conversations v1.5 y el log de conversación de S2.

## Invariantes

- Cada evento pertenece a un `workspace_id` y a un `conversation_id` del mismo
  workspace. El servidor deriva el workspace desde la conversación; nunca
  confía en un `workspace_id` enviado por el cliente.
- El registro es append-only para clientes normales. Una corrección añade otro
  evento; una redacción por privacidad conserva la envolvente y elimina el
  contenido mediante un camino administrativo auditado.
- `occurred_at` dice cuándo ocurrió la interacción; `recorded_at` dice cuándo
  llegó a Hour. No se sustituye uno por el otro.
- La procedencia externa es idempotente: cuando existe `external_ref`, el par
  `(workspace_id, source, external_ref)` es único.
- Solo los eventos que representan contacto real actualizan
  `conversation.last_contacted_at`; `first_contacted_at` se fija una vez. Una
  nota interna sin dirección no finge que se habló con nadie.
- RLS hereda la frontera de la conversación: `read:conversation` para leer y
  `edit:conversation` para capturar. Un conector escribe mediante RPC confiable,
  no saltándose el modelo de permisos.

## Sobre canónico

| Campo | Contrato |
|---|---|
| `id` | UUID v7, generado por Hour. |
| `workspace_id` | UUID derivado de `conversation`. |
| `conversation_id` | UUID obligatorio. |
| `occurred_at` | `timestamptz` obligatorio. |
| `recorded_at` | `timestamptz`, default `now()`. |
| `kind` | `note \| call \| email \| meeting \| message`. |
| `source` | `manual \| email \| whatsapp \| import \| integration`. |
| `direction` | `inbound \| outbound \| null`; null solo cuando no aplica. |
| `body` | Texto nullable; no guarda HTML remoto sin sanear. |
| `participants` | JSON estructurado con persona local opcional, nombre, dirección y rol; conserva participantes aún no resueltos sin crear personas globales. |
| `provenance` | JSON estructurado para feria/evento, captura y confianza; no es una etiqueta libre de CRM. |
| `external_ref` | Identificador estable nullable para idempotencia. |
| `original_url` | Enlace nullable al original autorizado; nunca token o secreto. |
| `metadata` | JSON acotado al adaptador; no duplica campos canónicos. |
| `created_by` | `auth.users.id` nullable para entradas confiables de sistema. |

## Regla de contacto

Marcan contacto `call`, `email`, `meeting` y `message`. Una `note` solo lo marca
si lleva dirección porque representa una interacción registrada, no una nota
privada. Al insertar uno de esos eventos, la misma transacción actualiza el
último contacto y rellena el primero únicamente si estaba vacío.

## Fuera de este bloque

- Tabla/migración, endpoints y timeline en la ficha de conversación.
- Vincular ferias como entidad, búsqueda por procedencia o cola post-feria.
- Ingesta de email o WhatsApp y resolución automática de participantes.
- Edición, adjuntos, threading y entrega de mensajes.

Cuando S2 construya el log, debe materializar este contrato o registrar una
decisión explícita que lo cambie. Conversations v1.5 solo consume los sellos
`first_contacted_at` / `last_contacted_at` ya existentes.
