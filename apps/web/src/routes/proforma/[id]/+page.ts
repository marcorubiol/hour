// Client-only like /h (no anonymous render, no SEO): a thin fetch-and-render
// over /api/invoices/:id/proforma, under the session's cookie.
export const ssr = false;
