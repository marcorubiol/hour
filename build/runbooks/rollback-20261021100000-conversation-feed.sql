-- Rollback de 20261021100000_conversation_feed (ADR-138, fase 3 de etiquetas).
-- Desplegar antes el Worker que no lee `conversation_feed` (el de la fase 2:
-- «Todas» en dos bloques sobre `/api/conversations` y `thread_feed`).
-- Aditiva: solo una función de lectura. No se pierde ningún dato.
-- Probado ida y vuelta en local el 2026-10-21 (migración, rollback, migración,
-- dentro de una transacción con ROLLBACK).
--
-- Coste medido en local el 2026-10-21 (Supabase local, 2.178 conversaciones con
-- dos eventos y su hilo, 3.000 bolos con seis hilos cada uno: 20.000 hilos y
-- 60.000 mensajes), una página de 100:
--   thread_feed (la base, regla en cada hilo)      ~6.400 ms
--   conversation_feed, Todas, el owner             ~140 ms (500 filas: ~390 ms)
--   conversation_feed, una etiqueta                ~65 ms
--   conversation_feed, Equipo                      ~120 ms
--   conversation_feed, buscando                    60 a 120 ms
--   conversation_feed, la limitada (lee poco)      ~660 ms
-- La regla corre fila a fila en el orden de la página y para al llenarla: el
-- peor caso es un miembro que no lee casi nada de un espacio enorme, que la
-- evalúa en todas las candidatas (lo mismo que thread_feed hoy).

BEGIN;
DROP FUNCTION public.conversation_feed(uuid[], uuid[], text, text, int);
COMMIT;
