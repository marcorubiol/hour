/*! @license @templatical/editor, @templatical/types 0.56.1 · Copyright 2026-present Templatical · FSL-1.1-MIT (Functional Source License, Version 1.1, MIT Future License) · https://github.com/templatical/sdk/blob/main/LICENSE */
/**
 * La puerta a Templatical (ADR-190): el editor del correo diseñado entra solo
 * por aquí, con carga diferida desde MailDesignEditor. El comentario de arriba
 * es el aviso que pide la cláusula de redistribución de su licencia (los
 * términos o un enlace a ellos, y el copyright): `/*!` hace que el minificador
 * lo conserve en el chunk que se sirve (comprobado en el build del 2026-11-07;
 * `templatical.test.ts` vigila que la cabecera siga aquí).
 */
import { init } from '@templatical/editor';
import { createDefaultTemplateContent, createParagraphBlock, createTitleBlock } from '@templatical/types';

export const TEMPLATICAL_LICENSE = 'FSL-1.1-MIT';
export { init, createDefaultTemplateContent, createParagraphBlock, createTitleBlock };
