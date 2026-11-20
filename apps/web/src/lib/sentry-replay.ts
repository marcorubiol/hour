/**
 * Isolated entry for Sentry Replay so Rollup splits `rrweb` (~100+ kB br) into
 * an async chunk that loads after first paint instead of blocking mobile boot.
 */
export { replayIntegration } from '@sentry/sveltekit';
