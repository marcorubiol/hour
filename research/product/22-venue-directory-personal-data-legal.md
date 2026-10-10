# Datos personales en el directorio global: salas y programadores

Investigado el 2026-10-10 para `_tasks.md` («Consulta legal sobre datos personales en el directorio global»).
**Esto es una investigación, no asesoramiento jurídico.** Sirve para preparar la consulta con un abogado, no para
sustituirla. **[F]** = lo dice la fuente citada; **[I]** = interpretación mía; **[NV]** = no lo he podido verificar en
la fuente primaria.

Punto de partida: la fase 1 en producción no lleva datos personales (solo info@, taquilla, teléfono de la sala). Se
analizan dos ampliaciones: **(a)** persona de programación o técnica en la ficha global de una sala (nombre, email,
teléfono); **(b)** un directorio global de programadores.

## Conclusión en seis líneas

1. Hay base posible (interés legítimo, art. 6.1.f RGPD) para **(a)**, con la presunción del art. 19 LOPDGDD en España;
   para **(b)** la ponderación es bastante más difícil, porque el producto pasa a ser la persona y no la sala. [I]
2. Ninguna de las dos libra a Hour de **informar a cada persona en el primer mes y, como tarde, al ponerla a la vista de
   otras compañías** (art. 14.3 RGPD). El «esfuerzo desproporcionado» casi no aplica: Hour tiene el email. [F+I]
3. El freno más duro no es el RGPD sino la **LSSI española**: un email que ofrece un espectáculo a un programador es
   comunicación comercial y en España **necesita consentimiento previo también entre empresas** (AEPD y Audiencia
   Nacional). En Francia, B2B por email se permite con información y baja. [F]
4. Hour sería **responsable** del directorio global, no encargado. Si las compañías alimentan y validan fichas, hay riesgo
   de **corresponsabilidad** (art. 26). [I]
5. Recomendación: **persona solo si ella misma se da de alta o reclama su ficha** (y acepta recibir propuestas); el resto,
   contactos genéricos. Es la única opción que además resuelve el consentimiento de la LSSI. [I]
6. La opción de interés legítimo con aviso y baja es defendible para (a), pero pide aviso individual, ponderación
   escrita, EIPD y una lista de supresión, y no resuelve la LSSI. [I]

## 1. Base jurídica

**Interés legítimo (art. 6.1.f RGPD).** Tres pasos: interés legítimo, necesidad y ponderación, con la carga de la prueba
en el responsable [F, EDPB, Directrices 1/2024, versión 1.0 de 8-10-2024 sometida a consulta; no he confirmado que haya
versión final]. El TJUE admite que un interés puramente comercial puede ser legítimo si es lícito, pero con necesidad
estricta y ponderación que mire las expectativas razonables del interesado [F, TJUE C-621/22 KNLTB, 4-10-2024].

**Art. 19 LOPDGDD.** Presume amparado por el 6.1.f, «salvo prueba en contrario», el tratamiento de datos de contacto y
puesto de quien presta servicios en una persona jurídica si (a) solo son los datos necesarios para su localización
profesional y (b) la finalidad es únicamente mantener relaciones con la persona jurídica donde trabaja. El apartado 2
extiende la presunción a empresarios individuales y profesionales liberales tratados solo en esa condición [F, BOE].

- **¿Cubre a un tercero que no es el empleador?** El texto no exige que el responsable sea el empleador ni quien tiene la
  relación; mira la finalidad [F, texto]. Una ficha de sala con «programación: nombre, email del teatro», usada para
  que compañías traten con ese teatro, encaja bien en la letra (b) [I].
- **¿Cubre una base compartida con muchas compañías?** El texto no lo excluye, pero la AEPD ha dicho, sobre un
  directorio web de profesionales, que «el artículo 19 de la LOPDGDD no implica una autorización para realizar cualquier
  tipo de tratamiento» y que la presunción se rompe cuando la persona deja de ejercer; era responsabilidad del directorio
  comprobar que seguía en activo [F, AEPD EXP202403454 / PA/00004/2025, apercibimiento a Praedium Project S.L.]. Para un
  directorio global eso significa una carga de exactitud continua [I].
- **Directorio de programadores (b).** Aquí la finalidad deja de ser «relacionarse con el teatro» y pasa a ser «saber
  quién programa qué, dónde y cómo contactarle», que sigue a la persona entre cargos. Eso se aleja de la letra (b) y se
  acerca a un perfil profesional; los programadores independientes caen en el apartado 2 [I].
- **Francia no tiene presunción equivalente**: allí todo depende de la ponderación documentada [I; no he encontrado norma
  francesa equivalente].

**Ponderación necesaria (qué debería contener) [I, sobre la estructura del EDPB]:** interés (que la compañía encuentre
a quien decide la programación de una sala, sector pequeño donde ese contacto es público y esperado); necesidad (¿no
basta el email genérico de programación?, que es la pregunta que más puede tumbar la base); expectativas (un
programador espera propuestas de compañías, no esperaría estar en una base comercial sin saberlo, ni seguir en ella al
cambiar de trabajo); salvaguardas (aviso individual, baja en un clic, solo fuentes institucionales, revisión periódica).
«Estar en una web pública» no basta por sí solo: era la idea de las «fuentes accesibles al público» de la LOPD de 1999,
que el RGPD no recoge como base [I; la AEPD no lo dice así en lo que he leído, pero Praedium alegó «fuentes de acceso
público» y fue apercibida igualmente, F].

## 2. Deber de informar (art. 14 RGPD)

- **Plazo [F, art. 14.3]:** en un plazo razonable, como máximo un mes; si se usan para comunicarse con la persona, como
  tarde en la primera comunicación; si se van a comunicar a otro destinatario, como tarde cuando se comuniquen por
  primera vez. En un directorio compartido el dato queda a la vista de las compañías al publicarse, así que el aviso debe
  ir **antes o en el momento de publicar** [I].
- **Contenido [F, art. 14.1 y 14.2]:** identidad del responsable, fines, base, interés legítimo perseguido, categorías
  de datos, destinatarios, plazo, derechos (oposición incluida), derecho a reclamar ante la autoridad y **la fuente**
  (y si es de acceso público). En España cabe información por capas: básica más enlace, incluyendo categorías y fuente
  [F, art. 11.3 LOPDGDD].
- **Excepción del art. 14.5.b (esfuerzo desproporcionado):** el WP29 dice que no debe usarse rutinariamente fuera de
  archivo, investigación o estadística, que la imposibilidad o el esfuerzo deben venir de no haber obtenido el dato del
  interesado, y que quien la invoque debe hacer y documentar una ponderación y, aun así, publicar la información
  [F, WP260 rev.01, apdos. 61 a 64]. La autoridad polaca multó a Bisnode por no avisar a empresarios cuyos datos tomó de
  registros públicos: el aviso en su web se consideró insuficiente y el coste del correo no justificó la excepción; el
  Tribunal Supremo Administrativo confirmó en 2023 [F, UODO; NSA III OSK 2538/21]. **Para Hour no aplica [I]:** la
  ficha contiene el email de la persona, avisarla cuesta un correo.
- La CNIL sancionó a KASPR, entre otras cosas, por avisar tarde (cuatro años después) y con un email en inglés poco
  comprensible [F, CNIL SAN-2024-020].

## 3. Oposición y supresión en una base compartida

- Con base en interés legítimo, la oposición (art. 21.1 RGPD) obliga a dejar de tratar salvo motivos imperiosos; frente a
  mercadotecnia directa es absoluta (art. 21.2 y 21.3) [F, RGPD]. Plazo de respuesta: un mes (art. 12.3) [F].
- Si se rectifica o suprime, el responsable debe comunicarlo a cada destinatario al que se comunicaron los datos, salvo
  imposible o desproporcionado (art. 19 RGPD) [F]. En Hour: propagar a toda compañía que adoptó la ficha [I].
- Diseño mínimo [I]: (1) baja en un clic desde el aviso, sin cuenta; (2) **lista de supresión** con hash del email para
  que un nuevo import no la reintroduzca (la CNIL pide conservar la prueba de la oposición al menos tres años,
  [F, referencial de gestión comercial]); (3) aviso a las compañías que la adoptaron. Qué hace cada compañía con la copia
  privada que ya tenía es decisión suya como responsable; ver pregunta 3.
- En España, quien hace mercadotecnia directa debe consultar antes los sistemas de exclusión publicitaria (art. 23.4
  LOPDGDD) salvo consentimiento [F]. Si aplica a envíos B2B a personas de empresa es pregunta para el abogado.

## 4. Roles

- **Directorio global:** Hour decide qué campos, de qué fuentes, para quién y cuánto tiempo: es **responsable**
  (art. 4.7 RGPD) [I; la AEPD trató así al directorio Praedium, F].
- **Espacio privado de cada compañía (`venue`, conversaciones):** la compañía decide; Hour es **encargado** y necesita
  contrato del art. 28 en sus condiciones [I].
- **Lo que una compañía adopta a su espacio y usa para escribir:** la compañía pasa a ser responsable de su uso, incluida
  la LSSI [I].
- **Correcciones validadas por otras compañías (decidido el 10-10):** si las compañías aportan datos y Hour fija el
  mecanismo, puede haber corresponsabilidad en la fase de recogida, como en los casos en que el TJUE la vio con
  participación limitada a una fase [F, TJUE C-210/16 Wirtschaftsakademie, C-25/17 Jehovan todistajat, C-40/17
  Fashion ID; I la aplicación a Hour]. Consecuencia: acuerdo del art. 26 con reparto de obligaciones, su esencia a
  disposición del interesado, y que el interesado puede ejercer sus derechos ante cualquiera de ellos [F, art. 26.2 y
  26.3]. Para evitarlo: Hour como único responsable del global y la compañía como mera fuente que propone, con
  condiciones que lo digan [I].

## 5. Fuentes de los datos

| Fuente | Qué cambia [I salvo que se cite] |
|---|---|
| Web del propio teatro o festival (scraping) | La más defendible para (a): el dato lo publicó la entidad para ser contactada. Aun así art. 14, exactitud y baja. Respetar límites de visibilidad que el titular ha elegido: KASPR fue sancionada por recoger datos que los usuarios habían restringido [F, CNIL]. |
| Agregadores de terceros | Peor: la persona no lo publicó para este fin y la exactitud empeora. Praedium se amparó en otros directorios y fue apercibida [F]. |
| Aportados por compañías | Cesión de la compañía a Hour: la compañía necesita su propia base para comunicarlo y Hour sigue debiendo el aviso del art. 14 en un mes, nombrando la fuente [I; la CNIL exige al receptor de un fichero informar en un mes como máximo y nombrar la fuente, F, «Vente de fichiers clients», 2022]. |
| Aportados por el interesado | Art. 13 en vez de 14, consentimiento o contrato, y puede aceptar recibir propuestas: resuelve también la LSSI. |

## 6. Uso permitido: escribir para programar

- **España, LSSI art. 21:** prohíbe comunicaciones publicitarias o promocionales por email no solicitadas o
  expresamente autorizadas; excepción solo con relación contractual previa y productos similares [F, BOE]. La AEPD ha
  dicho que es «irrelevante la pertenencia de dicha dirección de correo a una persona física o a una persona jurídica,
  pues la LSSI no distingue» y cita a la Audiencia Nacional (recurso 371/2012, 23-07-2013): publicar un email de
  contacto en la web no es autorización para recibir publicidad [F, AEPD E/01853/2015]. Que una propuesta de espectáculo
  a un programador sea «comunicación comercial» es casi seguro, pues promociona los servicios de la compañía [I]. El
  matiz útil: si la sala **pide** propuestas por un canal (convocatoria, «envíen dossiers a…»), ese envío está
  «solicitado» [I, pregunta 1].
- **Francia, art. L34-5 CPCE:** el consentimiento previo se exige a personas físicas en B2C; en B2B la CNIL no lo exige
  si el mensaje está relacionado con la actividad profesional del destinatario, se le informa del origen y la finalidad y
  puede oponerse fácilmente [F, CNIL, página actualizada 10-06-2026; el texto de L34-5 no lo he leído en Légifrance,
  NV].
- **Consecuencia para Hour [I]:** el directorio no convierte en legal un envío en frío a un programador español. Hour no
  debe ofrecer envíos masivos a contactos del directorio, y conviene guardar en la ficha si la sala acepta propuestas y
  por qué canal.

## 7. Medidas mínimas

- **Registro de actividades** (art. 30 RGPD, art. 31 LOPDGDD): una actividad «directorio global» con Hour como
  responsable y otra como encargado de las compañías [F la obligación, I el reparto].
- **Ponderación de interés legítimo escrita**, antes de cargar ningún dato personal [I; la carga de la prueba es del
  responsable, F, EDPB].
- **EIPD:** la lista de la AEPD la pide en la mayoría de casos con dos o más criterios; aquí concurren al menos **gran
  escala** (7: toda España y Francia, luego Europa) y **combinación de bases de responsables distintos** (8: fuentes
  oficiales, webs y aportes de compañías) [F la lista; I la aplicación]. Con la opción B, hacerla. Con la opción A,
  documentar por qué no hace falta.
- **Minimización:** nombre, cargo, email y teléfono profesionales de la entidad; nunca móvil personal, notas ni
  opiniones en el global (las opiniones se quedan en el espacio privado) [I, art. 5.1.c RGPD].
- **Exactitud y conservación:** revalidación periódica y retirada al dejar el cargo (Praedium) [F+I]; la CNIL toma tres
  años desde el último contacto del prospecto como referencia y criticó en KASPR que cada actualización reiniciara cinco
  años [F]. Propuesta [I]: revalidar cada 12 meses, retirar a los 3 años sin señal.
- **Información en la web:** sección propia del directorio en la política de privacidad, por capas, con formulario de
  derechos sin cuenta [F art. 11 LOPDGDD; I el diseño].

## 8. Riesgos y sanciones de referencia

| Caso | Qué | Resultado |
|---|---|---|
| KASPR (CNIL, SAN-2024-020, 5-12-2024) | Base de ~160 M contactos profesionales tomados de LinkedIn y otras webs | 240.000 €; arts. 5.1.e, 6, 12, 14, 15 [F] |
| Bisnode (UODO, Polonia; NSA 19-09-2023) | Datos de empresarios de registros públicos sin aviso individual | ~943.000 PLN, en parte anulado y a recalcular; deber de aviso confirmado [F] |
| Praedium (AEPD, EXP202403454) | Directorio web de profesionales tomado de fuentes públicas | Apercibimiento por art. 6.1, sin multa porque cerró la web [F] |
| AEPD E/01853/2015 y AN 371/2012 | Email comercial a dirección de empresa publicada en web | Infracción del art. 21 LSSI [F] |

Techo general del RGPD: hasta 20 M€ o el 4 % de la facturación (art. 83.5) [F]. LSSI: el art. 21 se tipifica como
leve o grave según el volumen (arts. 38 y 39) [NV las cuantías en esta sesión]. El riesgo realista para Hour hoy es una
reclamación de un programador y un apercibimiento con orden de cesar, más el daño reputacional en un sector pequeño [I].

## 9. Diseño recomendado

**A. Recomendada: genérico para todos, persona solo si se da de alta o reclama su ficha.**
La ficha global lleva los contactos de la entidad (programación@, técnica@, teléfono de la sala). Un programador puede
crear o reclamar su perfil verificando con el email de su dominio, elegir qué se ve y marcar «acepto recibir propuestas
de compañías» y por qué canal. Para (b), el directorio de programadores es solo de quienes se dieron de alta.
Por qué: es la única opción que cumple a la vez el art. 6 (consentimiento o contrato), el art. 13 en vez del 14, y el
consentimiento previo de la LSSI española, y convierte el freno legal en valor de producto: una lista de programadores
que aceptan propuestas es algo que hoy no existe [I]. Coste: arranque lento; necesita un incentivo para el programador
(recibir dossiers ordenados en vez de emails sueltos). Cuidado: si Hour invita por email a una persona que no lo pidió,
esa invitación puede ser comunicación comercial de Hour (pregunta 6); invitar a través del email genérico de la sala o
de la compañía que ya trata con ella reduce ese riesgo [I].

**B. Interés legítimo con aviso y baja, solo para la persona de la ficha de sala (a).**
Solo nombre y cargo con email y teléfono que la propia entidad publica en su web, nunca de agregadores; aviso individual
antes de publicar con baja en un clic; lista de supresión; revalidación anual; ponderación escrita y EIPD; sin envíos
masivos desde Hour. Defendible en España por el art. 19, más discutible en Francia. No vale para (b) [I].

**C. Solo genéricos (lo que hay hoy).**
Sin datos personales en el global; cada compañía guarda sus personas en su espacio privado, donde es responsable y Hour
encargado. Riesgo mínimo, menos valor. Es la base sobre la que A se monta.

## 10. Preguntas para el abogado

1. ¿Una propuesta de espectáculo enviada uno a uno a un programador es «comunicación comercial» del art. 21 LSSI? ¿Que
   la sala publique «envíen propuestas a…» o abra una convocatoria cuenta como «solicitada»?
2. ¿Cubre la presunción del art. 19 LOPDGDD a un directorio de terceros cuya finalidad es que muchas compañías se
   relacionen con la sala? ¿Y a un directorio de programadores que sigue a la persona entre cargos?
3. Cuando una persona se opone, ¿qué obligación tiene Hour sobre las copias ya adoptadas en espacios privados donde es
   encargado? ¿Basta con avisar a la compañía (art. 19 RGPD)?
4. ¿El mecanismo de correcciones validadas por dos compañías crea corresponsabilidad del art. 26? ¿Qué cláusulas lo
   evitan o lo ordenan?
5. ¿Cuál es la base de la compañía para comunicar a Hour un contacto que tiene en su espacio privado?
6. ¿Una invitación de Hour a un programador para que reclame su ficha es comunicación comercial que exige consentimiento
   previo? ¿Y si va al email genérico de la sala?
7. ¿Aplica el art. 23.4 LOPDGDD (consulta de listas de exclusión) a envíos B2B a personas de una entidad?
8. Con Francia en el alcance y sede en España, ¿qué autoridad es la principal, y hay criterio francés que añadir para
   salas públicas (programadores funcionarios territoriales)?
9. ¿Hace falta EIPD formal para la opción A, o basta documentar por qué no?

## Fuentes

- RGPD (arts. 4, 6, 12, 14, 19, 21, 26, 28, 30, 35, 83): https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32016R0679
- LOPDGDD, arts. 11, 19, 23, 28: https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673
- LSSI, art. 21: https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758
- AEPD, FAQ datos de contacto: https://www.aepd.es/preguntas-frecuentes/2-tus-obligaciones-como-responsable-del-tratamiento/2-aplicacion-de-la-normativa/FAQ-0203-sobre-la-aplicacion-del-rgpd-a-los-datos-de-contacto
- AEPD, EXP202403454 (Praedium): https://www.aepd.es/documento/pa-00004-2025.pdf
- AEPD, E/01853/2015 (LSSI y persona jurídica, cita AN rec. 371/2012): https://www.aepd.es/es/documento/e-01853-2015.pdf
- AEPD, lista de tratamientos que requieren EIPD: https://www.aepd.es/documento/listas-dpia-es-35-4.pdf
- EDPB, Directrices 1/2024 sobre interés legítimo: https://www.edpb.europa.eu/our-work-tools/documents/public-consultations/2024/guidelines-12024-processing-personal-data-based_en
- WP29, Directrices de transparencia WP260 rev.01: https://ec.europa.eu/newsroom/article29/items/622227
- EDPB, Directrices 07/2020 responsable y encargado: https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-072020-concepts-controller-and-processor-gdpr_en
- TJUE C-621/22 KNLTB: https://curia.europa.eu/juris/liste.jsf?num=C-621/22
- TJUE C-210/16, C-25/17, C-40/17: https://curia.europa.eu/juris/liste.jsf?num=C-210/16 · https://curia.europa.eu/juris/liste.jsf?num=C-25/17 · https://curia.europa.eu/juris/liste.jsf?num=C-40/17
- CNIL, comunicaciones electrónicas a prospectos y clientes: https://www.cnil.fr/fr/communication-electronique-quelles-regles
- CNIL, sanción KASPR: https://www.cnil.fr/fr/aspiration-de-donnees-sanction-de-240-000-euros-lencontre-de-la-societe-kaspr
- CNIL, venta de ficheros de clientes: https://www.cnil.fr/fr/vente-de-fichiers-clients-la-cnil-rappelle-les-regles
- CNIL, preguntas sobre el referencial de gestión comercial: https://www.cnil.fr/fr/questions-reponses-sur-les-referentiels-relatifs-la-gestion-des-activites-commerciales-et-des
- CPCE (Légifrance, código completo; L34-5 no leído directamente): https://www.legifrance.gouv.fr/codes/id/LEGITEXT000006070987
- UODO, Bisnode confirmado por el NSA: https://uodo.gov.pl/en/553/1572
