import type { Page } from '@playwright/test';

/**
 * The line the inline conversation row lives on (ADR-177 § 4: the
 * organization's record no longer draws the table; a line's Conversations
 * module still does, ADR-056). A campaign line of the fixture project
 * `zzz-e2e-collab` in `playwright`, found by name or created once: lines have
 * no delete path, so it is stable and reused, as in `line-detail.spec.ts`.
 * The page must already be on an app origin (the fetches are relative).
 */
export const INLINE_LINE_NAME = 'ZZZ E2E Inline Row';

export type FixtureLine = {
  id: string;
  slug: string | null;
  projectId: string;
};

export async function fixtureLine(page: Page): Promise<FixtureLine> {
  return page.evaluate(async (name): Promise<FixtureLine> => {
    const wsBody = (await fetch('/api/workspaces').then((r) => r.json())) as {
      items: Array<{ id: string; slug: string }>;
    };
    const ws = wsBody.items.find((w) => w.slug === 'playwright');
    if (!ws) throw new Error('no fixture workspace');
    const prBody = (await fetch('/api/projects?status=active').then((r) => r.json())) as {
      items: Array<{ id: string; slug: string; workspace_id: string }>;
    };
    const project = prBody.items.find((p) => p.workspace_id === ws.id && p.slug === 'zzz-e2e-collab');
    if (!project) throw new Error('no fixture project in the fixture workspace');
    const list = (await fetch(`/api/lines?project_id=${project.id}&status=any`).then((r) => r.json())) as {
      items: Array<{ id: string; slug: string | null; name: string }>;
    };
    const found = list.items.find((l) => l.name === name);
    if (found) return { id: found.id, slug: found.slug, projectId: project.id };
    const res = await fetch('/api/lines', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, name, kind: 'campaign' }),
    });
    if (!res.ok) throw new Error(`could not create the fixture line (${res.status})`);
    const { line } = (await res.json()) as {
      line: { id: string; slug: string | null };
    };
    return { id: line.id, slug: line.slug, projectId: project.id };
  }, INLINE_LINE_NAME);
}

export function fixtureLineHref(line: FixtureLine): string {
  return `/h/playwright/project/zzz-e2e-collab/line/${line.slug ?? line.id}`;
}
