# Directorio global de salas: fuentes públicas y estrategia

Investigado el 2026-10-10 a petición de Marco («tenemos que entrar en el listado de salas a nivel mundial
automáticamente de alguna base pública»). **[V]** = comprobado en la fuente (web, API o descarga); **[S]** = suposición
o no comprobable. Hoy cada espacio de Hour tiene su tabla `venue`, rellenada a mano.

## Recomendación en 5 líneas

1. Empezar por las bases oficiales de los dos mercados núcleo: **Basilic** (Francia, Licence Ouverte 2.0) y el **cens
   d'Equipaments Culturals** de la Generalitat (Cataluña). Traen tipo de sala, aforo en buena parte y coordenadas, con
   licencia compatible con un SaaS.
2. Encima, **Wikidata** (CC0) como esqueleto internacional y diccionario de identificadores para cruzar fuentes.
3. **OpenStreetMap** solo para huecos geográficos y nunca mezclado en la misma ficha: la ODbL hace «base derivada» (con
   obligación de compartir) cualquier mezcla.
4. **Overture / Foursquare** dan cantidad, no criterio: valen como señal de que una sala existe o cerró, no como
   directorio.
5. Arquitectura: un **directorio global de solo lectura, sin datos personales**; la compañía «adopta» una sala, la copia
   a su `venue` privado y añade sus contactos.

## Tabla comparativa

| Fuente | Cobertura medida | Campos útiles | Licencia | Formato | Frescura |
|---|---|---|---|---|---|
| Basilic (Ministère de la Culture, FR) | 86.366 registros; ~1.390 de artes escénicas (923 Théâtre, 341 Scène, 15 Opéra, 109 centros de creación) [V] | Nombre, dirección, INSEE, lat/lon, label (Scène nationale, SCIN, CDN…), nº de salas; jauge en 774 de 923 teatros; sin email ni teléfono [V] | Licence Ouverte 2.0 [V] | CSV 47 MB [V] | 18-02-2026 [V] |
| Equipaments culturals de Catalunya (`48s6-82h2`) | 5.840 equipamientos; 884 escénicos y musicales (307 teatros, 313 polivalentes, 87 auditorios, 50 salas de concierto) + 1.458 centros culturales y ateneos [V] | Nombre, dirección, municipio, lat/lon, titularidad, aforo (sala principal en 694 de 884), web, email, teléfono [V] | Llicència oberta d'ús d'informació: atribución con fecha, no sublicenciar [V] | Socrata (SODA, CSV, JSON) [V] | 22-04-2025, con fichas de 2013 [V] |
| Castilla y León, Red de Teatros | Red regional | Sala, dirección, gestores, teléfono, email, web [V] | CC BY 4.0 [V] | CSV, JSON, XLSX [V] | Semestral [V] |
| Castilla-La Mancha, Espacios escénicos | Salas inscritas | Sin listar [S] | **CC BY-SA 3.0 ES**: share-alike [V] | CSV, JSON… [V] | 13-02-2025 [V] |
| Wikidata | 15.130 «theatre building» con coordenadas; sin cierre: ES 1.376, FR 1.254, IT 1.617, PT 206, CH 146 [V] | Aforo solo 8-22 %; ID de OSM ~10-30 %; web, Wikipedia [V] | CC0 | SPARQL, dumps | Viva |
| OpenStreetMap | 53.469 `amenity=theatre`, 28.606 `arts_centre`, 36.722 `events_venue` en el mundo; España 2.168 teatros [V] | Nombre 81 %, calle 30 %, web 21 %; `capacity` en 9 de 2.168 en España [V] | ODbL 1.0 | PBF, Overpass | Diaria |
| GeoNames | THTR, OPRA, AMTH [V] | Nombre y coordenadas | CC BY 4.0 [V] | Dump diario | Diaria |
| Overture Places | ~81 M lugares, sin OSM [V] | Nombre, dirección, web, `confidence`, `operating_status`, ID estable GERS [V] | Por registro: CDLA Permissive 2.0 / Apache 2.0 (Foursquare) / CC0 [V] | GeoParquet [V] | Mensual |
| Foursquare OS Places | >100 M POIs [V] | Categorías, `date_closed` (no fiable) [V] | Apache 2.0 [V] | Iceberg / Hugging Face con registro [V] | Mensual |

## Notas por fuente

- **OSM y la ODbL.** Base derivada (adaptar o ampliar datos de OSM, p. ej. corregir una ficha de Basilic con una
  dirección de OSM o guardar `osm_id` como clave de cruce) obliga a compartirla bajo ODbL si se usa públicamente. Base
  colectiva (OSM junto a datos independientes, sin joins por ID y con cada campo entero de una sola fuente) solo
  arrastra la parte OSM. Un SaaS sin cláusula de red se discute; la OSMF no lo resuelve por escrito [S, interpretación].
  [Collective Database Guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline),
  [Geocoding Guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline).
- **Basilic** combina DGCA, Artcena, CNC y otros; tiene estado (`Demographie_AP`) y año de entrada; avisa de duplicados.
  Hueco [S]: no recoge salles des fêtes ni salles polyvalentes municipales.
  [data.gouv.fr](https://www.data.gouv.fr/datasets/base-des-lieux-et-equipements-culturels-basilic)
- **Gencat** incluye polivalentes y casas de cultura (el circuito pequeño que OSM no ve), pero algunos emails son
  nominativos (datos personales). No hay listados abiertos de la Xarxa de Teatres Públics, del Circuit ODA ni de Teatres
  en Xarxa [V, búsqueda negativa]. [dataset](https://analisi.transparenciacatalunya.cat/resource/48s6-82h2.json),
  [licencia](https://web.gencat.cat/ca/generalitat/dades-indicadors/dades-obertes/llicencies)
- **España**: sin directorio estatal abierto (Red Española de Teatros, INAEM, Platea: no publican dataset) [V/S]. Lo útil
  es autonómico.
- **Bélgica, Suiza, Portugal, Italia**: sin dataset abierto de salas encontrado; Portugal tiene ~101 espacios en la RTCP
  (DGArtes) sin dataset localizado; Italia solo regional (Umbria, CC BY 4.0) [V/S].

## Problemas prácticos

- **Deduplicar**: nombre normalizado + municipio + distancia < ~150 m, con Wikidata de puente; guardar (fuente, id) por
  ficha y no fusionar sin rastro [S].
- **Varias salas en un edificio**: modelo lugar → salas [S].
- **Salas cerradas**: marcar «no visto desde», nunca borrar (puede haber compañías que la tienen adoptada).
- **Teatros compartidos y pueblos pequeños**: alias de ciudad editable en el `venue` adoptado [S].
- **RGPD**: el directorio global solo lleva datos de la entidad (web, teléfono o email genérico), nunca nombres ni
  emails nominativos aunque vengan en la fuente. Si detectarlos es heurístico, mejor no importar ningún email [S].
  [AEPD](https://www.aepd.es/es/preguntas-frecuentes/2-rgpd/1-de-aplicacion)
- **Global frente a privado**: `venue_directory` global de solo lectura, con fuente y licencia por campo; `venue` por
  espacio, editable. Adoptar copia y guarda `directory_id`. Los cambios de la fuente se ofrecen («cambió el aforo,
  ¿aplicar?»), nunca se sobrescriben solos; lo que corrige una compañía no sube al global sin su consentimiento [S].

## Fases propuestas

1. Basilic + Gencat + Castilla y León, más Wikidata (CC0) para ES, IT, PT, CH y BE: unas 2.300 salas oficiales en FR y
   CAT más ~3.500 teatros de Wikidata [S en la suma]. Pocos MB en Postgres; job mensual.
2. Overture (sin la parte Foursquare si se quiere CDLA puro) solo para marcar cerradas, confianza o web.
3. OSM solo si hay un hueco que nada más cubre, como capa aparte publicable bajo ODbL; si no se acepta publicarla, fuera.

**No hacer**: mezclar OSM con otras fuentes en una ficha; importar emails o nombres de personas; borrar salas que
desaparecen; sobrescribir el `venue` de una compañía; usar Overpass en producción; tomar `community_centre` o
`theatre:type=amphi` de OSM como salas.

## Preguntas abiertas para Marco

1. ¿Incluir salas polivalentes, casas de cultura y centros cívicos? (De cientos a miles de fichas por región.)
2. ¿Acepta Hour publicar una capa ODbL? Si no, OSM queda fuera.
3. ¿Las correcciones de una compañía pueden volver al global con su consentimiento? (Pide moderación.)
4. ¿El email genérico de la sala va al global o todo contacto se queda en `venue`?
5. Tras FR y CAT: ¿Bélgica y Suiza (habría que pedir los datos a redes como Reso o publiq) o el resto de España?
6. ¿Escribir a la Red Española de Teatros y a DGArtes para pedir sus listados como dato?

Pendiente de verificar: la categoría de teatro en la taxonomía nueva de Overture, la licencia de la UiTdatabank, el
recuento OSM fuera de España y los campos del dataset de Castilla-La Mancha.
