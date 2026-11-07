# Atajo «Mandar a Hour» (iPhone)

ADR-189. Lleva un chat exportado de WhatsApp a la hoja «Importar chat» de Hour en dos toques. El archivo no se sube a
ningún sitio: se guarda en Archivos y Hour lo lee en el propio teléfono.

## Crear el atajo (una vez)

1. Abre **Atajos** › «+» › nombre: **Mandar a Hour**.
2. Toca la «i» (detalles) y activa **Mostrar en la hoja de compartir**. En «Tipos», deja sólo **Archivos**.
3. Añade la acción **Guardar archivo**: entrada «Entrada del atajo», destino **iCloud Drive › Hour** (crea la carpeta
   la primera vez), **Preguntar dónde guardar: no**, **Sobrescribir si existe: sí**.
4. Añade la acción **Abrir URL**: `https://hour.zerosense.studio/h/conversations?importar`.
5. Guarda.

Para repartirlo: en el atajo, Compartir › Copiar enlace de iCloud.

## Usarlo

1. En WhatsApp, abre el chat › toca su nombre › **Exportar chat** › **Sin archivos** (pesa menos; Hour sólo guarda el
   nombre de cada adjunto).
2. En la hoja de compartir, **Mandar a Hour**.
3. Hour abre «Importar chat»: toca **Elegir archivo** y el chat sale arriba, en Recientes.
4. Revisa quién es quién y dónde va cada tanda, y toca **Importar**.

## Por qué así

Un atajo no puede pasar un archivo a una página web, y la alternativa (subirlo con un token) dejaría el chat entero en
el servidor antes de revisarlo. Se descartó (ADR-189, 3b). En Android, Hour como destino de compartir (Web Share
Target) haría lo mismo sin atajo: después.
