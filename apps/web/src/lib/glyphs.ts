/**
 * The marks a dashboard prints instead of a value. `DASH` means «no truth
 * yet» (loading, or nothing to count): never a 0, which reads as a fact.
 * The Planner's season view has its own copy (`SeasonOverview.svelte`) that
 * should import this one.
 */
export const DASH = '–';
