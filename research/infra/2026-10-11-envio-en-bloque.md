# Envío en bloque desde Hour con el dominio de cada compañía

> 2026-10-11. Investigación, no asesoramiento jurídico. Precios y políticas leídos ese día en las páginas oficiales de
> cada proveedor; lo que no se encontró en fuente primaria va marcado. Encargo: `_tasks.md` («Correo con el dominio
> propio de cada compañía», conector 3).

## Lo que manda antes que el proveedor

- **Gmail, Yahoo y Outlook** (desde 2024-2025, para quien envía más de 5.000 al día a sus usuarios): SPF y DKIM,
  DMARC al menos `p=none`, alineación del dominio del remitente, baja en un clic (RFC 8058: cabeceras
  `List-Unsubscribe` con una URL HTTPS y `List-Unsubscribe-Post`, firmadas por DKIM), bajas atendidas en 48 horas y
  quejas por debajo del 0,3 % (Gmail apunta al 0,1 %). Fuentes: support.google.com/a/answer/81126 y /14229414,
  senders.yahooinc.com/best-practices. Outlook: según resúmenes de terceros, sin verificar en el post de Microsoft.
- **DNS de cada compañía:** DKIM del proveedor (CNAME o TXT), un subdominio de return-path con MX y SPF (alinea SPF sin
  gastar el límite de 10 consultas del SPF raíz, RFC 7208 §4.6.4) y `_dmarc`. Con DKIM alineado basta para Gmail y Yahoo.
- **LSSI (España):** art. 21.1 prohíbe el correo comercial no solicitado o no autorizado; la excepción del 21.2 exige
  relación contractual previa y productos propios similares. El texto no excluye a las empresas como destinatarias; la
  AEPD no tiene una respuesta oficial sobre B2B que hayamos encontrado. Sanción grave (envío masivo o insistente):
  30.001 a 150.000 €. Fuente: BOE-A-2002-13758. **Pregunta para el abogado.**
- **Francia (CNIL):** entre profesionales se permite sin consentimiento si el mensaje tiene que ver con su profesión,
  informando y ofreciendo oponerse; las direcciones genéricas (`info@…`) quedan fuera. Texto de L34-5 CPCE sin
  verificar en Légifrance.
- **Todos los proveedores** prohíben en sus condiciones las listas compradas o sacadas de webs; Resend prohíbe además
  el «cold outreach» de forma explícita. El envío en bloque solo encaja con destinatarios que lo han pedido o aceptado.

## Proveedores (a ~500.000 envíos al mes)

| Proveedor | Coste aprox. | Datos en la UE | Separa a cada compañía | Notas |
|---|---|---|---|---|
| Amazon SES | ~55 $ (con tenants) | Sí (eu-west-1, eu-central-1…) | Sí: tenants con reputación y pausa propias | API firmada SigV4; eventos por SNS o EventBridge |
| Emailit (cuenta de Marco) | ~65 $ envío por API; ~115 $ campañas | Sí: servidores propios en Praga, empresa checa | A medias: espacios separados por cliente, sin API para crearlos | DPA con huecos (un «ADD» sin rellenar; subencargados sin lista); la baja en un clic solo es automática en campañas; los rebotes no bloquean envíos por API |
| Mailgun | ~530 $ (máximo publicado) | Sí (endpoint UE) | Por dominios y grupos de IP; subcuentas solo con contrato | |
| Resend | 350 $ | No (EE. UU.) | No | Prohíbe el envío en frío |
| Postmark | ~606 $ (máximo publicado) | No (EE. UU.) | Un servidor por cliente | Revisión manual de cada cuenta |
| SendGrid | 429-499 $ | Solo con Pro e IP dedicada UE | 15 subcuentas por defecto | |
| Brevo | ~399 € | Sí | Subcuentas solo Enterprise | |
| Cloudflare Email Service | ~174 $ + Workers Paid | No documentado | No | Beta, solo transaccional, exige DNS en Cloudflare: descartado |

## Recomendación

1. **Amazon SES con un tenant por compañía** (recomendada). Es el único que junta datos en la UE, reputación aislada
   por compañía (una que envía mal se pausa sin hundir al resto) y el coste más bajo. Pide más trabajo: firma SigV4
   desde el Worker y recibir eventos por SNS o EventBridge.
2. **Emailit**, si se prioriza arrancar con la cuenta que ya existe: UE y barato, pero el aislamiento entre compañías
   es manual, el DPA tiene huecos y la gestión de bajas y rebotes en envíos por API hay que hacerla en Hour.
3. **Mailgun**, como alternativa UE con más madurez que Emailit y más cara que SES.

**Primer corte construible:** una campaña sale del buzón de difusión de la compañía con su dominio verificado (asistente
de DNS en Ajustes); los destinatarios se eligen entre las conversaciones; plantilla con la firma de Hour; baja en un
clic y lista de supresión por compañía (y global para quejas); las respuestas vuelven al buzón conectado (Reply-To) y,
de ahí, al historial de la conversación por la sincronización que ya existe; métricas de entrega, rebote y queja. Fuera
del primer corte: aperturas y clics, IP dedicada, automatizaciones.

**Queda para el abogado:** si una propuesta de espectáculo a un programador es comunicación comercial en el sentido de
la LSSI; si un «envíen propuestas a…» publicado por la sala cuenta como solicitado; y la base para escribir a contactos
genéricos de salas en España. Además: qué prueba de consentimiento basta y si cubre la excepción por relación
contractual previa; qué responsabilidad LSSI tiene Hour como plataforma de envío; qué ley manda para destinatarios en
Francia; si hay que consultar listas Robinson entre empresas; y si el píxel de apertura necesita consentimiento.

**Consecuencia para el diseño:** todos los proveedores exigen opt-in igual que la LSSI, así que el primer corte lleva
una puerta de consentimiento por destinatario (quién lo aceptó, cuándo y cómo) antes de poder incluirlo en una campaña.
