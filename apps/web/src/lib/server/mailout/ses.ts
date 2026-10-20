/**
 * El adaptador de Amazon SES: esqueleto (ADR-111, no hay cuenta de AWS).
 *
 * Sin `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` o `SES_REGION` falla al
 * crearlo con MailoutNotConfiguredError, que las rutas devuelven como 503
 * `mailout_not_configured`. Configurado, sus métodos todavía no existen: se
 * escriben con la cuenta (plan § 5: CreateTenant, CreateConfigurationSet,
 * CreateEmailIdentity, PutEmailIdentityMailFromAttributes,
 * CreateTenantResourceAssociation, GetEmailIdentity; firma SigV4; y en la
 * fase 3, SendEmail con TenantName, ConfigurationSetName, las cabeceras de
 * baja y la etiqueta `recipient`).
 */

import { MailoutNotConfiguredError, type SendingProvider } from './provider';

export interface SesEnv {
  SES_ACCESS_KEY_ID?: string;
  SES_SECRET_ACCESS_KEY?: string;
  SES_REGION?: string;
}

const SES_REQUIRED = ['SES_ACCESS_KEY_ID', 'SES_SECRET_ACCESS_KEY', 'SES_REGION'] as const;

export function sesMissing(env: SesEnv | null | undefined): string[] {
  return SES_REQUIRED.filter((name) => !env?.[name]);
}

export function sesProvider(env: SesEnv | null | undefined): SendingProvider {
  const missing = sesMissing(env);
  if (missing.length) throw new MailoutNotConfiguredError(missing);
  const notYet = (): never => {
    throw new Error('the SES adapter is not written yet (ADR-111): use the simulator');
  };
  return {
    kind: 'ses',
    registerDomain: async () => notYet(),
    checkDomain: async () => notYet(),
    sendEmail: async () => notYet(),
  };
}
