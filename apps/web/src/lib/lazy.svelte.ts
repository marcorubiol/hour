/**
 * A component that waits for its first use (ADR-157: what the phone
 * downloads to open Hoy). The dialogs of the shell, ⌘K and the records of
 * the vistazo are not needed to paint a lens, so their code arrives the
 * first time one opens and stays: `load()` on open, render `component` once
 * it is there. A load that fails (offline before the service worker had the
 * chunk, a deploy that changed the hashes) is forgotten, so the next open
 * tries again.
 */
export function lazy<T>(importer: () => Promise<{ default: T }>) {
  let component = $state<T | null>(null);
  let pending: Promise<T> | null = null;
  return {
    get component() {
      return component;
    },
    load(): Promise<T> {
      pending ??= importer().then(
        (m) => (component = m.default),
        (err) => {
          pending = null;
          throw err;
        },
      );
      return pending;
    },
  };
}
