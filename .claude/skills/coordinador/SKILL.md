---
name: coordinador
description: Método de coordinación para proyectos largos con varias sesiones de Claude en paralelo (coordinador, carriles, estado en ficheros, latido). Úsalo cuando el AGENTS.md o CLAUDE.md del proyecto diga «coordinación: skill coordinador», o cuando Marco te abra como «coordinador» o pregunte «¿cómo vamos?».
---

# Coordinador

Método sacado de Zerø Lingua (AGENTS.md, «Coordinación», 03/04-10). Es genérico: lo propio de cada proyecto
(congelación, pesos, versiones, entornos) vive en su AGENTS.md/CLAUDE.md, no aquí. Sólo vale la pena con **varios
carriles en paralelo y semanas de vida**; en un proyecto pequeño sobra.

## Ficha del proyecto (la rellena su AGENTS.md/CLAUDE.md)
Antes de actuar, el proyecto debe decir: dónde vive el estado (`<carpeta>/coordination/`), máximo de carriles, entornos
que se bloquean, dónde está el diario de uso (si lo hay), y si el repo es público (entonces el estado NO va en git).
Si falta algo, pregúntaselo al coordinador; no lo inventes.

## Reparto de papeles
- **Marco habla sólo con el coordinador.** Éste reparte, integra y empuja. Los demás son carriles: un carril, un chat.
- **Un carril no fusiona en la rama principal, no empuja y no pregunta a Marco.** Reporta al coordinador (sha,
  balance, lo probado y lo que no) y le pasa las dudas. Excepción: permisos sobre la infraestructura de Marco.
- Dos carriles que tocan el mismo fichero van uno detrás de otro. Máximo de carriles a la vez: el que diga el proyecto.
- El encargo de un carril es completo: quién lo pidió, ficheros, lo que no se toca, pruebas y a quién reporta.

## El estado vive en ficheros, no en el chat
- `STATUS.md` (lo lleva el coordinador): rama principal y último push, carriles vivos, cola, preguntas pendientes de
  Marco, candados.
- `<rama con - en vez de />.md` (lo lleva cada carril): encargo, hecho, siguiente paso. Se actualiza en cada commit.
- Nombres de fichero en inglés; contenido en el idioma del proyecto.
- **Relevo:** si una sesión se llena o se cae, la siguiente lee su fichero y sigue.
- Una vista de estado para Marco (artifact, página) es sólo una copia generada de STATUS.md, nunca otra fuente.

## Si te abren como coordinador
Lo eres si Marco te abre en el checkout principal sin un encargo de carril («coordinador», «¿cómo vamos?»).
1. Lee STATUS.md, los ficheros de carril y `git worktree list`; mira qué sesiones siguen vivas.
2. Si otra sesión ya coordina, no tomes el puesto: díselo a Marco.
3. Avisa a las sesiones vivas de que eres el coordinador nuevo.
4. Dale a Marco el estado en pocas líneas: integrado, en marcha, y lo que necesitas de él.
5. Sigue la cola: integra lo listo, abre carriles, y llena cada hueco con lo siguiente sin preguntar.
6. Actualiza STATUS.md cada vez que cambie algo.

## Latido
Al tomar el puesto, programa una revisión cada 30 minutos en minutos que no sean :00 ni :30. En cada vuelta mira, de
cada carril vivo: último commit, lo no commiteado, sus candados y si su sesión sigue viva. Si lleva más de 60 minutos
sin commit ni mensaje, escríbele para que diga dónde está. Comprueba también que STATUS.md se tocó en la última hora.
A Marco sólo se le escribe si tiene algo que decidir o hacer. El latido se pierde al cerrar la sesión y caduca a los
7 días: quien tome el puesto lo programa de nuevo.

## Diario de uso (si el proyecto lo tiene)
En cada latido, lee las notas nuevas. Escribe en cada una un `tipo` (bug, interfaz, más adelante, hecho) y una
`respuesta` de una línea, y llévala al TODO o a un carril. Lo roto o confuso es un bug.

## Alcance
La lista de una versión se cierra una vez. Lo nuevo nace en el TODO con su versión puesta, por defecto la siguiente.
