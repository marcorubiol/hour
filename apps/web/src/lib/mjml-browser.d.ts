// mjml-browser no trae tipos: lo único que usa Hour (MailDesignEditor, ADR-192).
declare module 'mjml-browser' {
  export default function mjml2html(
    mjml: string,
    options?: { validationLevel?: 'strict' | 'soft' | 'skip'; minify?: boolean },
  ): Promise<{ html: string; errors: { message: string }[] }>;
}
