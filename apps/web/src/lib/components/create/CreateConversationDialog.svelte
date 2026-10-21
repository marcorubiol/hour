<script lang="ts">
  /**
   * «Añadir conversación» (ADR-051): a person + conversation in one step,
   * POST /api/conversations with inline person fields — the RPC
   * find-or-creates the person on email, so re-typing a known email links
   * the existing file instead of duplicating it.
   *
   * Mounted ONCE by the /h shell and opened through the creation store
   * (ADR-056): the lens's button and ⌘K «Nueva conversación» open the same
   * dialog. It reads the pinned scope itself, so wherever it opens it offers
   * the projects of the scope and preselects a single one (ADR-139 p3:
   * deduce before asking).
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { mutateJSON, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Fold from '$lib/components/Fold.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { toastCreated } from '$lib/created';
  import { localeDayMonth } from '$lib/datetime';
  import { conversationWhoBody } from '$lib/conversation';
  import { conversationAccessQueryOptions } from '$lib/conversation-access';
  import { SALES, scopeTags, tagIdIn, tagLabel } from '$lib/conversation-tags';
  import { conversationTagsQueryOptions } from '$lib/conversation-tags-query';
  import { appLocale, t } from '$lib/i18n';
  import { organizationNames, organizationsQueryOptions } from '$lib/organizations';
  import { usePins } from '$lib/stores/pins.svelte';
  import { spaceName } from '$lib/utils/identity';
  import {
    buildLineIndex,
    buildProjectIndex,
    projectsInScope,
    resolveScope,
    type NavWorkspace,
    type RawLine,
    type RawProject,
  } from '$lib/nav';
  import { activeProjectsQueryOptions, allLinesQueryOptions, workspacesQueryOptions } from '$lib/nav-queries';

  interface Props {
    open?: boolean;
    /** The organization, already typed (⌘K). */
    who?: string;
    /** The tag it is born with: the lens chip's; null = Difusión. */
    tag?: string | null;
  }
  let { open = $bindable(false), who = '', tag = null }: Props = $props();

  const locale = appLocale();
  const pins = usePins();
  const queryClient = useQueryClient();

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const accessQuery = createQuery(conversationAccessQueryOptions());
  // The directory waits for an explicit yes (ADR-124).
  const organizationsQuery = createQuery(
    toStore(() => organizationsQueryOptions(open && $accessQuery.data?.edit === true)),
  );
  const tagsQuery = createQuery(toStore(() => conversationTagsQueryOptions($accessQuery.data?.read !== false)));

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let projectIndex = $derived(buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(buildLineIndex(workspaces, ($linesQuery.data?.items as RawLine[]) ?? []));
  let scope = $derived(resolveScope(pins.pins, workspaces, lineIndex, projectIndex));
  let scopeWorkspaceIds = $derived(
    scope.isEmpty
      ? workspaces.map((w) => w.id)
      : [...new Set([...scope.workspaceIds, ...scope.projects.map((p) => p.workspaceId), ...scope.lines.map((l) => l.workspaceId)])],
  );
  let tagNames = $derived($tagsQuery.data ? scopeTags($tagsQuery.data, scopeWorkspaceIds) : []);

  // A contact can live in several spaces at once (person is global, deduped
  // on email; belonging to a space = an conversation in one of its projects).
  // So the target is a SET of projects, grouped by space in the picker.
  let aProjectIds = $state<string[]>([]);
  // Optional line per targeted project (ADR-056) — the target is a set of
  // projects, so one global select can't work; each checked project gets its
  // own. Unset key = "No line".
  let aLineByProject = $state<Record<string, string>>({});
  let aName = $state('');
  let aEmail = $state('');
  let aPhone = $state('');
  let aOrg = $state('');
  let aNextAt = $state('');
  let aNextNote = $state('');
  // ADR-138 fase 2: the tag it is born with; the chip's, or Difusión.
  let aTag = $state(SALES);
  let tagOptions = $derived(
    (tagNames.length > 0 ? tagNames : [{ key: SALES, label: null, labels: {} }]).map((x) => ({ value: x.key, label: tagLabel(x, locale) })),
  );
  // «Más»: phone, tag and next step, folded; the lid says the tag and the day.
  let aMoreOpen = $state(false);
  let addMoreKeeps = $derived(
    [tagOptions.find((o) => o.value === aTag)?.label, aNextAt ? localeDayMonth(aNextAt, locale) : null]
      .filter(Boolean)
      .join(' · '),
  );

  // The picker offers only the projects of the current scope (drop 11-10):
  // a space offers its projects, a project or line that project, Everything
  // all of them.
  let scopedProjects = $derived<RawProject[]>(projectsInScope(scope, $projectsQuery.data?.items ?? []));
  // Projects grouped under the space (workspace) they belong to — the picker
  // reads as "which spaces (and which project inside them)".
  let projectGroups = $derived.by(() => {
    const wsName = new Map(workspaces.map((w) => [w.id, w.name]));
    const byWs = new Map<string, { wsId: string; wsName: string; projects: { id: string; name: string }[] }>();
    for (const p of scopedProjects) {
      let g = byWs.get(p.workspace_id);
      if (!g) {
        // Chokepoint: the only place this group's space label is built.
        g = { wsId: p.workspace_id, wsName: spaceName(wsName.get(p.workspace_id) ?? t('workspace.fallback', locale)), projects: [] };
        byWs.set(p.workspace_id, g);
      }
      g.projects.push({ id: p.id, name: p.name ?? p.slug });
    }
    return [...byWs.values()];
  });
  // Line options per project, from the same lines cache the scope resolver
  // reads (lineIndex) — only projects that actually have lines get a select.
  let linesByProject = $derived.by(() => {
    const byProject = new Map<string, { value: string; label: string }[]>();
    for (const l of lineIndex) {
      const opts = byProject.get(l.projectId);
      if (opts) opts.push({ value: l.id, label: l.name });
      else byProject.set(l.projectId, [{ value: l.id, label: l.name }]);
    }
    return byProject;
  });

  function toggleProject(id: string) {
    if (aProjectIds.includes(id)) {
      aProjectIds = aProjectIds.filter((x) => x !== id);
      return;
    }
    // The line Select binds `aLineByProject[id]`: binding `undefined` to a
    // prop with a fallback throws (svelte props_invalid_value), so a checked
    // project always has a key; '' is «No line».
    aLineByProject = { ...aLineByProject, [id]: aLineByProject[id] ?? '' };
    aProjectIds = [...aProjectIds, id];
  }

  // ADR-102: the organization completes from those of the chosen spaces (all
  // of yours while none is chosen).
  let orgSuggestions = $derived.by(() => {
    const chosen = new Set(aProjectIds);
    const wsIds = ($projectsQuery.data?.items ?? []).filter((p) => chosen.has(p.id)).map((p) => p.workspace_id);
    return organizationNames($organizationsQuery.data?.items ?? [], wsIds);
  });

  /** The 409 of a person whose organization already has a conversation in that
      project: offered as «Añadir como contacto» instead of «ya existía». */
  type Join = { conversationId: string; projectName: string };
  let aJoin = $state<Join[]>([]);
  let aJoinPersonId = $state<string | null>(null);

  // Open fresh every time — leftover text from a cancelled attempt must never
  // ride into a new contact. Only what the door brings (⌘K's text, the chip's
  // tag) and what the scope says are in.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      aJoin = [];
      aJoinPersonId = null;
      aName = '';
      aEmail = '';
      aPhone = '';
      aOrg = who;
      aNextAt = '';
      aNextNote = '';
      aMoreOpen = false;
      aTag = tag ?? SALES;
      // Pre-select when the scope collapses to a single project — otherwise
      // start empty and let the user pick spaces. A single pinned line also
      // preselects that line for its project.
      aProjectIds =
        scope.lines.length === 1
          ? [scope.lines[0].projectId]
          : scopedProjects.length === 1
            ? [scopedProjects[0].id]
            : [];
      aLineByProject =
        scope.lines.length === 1
          ? { [scope.lines[0].projectId]: scope.lines[0].id }
          : Object.fromEntries(aProjectIds.map((id) => [id, '']));
      errSpaces = undefined;
      errWho = undefined;
    }
    wasOpen = open;
  });

  type AddResult = {
    created: number;
    existed: number;
    failed: string[];
    joinable: Join[];
    personId: string | null;
    untagged: number;
    /** What «Deshacer» deletes. */
    ids: string[];
  };

  const addMutation = createMutation({
    // One contact, N spaces → N conversations. Sequential, not parallel: the
    // first insert find-or-creates the person (by email) and returns its id;
    // every later insert links that same person_id. This keeps a no-email
    // contact from spawning a duplicate person per space, and avoids a race
    // on the citext-unique email.
    mutationFn: async (): Promise<AddResult> => {
      const targets = [...aProjectIds];
      const lineFor = { ...aLineByProject };
      // ADR-102: the person is optional; the organization alone is enough.
      const whoBody = conversationWhoBody({ name: aName, email: aEmail, phone: aPhone, organization: aOrg }) ?? {};
      const base = {
        next_action_at: aNextAt || null,
        next_action_note: aNextNote.trim() || null,
      };
      let personId: string | null = null;
      const out: AddResult = { created: 0, existed: 0, failed: [], joinable: [], personId: null, untagged: 0, ids: [] };
      const vocab = $tagsQuery.data;
      const workspaceOf = (id: string) => ($projectsQuery.data?.items ?? []).find((p) => p.id === id)?.workspace_id;
      /** The chosen tag in that project's space; Difusión if the space does not use it. */
      const tagIdsFor = (projectId: string): string[] | undefined => {
        const ws = workspaceOf(projectId);
        const id = vocab && ws ? (tagIdIn(vocab, ws, aTag) ?? tagIdIn(vocab, ws, SALES)) : null;
        return id ? [id] : undefined;
      };
      const projectName = (id: string) =>
        ($projectsQuery.data?.items ?? []).find((p) => p.id === id)?.name ?? t('conversations.conversation', locale);

      for (const projectId of targets) {
        const line_id = lineFor[projectId] || null;
        const tag_ids = tagIdsFor(projectId);
        const body: Record<string, unknown> = personId
          ? { project_id: projectId, person_id: personId, line_id, tag_ids, ...base }
          : { project_id: projectId, ...whoBody, line_id, tag_ids, ...base };
        try {
          const data = await mutateJSON<{
            conversation?: { id?: string };
            primary_person_id?: string | null;
            tagged?: boolean;
          }>('POST', '/api/conversations', body);
          out.created += 1;
          if (data?.conversation?.id) out.ids.push(data.conversation.id);
          if (data?.tagged === false || !tag_ids) out.untagged += 1;
          if (!personId && data?.primary_person_id) personId = data.primary_person_id;
        } catch (e) {
          const clash = e instanceof ApiError && e.status === 409 ? e.body?.conversation_id : null;
          if (typeof clash === 'string' && ('person' in whoBody || Boolean(personId))) {
            // Its organization already talks with this project: offer the
            // person as a contact of that conversation (ADR-102).
            out.joinable.push({ conversationId: clash, projectName: projectName(projectId) });
          } else if (e instanceof ApiError && e.status === 409) {
            // Already has a conversation in this project — not an error.
            out.existed += 1;
          } else {
            out.failed.push(e instanceof Error ? e.message : t('perf.unexpected', locale));
          }
        }
      }
      // Nothing landed and something broke → surface it as an error.
      out.personId = personId;
      if (out.created === 0 && out.existed === 0 && out.joinable.length === 0 && out.failed.length > 0) {
        throw new Error(out.failed[0]);
      }
      return out;
    },
    onSuccess: (r) => {
      if (r.joinable.length > 0) {
        // The dialog stays open with the offer; what was created is already in.
        aJoin = r.joinable;
        aJoinPersonId = r.personId;
        if (r.created) void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        void queryClient.invalidateQueries({ queryKey: ['organizations'] });
        return;
      }
      open = false;
      aName = '';
      aEmail = '';
      aPhone = '';
      aOrg = '';
      aNextAt = '';
      aNextNote = '';
      aProjectIds = [];
      aLineByProject = {};
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      const parts: string[] = [];
      if (r.created)
        parts.push(
          t(r.created === 1 ? 'conversations.added_one' : 'conversations.added_other', locale, {
            n: r.created,
          }),
        );
      if (r.existed) parts.push(t('conversations.already_in', locale, { n: r.existed }));
      if (r.failed.length) parts.push(t('conversations.failed_n', locale, { n: r.failed.length }));
      if (r.untagged) parts.push(t('conversations.tag_not_set', locale));
      const message = `${parts.join(' · ')}.`;
      if (r.failed.length || r.untagged) {
        addToast({ tone: 'warning', message });
        return;
      }
      // ADR-139 p7: an add ends with one notice, and «Deshacer» deletes it.
      const ids = r.ids;
      toastCreated({
        locale,
        message,
        undo: ids.length
          ? async () => {
              await Promise.all(ids.map((id) => mutateJSON('DELETE', `/api/conversations/${id}`)));
              await queryClient.invalidateQueries({ queryKey: ['conversations'] });
            }
          : undefined,
      });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('conversations.not_added', locale),
        message: `${err instanceof Error ? err.message : t('perf.unexpected', locale)}`,
      });
    },
  });

  const joinMutation = createMutation({
    mutationFn: async () => {
      const body = aJoinPersonId
        ? { person_id: aJoinPersonId }
        : { person: { full_name: aName.trim(), email: aEmail.trim() || null, phone: aPhone.trim() || null } };
      for (const j of aJoin) {
        await mutateJSON('POST', `/api/conversations/${j.conversationId}/contacts`, body);
      }
    },
    onSuccess: () => {
      addToast({ tone: 'success', message: t('conversations.contact_added', locale, { name: aName.trim() }) });
      open = false;
      aJoin = [];
      aJoinPersonId = null;
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('conversations.not_added', locale),
        message: `${err instanceof Error ? err.message : t('perf.unexpected', locale)}`,
      });
    },
  });

  /** What is missing, said under its field (ADR-139 p7), never as a toast. */
  let errSpaces = $state<string | undefined>();
  let errWho = $state<string | undefined>();
  $effect(() => {
    void aProjectIds.length;
    errSpaces = undefined;
  });
  $effect(() => {
    void aName;
    void aOrg;
    errWho = undefined;
  });
  let addFormEl: HTMLFormElement | undefined = $state();

  /** Runs from the form's submit: Enter in any field, ⌘↵ or the button. */
  function submitAdd() {
    if (aProjectIds.length === 0) errSpaces = t('conversations.pick_space', locale);
    if (!aName.trim() && !aOrg.trim()) errWho = t('conversations.needs_name', locale);
    if (errSpaces || errWho) {
      // «Who» comes first, so its field takes the focus first.
      if (errWho) document.getElementById('conversations-add-org')?.focus();
      return;
    }
    $addMutation.mutate();
  }
</script>

<Dialog bind:open title={t('conversations.add', locale)} size="m">
  <!-- A form, so Enter in any field adds (ADR-139 p7); the errors are its own. -->
  <form
    class="conversations__add"
    bind:this={addFormEl}
    onsubmit={(e) => {
      e.preventDefault();
      submitAdd();
    }}
  >
  <!-- The order is what one has in mind: who, for which production, then the
       rest folded (ADR-139 p3: deduce before asking; the scope preselects the
       project). -->
  <div class="conversations__form-grid">
    <Input
      id="conversations-add-org"
      label={t('conversations.col_organization', locale)}
      bind:value={aOrg}
      error={errWho}
      placeholder={t('conversations.org_ph', locale)}
      list="conversations-org-list"
      autocomplete="off"
    />
    <datalist id="conversations-org-list">
      {#each orgSuggestions as name (name)}<option value={name}></option>{/each}
    </datalist>
    <Input label={t('conversations.full_name', locale)} bind:value={aName} />
    <Input label={t('conversations.email', locale)} type="email" bind:value={aEmail} />
  </div>
  {#if aJoin.length > 0}
    <div class="conversations__join" role="status">
      <p>
        {t('conversations.org_has_conversation', locale, {
          org: aOrg.trim() || t('conversations.col_organization', locale),
          projects: aJoin.map((j) => j.projectName).join(', '),
        })}
      </p>
      <Button size="s" onclick={() => $joinMutation.mutate()} loading={$joinMutation.isPending}>
        {t('conversations.add_as_contact', locale)}
      </Button>
    </div>
  {/if}
  <fieldset class="conversations__spaces">
    <legend class="eyebrow eyebrow--sub">
      {t('picker.projects', locale)} <span class="conversations__field-hint">{t('conversations.spaces_hint', locale)}</span>
    </legend>
    {#if projectGroups.length === 0}
      <p class="conversations__field-hint">{t('conversations.no_projects', locale)}</p>
    {:else}
      <div class="conversations__space-groups">
        {#each projectGroups as g (g.wsId)}
          <div class="conversations__space-group">
            <!-- The space only names a group when there is more than one. -->
            {#if projectGroups.length > 1}<p class="conversations__space-name">{g.wsName}</p>{/if}
            {#each g.projects as p (p.id)}
              <Checkbox
                label={p.name}
                checked={aProjectIds.includes(p.id)}
                onchange={() => toggleProject(p.id)}
              />
              {#if aProjectIds.includes(p.id) && (linesByProject.get(p.id)?.length ?? 0) > 0}
                <div class="conversations__line">
                  <Select
                    label={t('create.line', locale)}
                    options={[{ value: '', label: t('create.line_none', locale) }, ...(linesByProject.get(p.id) ?? [])]}
                    bind:value={aLineByProject[p.id]}
                  />
                </div>
              {/if}
            {/each}
          </div>
        {/each}
      </div>
    {/if}
    {#if errSpaces}<p class="form-error" role="alert">{errSpaces}</p>{/if}
  </fieldset>
  <!-- Closed, the lid still says what it keeps: the tag, and the next step's
       day once there is one. -->
  <div class="conversations__more">
    <Fold word={t('conversations.add_more', locale)} keeps={addMoreKeeps} bind:open={aMoreOpen}>
      <div class="conversations__form-grid">
        <Input label={t('conversations.phone', locale)} type="tel" bind:value={aPhone} />
        <Select label={t('conversations.tag', locale)} options={tagOptions} bind:value={aTag} />
        <Input label={t('conversations.col_next_action', locale)} type="date" bind:value={aNextAt} />
        <Input
          label={t('conversations.next_note', locale)}
          bind:value={aNextNote}
          placeholder={t('conversations.next_note_ph', locale)}
        />
      </div>
    </Fold>
  </div>
  <!-- Hidden submit lets Enter inside an input trigger submit. -->
  <button type="submit" hidden aria-hidden="true"></button>
  </form>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={() => addFormEl?.requestSubmit()} loading={$addMutation.isPending}
      >{t('conversations.add', locale)}</Button
    >
  {/snippet}
</Dialog>

<style>
  @layer components {
    .conversations__join {
      display: flex;
      gap: var(--space-s);
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      margin-block-start: var(--space-m);
      padding: var(--space-s) var(--space-m);
      border: var(--border);
      border-radius: var(--radius-s);
      font-size: var(--text-s);
    }

    .conversations__add {
      display: contents;
    }

    .conversations__more {
      margin-block-start: var(--space-m);
    }

    /* Multi-space picker — projects grouped under their space. */
    .conversations__spaces {
      border: 0;
      padding: 0;
      margin-block-start: var(--space-m);
    }
    .conversations__spaces > legend {
      padding: 0;
    }
    .conversations__field-hint {
      color: var(--text-faint);
      text-transform: none;
      letter-spacing: normal;
      font-family: var(--font-sans);
    }
    .conversations__space-groups {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--space-s) var(--space-m);
      margin-block-start: var(--space-s);
    }
    .conversations__space-group {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    /* Per-project line select — indented under its project checkbox. */
    .conversations__line {
      margin-inline-start: calc(var(--check-size) + var(--space-s));
    }

    .conversations__space-name {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-m);
      /* No uppercase: this label is only ever a space name. */
      color: var(--text-faint);
      margin-block-end: var(--space-2xs);
    }

    /* Rows, one under the other (ADR-139 p4); the groups only keep the
       order and a breath between them. */
    .conversations__form-grid {
      display: flex;
      flex-direction: column;
      margin-block-start: var(--space-s);
    }
  }
</style>
