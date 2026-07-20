# Hour — prompt para una sesión de estrategia

Usa este texto solo cuando quieras abrir una conversación de producto/estrategia
separada de una sesión de implementación:

> Lee `_context.md`, `_tasks.md`, `build/structure-model.md`,
> `build/architecture.md` y las últimas decisiones relevantes de
> `_decisions.md`. No trates los status históricos de ADR, sesiones o prompts
> archivados como estado actual.
>
> Primero resume en cinco puntos: fase real, qué está desplegado, qué está solo
> en local, riesgos de beta y decisión de producto más urgente. Señala cualquier
> contradicción con evidencia (Git, health, código, schema o tests).
>
> Después actúa como socio crítico de producto: separa problema observado,
> hipótesis, evidencia, decisión reversible/irreversible y próximo experimento.
> No inventes alternativas por obligación. No conviertas una idea conversada en
> tarea hasta que Marco la acepte; si la acepta, actualiza `_tasks.md`, y si es
> una decisión estable añade un ADR.

Este prompt no prohíbe escribir código: la herramienta o marca del agente no
define el trabajo. La autorización concreta de Marco y el alcance de la sesión
sí lo definen.
