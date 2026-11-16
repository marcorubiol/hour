<script lang="ts">
  /**
   * «Añadir gasto» from the shell (163): Cuentas' button and ⌘K open it
   * through the creation store. The one expense dialog (ADR-170) with the
   * anchors of the scope: the bolos Cuentas lists, from the same feed, and
   * their lines. A record that knows its bolo or line (the bolo's, the line's
   * Money module) still mounts `ExpenseDialog` with that one anchor.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import ExpenseDialog from '$lib/components/ExpenseDialog.svelte';
  import { scopeBolosQueryOptions } from '$lib/bolo-queries';
  import { expenseAnchors } from '$lib/expense';
  import { appLocale } from '$lib/i18n';
  import { boloInScope } from '$lib/money';
  import type { NavLine, ResolvedScope } from '$lib/nav';

  interface Props {
    open?: boolean;
    scope: ResolvedScope;
    lines: NavLine[];
    anchor?: string;
    currency?: string;
    description?: string;
  }
  let { open = $bindable(false), scope, lines, anchor, currency, description }: Props = $props();

  const locale = appLocale();
  const bolosQuery = createQuery(
    toStore(() => scopeBolosQueryOptions({ projectIds: scope.projectIds, workspaceIds: scope.workspaceIds }, open)),
  );
  let bolos = $derived(($bolosQuery.data?.items ?? []).filter((b) => boloInScope(scope, b)));
  let lineById = $derived(new Map(lines.map((l) => [l.id, l])));
  let anchors = $derived(expenseAnchors(bolos, lineById, locale));
  // Cuentas' rule: the first currency of the bolos on screen, unless the door says.
  let fallbackCurrency = $derived([...new Set(bolos.map((b) => b.fee_currency ?? 'EUR'))].sort()[0] ?? 'EUR');
</script>

<ExpenseDialog bind:open {anchors} {anchor} currency={currency ?? fallbackCurrency} {description} />
