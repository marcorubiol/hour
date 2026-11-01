/**
 * The body a fiscal record is written with, for a payer (an organization,
 * ADR-102 phase 2b) or the issuer (the space, ADR-168). Every field is
 * written; a blank one clears it. `legal_name` is required.
 */
import * as v from 'valibot';

const text = (max: number) => v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(max))), null);

export const ReceiverFiscalSchema = v.object({
  legal_name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300)),
  tax_id: text(60),
  address_line_1: text(300),
  address_line_2: text(300),
  postal_code: text(30),
  city: text(120),
  region: text(120),
  country: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.regex(/^([A-Za-z]{2})?$/))), null),
});

export const IssuerFiscalSchema = v.object({
  ...ReceiverFiscalSchema.entries,
  iban: text(34),
  swift_bic: text(11),
});
