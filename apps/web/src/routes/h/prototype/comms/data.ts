/**
 * Datos inventados para la maqueta de comms (ADR-099). Nada de esto viene de
 * la base: personas inventadas, salas reales como nombres de ejemplo.
 *
 * Un evento de registro tiene la forma de `conversation_event` (ADR-098) más
 * lo que el buzón sincronizado añadiría en `metadata`: de qué buzón vino, de
 * quién y para quién, asunto y texto.
 */

import type { ConversationEventItem } from '$lib/conversation';

export type Mailbox = 'anouk' | 'comun';

export const MAILBOXES: Record<Mailbox, { label: string; address: string; provider: string }> = {
  anouk: { label: 'Buzón de Anouk', address: 'anouk@mukcia.com', provider: 'Google' },
  comun: { label: 'Buzón común', address: 'difusion@mukcia.com', provider: 'Microsoft 365' },
};

export type RecordEvent = ConversationEventItem & {
  /** Quién lo apuntó o desde qué buzón llegó. */
  by: string;
  when: string;
  mailbox?: Mailbox;
  from?: string;
  to?: string;
  subject?: string;
  /** Una llamada: duración. */
  minutes?: number;
  /** Adjuntos: no existen en el modelo (el contrato los deja fuera). */
  attachments?: string[];
};

export type TeamComment = {
  id: string;
  occurred_at: string;
  when: string;
  by: string;
  body: string;
};

const CONV = 'conv-pradillo';
const base = { conversation_id: CONV, recorded_at: '' } as const;

/** El «hoy» de la maqueta: lo que se deriva (turno, días) se cuenta desde aquí. */
export const TODAY = '2026-10-11T10:00:00+02:00';

/**
 * La conversación y lo que cuelga de ella. Cada campo dice de dónde saldría
 * (repaso del 2026-10-11, `research/product/2026-10-11-comms-conversacion-repaso.md`).
 */
export const conversation = {
  /** `workspace_organization.name` vía `workspace_person.organization_id`. */
  counterpart: 'Teatro Pradillo',
  /** `workspace_organization.kind`. */
  counterpartKind: 'Teatro',
  /** `person.full_name` (la conversación es con una persona: `conversation.person_id`). */
  person: 'Inés Valcárcel',
  /** `conversation.role`. */
  role: 'Programación',
  /** `workspace_person.email` / `.phone`. */
  email: 'programacion@teatropradillo.com',
  phone: '+34 914 16 90 11',
  city: 'Madrid',
  /** `project.name` y `line.name`. */
  project: 'MaMeMi',
  line: 'Gira 26/27',
  /** `conversation.status`, con su clase de siempre (`statusBadgeClass`). */
  status: 'in_conversation',
  statusLabel: 'En conversación',
  /** `conversation.first_contacted_at` / `last_contacted_at`. */
  firstContact: '8 sep',
  lastContact: '7 oct',
  /** `conversation.next_action_note` / `next_action_at`. */
  nextStep: 'Recibir el precontrato',
  nextDue: 'vie 17 oct',
  /** No existe en el modelo: hoy solo hay `created_by`. */
  owner: 'Anouk Delmas',
  /** No existe en el modelo (ADR-099 §4). */
  audience: 3,
  /** No existe en el modelo: si la sala acepta propuestas y por qué canal (LSSI). */
  consent: 'Acepta propuestas por correo a programación',
  /** `workspace_person.notes`: un dato de la persona, no algo hablado con fuera. */
  dossierNote: 'Deja Pradillo en enero. Desde entonces, la programación familiar la lleva Jordi Sastre.',
  /** Otras personas de la misma organización con conversación en el espacio. */
  sameOrganization: [{ person: 'Jordi Sastre', role: 'Programación familiar, desde enero', status: 'sin conversación' }],
};

/**
 * El bolo en juego: `bolo` con `conversation_id`, y sus funciones
 * (`performance.bolo_id`). El estado es el de siempre (`performance_status`).
 */
export const deal = {
  title: 'MaMeMi en Pradillo',
  status: 'hold_1',
  statusLabel: '1ª opción',
  fee: '1.800 € por día',
  feeNote: 'fijo, más desplazamiento',
  venue: 'Teatro Pradillo · sala pequeña',
  capacity: 'aforo 60',
  days: [
    { day: 'sáb 14 feb', times: ['11h', '12h30'] },
    { day: 'dom 15 feb', times: ['11h', '12h30'] },
  ],
  /** Lo que ya se le ha mandado: `asset_version` (dossier, rider…) por adjunto de un correo. */
  sent: [
    { label: 'Dossier', when: '8 sep' },
    { label: 'Ficha técnica', when: '2 oct' },
    { label: 'Rider simplificado', when: '2 oct' },
  ],
};

/** Lo que pasó con fuera, lo más reciente primero. */
export const record: RecordEvent[] = [
  {
    ...base,
    id: 'e7',
    occurred_at: '2026-10-07T11:20:00+02:00',
    when: '7 oct · 11h20',
    kind: 'email',
    source: 'email',
    direction: 'inbound',
    by: 'Inés Valcárcel',
    mailbox: 'anouk',
    from: 'Inés Valcárcel <programacion@teatropradillo.com>',
    to: 'anouk@mukcia.com',
    subject: 'Re: MaMeMi, fechas de febrero y condiciones',
    body:
      'Hola, Anouk:\n\nConfirmamos el 14 y el 15 de febrero, dos funciones cada día (11:00 y 12:30). ' +
      'El fijo de 1.800 € por día nos encaja. La semana que viene os mando el precontrato; ' +
      'si me pasáis antes el rider simplificado, lo reviso con Sergio, nuestro técnico.\n\n' +
      'Un abrazo,\nInés',
  },
  {
    ...base,
    id: 'e6',
    occurred_at: '2026-10-02T09:05:00+02:00',
    when: '2 oct · 9h05',
    kind: 'email',
    source: 'email',
    direction: 'outbound',
    by: 'Anouk Delmas',
    mailbox: 'anouk',
    from: 'Anouk Delmas <anouk@mukcia.com>',
    to: 'programacion@teatropradillo.com',
    subject: 'MaMeMi, fechas de febrero y condiciones',
    attachments: ['Ficha técnica MaMeMi.pdf', 'Rider simplificado.pdf'],
    body:
      'Hola, Inés:\n\nGracias por la llamada. Te resumo lo que hablamos: 14 y 15 de febrero, dos ' +
      'funciones por día. Fijo de 1.800 € por día, más desplazamiento. Te adjunto la ficha técnica ' +
      'y el rider simplificado, sin suelo de danza.\n\nAnouk Delmas\nProducción · MüK Cia',
  },
  {
    ...base,
    id: 'e4',
    occurred_at: '2026-09-30T12:15:00+02:00',
    when: '30 sep · 12h15',
    kind: 'call',
    source: 'manual',
    direction: 'outbound',
    by: 'Anouk Delmas',
    minutes: 14,
    body:
      'Les interesa para el ciclo de primera infancia. Febrero: 7-8 o 14-15, dos funciones por día. ' +
      'Prefieren fijo a taquilla. Piden rider simplificado.',
  },
  {
    ...base,
    id: 'e3',
    occurred_at: '2026-09-29T10:42:00+02:00',
    when: '29 sep · 10h42',
    kind: 'email',
    source: 'email',
    direction: 'inbound',
    by: 'Inés Valcárcel',
    mailbox: 'comun',
    from: 'Inés Valcárcel <programacion@teatropradillo.com>',
    to: 'difusion@mukcia.com',
    subject: 'Re: MaMeMi, propuesta para la temporada 26/27',
    body:
      'Buenos días:\n\nMaMeMi nos encaja en el ciclo de primera infancia. ¿Tenéis disponibilidad en ' +
      'febrero? Solo podemos fines de semana por la mañana. Llamadme cuando podáis.\n\nInés Valcárcel\n' +
      'Programación · Teatro Pradillo',
  },
  {
    ...base,
    id: 'e2',
    occurred_at: '2026-09-22T09:30:00+02:00',
    when: '22 sep · 9h30',
    kind: 'email',
    source: 'email',
    direction: 'outbound',
    by: 'Anouk Delmas',
    mailbox: 'anouk',
    from: 'Anouk Delmas <anouk@mukcia.com>',
    to: 'programacion@teatropradillo.com',
    subject: 'Re: MaMeMi, propuesta para la temporada 26/27',
    body:
      'Hola de nuevo, Inés:\n\nTe escribo por si se perdió el correo anterior. Seguimos cerrando ' +
      'fechas de la temporada y nos encantaría pasar por Pradillo.\n\nAnouk Delmas\nProducción · MüK Cia',
  },
  {
    ...base,
    id: 'e1',
    occurred_at: '2026-09-08T10:00:00+02:00',
    when: '8 sep · 10h',
    kind: 'email',
    source: 'email',
    direction: 'outbound',
    by: 'Anouk Delmas',
    mailbox: 'anouk',
    from: 'Anouk Delmas <anouk@mukcia.com>',
    to: 'programacion@teatropradillo.com',
    subject: 'MaMeMi, propuesta para la temporada 26/27',
    attachments: ['Dossier MaMeMi 2026.pdf'],
    body:
      'Hola, Inés:\n\nOs escribo desde MüK Cia para proponeros MaMeMi, nuestra pieza para bebés de ' +
      '0 a 3 años: 35 minutos, aforo de 60 personas, montaje en 3 horas. Te dejo el dossier y el ' +
      'vídeo completo.\n\nAnouk Delmas\nProducción · MüK Cia',
  },
];

/** Lo que el equipo habla por dentro sobre esta conversación. */
export const team: TeamComment[] = [
  {
    id: 'c4',
    occurred_at: '2026-10-07T12:02:00+02:00',
    when: '7 oct · 12h02',
    by: 'Marco Rubiol',
    body: 'Bien. El fijo a 1.800 está bien; que el precontrato diga desplazamiento aparte.',
  },
  {
    id: 'c3',
    occurred_at: '2026-10-01T08:50:00+02:00',
    when: '1 oct · 8h50',
    by: 'Pau Riera',
    body: 'Sí, la versión sin suelo de danza. Te la paso esta mañana.',
  },
  {
    id: 'c2',
    occurred_at: '2026-09-30T12:40:00+02:00',
    when: '30 sep · 12h40',
    by: 'Anouk Delmas',
    body: 'Le he propuesto el 14-15. Pide rider simplificado: ¿lo tenemos, Pau?',
  },
  {
    id: 'c1',
    occurred_at: '2026-09-29T11:15:00+02:00',
    when: '29 sep · 11h15',
    by: 'Marco Rubiol',
    body: 'Febrero lo tenemos libre salvo el 7, que es Vic. Prioriza el 14-15.',
  },
];

// ── Tablón del día ───────────────────────────────────────────────────────

export type Facet = 'general' | 'tecnica' | 'logistica' | 'comidas' | 'dinero';

export const FACETS: Record<Facet, { label: string; audience: string }> = {
  general: { label: 'General', audience: 'Lo ven 5, por estar en el bolo' },
  tecnica: { label: 'Técnica', audience: 'Lo ven 3, por permiso de técnica' },
  logistica: { label: 'Logística', audience: 'Lo ven 5, por permiso de logística' },
  comidas: { label: 'Comidas', audience: 'Lo ven 5, por permiso de logística' },
  dinero: { label: 'Dinero', audience: 'Lo ven 2, por permiso de dinero' },
};

export type Performance = { id: string; day: string; time: string };

export const bolo = {
  title: 'MaMeMi en Cuarta Pared',
  venue: 'Sala Cuarta Pared',
  city: 'Madrid',
  days: 'sáb 15 y dom 16 nov',
  team: ['Marco Rubiol', 'Anouk Delmas', 'Pau Riera', 'Laia Mas', 'Clara Soler'],
};

export const performances: Performance[] = [
  { id: 'f1', day: 'sáb 15', time: '11:00' },
  { id: 'f2', day: 'sáb 15', time: '12:30' },
  { id: 'f3', day: 'dom 16', time: '11:00' },
];

export type BoardMessage = {
  id: string;
  facet: Facet;
  /** La función de la que habla; sin función, habla del bolo entero. */
  performance?: string;
  when: string;
  by: string;
  body: string;
};

export const board: BoardMessage[] = [
  { id: 'm1', facet: 'general', when: 'vie · 19:10', by: 'Marco Rubiol', body: 'Salimos mañana a las 7:15 desde el local. Desayuno en ruta.' },
  { id: 'm2', facet: 'general', when: 'sáb · 07:20', by: 'Laia Mas', body: 'Clara y yo vamos en tren, llegamos a Atocha a las 8:40.' },
  { id: 'm3', facet: 'tecnica', performance: 'f1', when: 'sáb · 08:55', by: 'Pau Riera', body: 'Montaje empezado. El técnico de la sala confirma 6 varas y dimmer de 12 canales.' },
  { id: 'm4', facet: 'tecnica', performance: 'f1', when: 'sáb · 10:30', by: 'Pau Riera', body: 'Ensayo de luces hecho. Calefacción de sala a 23°, pedido.' },
  { id: 'm5', facet: 'tecnica', performance: 'f2', when: 'sáb · 11:45', by: 'Pau Riera', body: 'Entre funciones cambiamos las telas; 25 minutos, sin cambio de suelo.' },
  { id: 'm6', facet: 'tecnica', performance: 'f3', when: 'sáb · 14:10', by: 'Marco Rubiol', body: 'El domingo la sala solo pone un técnico. Desmontaje a las 12:15, furgoneta en el muelle a las 13:00.' },
  { id: 'm7', facet: 'logistica', when: 'vie · 18:30', by: 'Anouk Delmas', body: 'Carga y descarga por la calle Ercilla 17, de 8:00 a 9:00. Aparcamiento en el Parking Ercilla, ya reservado.' },
  { id: 'm8', facet: 'logistica', when: 'sáb · 15:00', by: 'Anouk Delmas', body: 'Hotel: Hostal Embajadores, 3 habitaciones a nombre de MüK Cia. Check-in a partir de las 14:00.' },
  { id: 'm9', facet: 'comidas', when: 'vie · 18:45', by: 'Anouk Delmas', body: 'Sábado: catering en la sala a las 14:00 para 5. Una vegetariana (Clara) y uno sin gluten (Pau).' },
  { id: 'm10', facet: 'comidas', when: 'sáb · 16:20', by: 'Clara Soler', body: '¿El domingo comemos en la sala o en el tren de vuelta?' },
  { id: 'm11', facet: 'comidas', when: 'sáb · 16:35', by: 'Anouk Delmas', body: 'En el tren: bocadillos encargados para recoger a las 13:30.' },
  { id: 'm12', facet: 'dinero', when: 'vie · 12:00', by: 'Anouk Delmas', body: 'Factura de las tres funciones, una sola: 2.700 € más IVA. Pago a 30 días.' },
];
