'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireTenant, type Tenant } from '@/lib/tenant';
import {
  addJobs,
  logJobEvent,
  saveProfile,
  setupJobs,
  trashJob,
  updateJob,
  JobsError,
  type Actor,
} from '@/lib/jobs-notion';
import { coerceStatus, parseEventInput, parseJobPatch, parseNewJob, parseProfile } from '@/lib/jobs';
import { countActiveApiKeys, createApiKey, ensureSchema, revokeApiKey } from '@/lib/db';
import { MAX_ACTIVE_KEYS, cleanKeyName, generateApiKey } from '@/lib/api-keys';

/**
 * Every action resolves the tenant from the session cookie, exactly like the
 * task actions. The browser sends a job id and form fields — never a token, a
 * workspace or a user id.
 *
 * Failures come back as a message instead of being thrown. A thrown action
 * reaches the route error boundary and replaces the whole page with "That did
 * not load", which is a poor answer to "Notion was busy for a second".
 */

export type ActionState = { ok: boolean; message: string } | null;

const you = (t: Tenant): Actor => ({ kind: 'You', name: t.username });

function problem(e: unknown): { ok: false; message: string } {
  if (e instanceof JobsError) return { ok: false, message: e.message };
  if ((e as { friendly?: boolean })?.friendly) return { ok: false, message: (e as Error).message };
  console.error('[jobs action]', (e as Error)?.message ?? e);
  return { ok: false, message: 'That did not save. Try again in a moment.' };
}

function revalidateJobs(id?: string) {
  revalidatePath('/jobs');
  if (id) revalidatePath(`/jobs/${id}`);
}

export async function setupJobsAction(): Promise<ActionState> {
  try {
    const t = await requireTenant();
    await setupJobs(t);
  } catch (e) {
    return problem(e);
  }
  revalidateJobs();
  return { ok: true, message: 'Job tracking is ready.' };
}

export async function setJobStatusAction(id: string, raw: string): Promise<ActionState> {
  const status = coerceStatus(raw);
  if (!status) return { ok: false, message: 'Unknown status.' };
  try {
    const t = await requireTenant();
    const job = await updateJob(t, id, { status }, you(t));
    if (!job) return { ok: false, message: 'That job is no longer in your tracker.' };
  } catch (e) {
    return problem(e);
  }
  revalidateJobs(id);
  return { ok: true, message: `Moved to ${status}.` };
}

export async function updateJobAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const patch = parseJobPatch(Object.fromEntries(form));
  if (!patch.ok) return { ok: false, message: sentence(patch.error) };
  try {
    const t = await requireTenant();
    const job = await updateJob(t, id, patch.value, you(t));
    if (!job) return { ok: false, message: 'That job is no longer in your tracker.' };
  } catch (e) {
    return problem(e);
  }
  revalidateJobs(id);
  return { ok: true, message: 'Saved.' };
}

export async function logJobEventAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const input = parseEventInput({
    kind: form.get('kind'),
    text: form.get('text'),
    date: form.get('date') || undefined,
    move_status: form.get('move_status') === 'on',
  });
  if (!input.ok) return { ok: false, message: sentence(input.error) };
  try {
    const t = await requireTenant();
    const r = await logJobEvent(t, id, input.value, you(t));
    if (!r) return { ok: false, message: 'That job is no longer in your tracker.' };
    revalidateJobs(id);
    return { ok: true, message: r.warning ?? (r.movedTo ? `Logged, and moved to ${r.movedTo}.` : 'Logged.') };
  } catch (e) {
    return problem(e);
  }
}

export async function addJobAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = parseNewJob(Object.fromEntries(form), { status: 'Shortlisted' });
  if (!parsed.ok) return { ok: false, message: sentence(parsed.error) };
  let id: string;
  try {
    const t = await requireTenant();
    const r = await addJobs(t, [parsed.value], you(t));
    if (r.duplicates.length) {
      return { ok: false, message: `Already in your tracker (${r.duplicates[0].reason}).` };
    }
    if (!r.created.length) return { ok: false, message: r.errors[0]?.error ?? 'That did not save.' };
    id = r.created[0].id;
  } catch (e) {
    return problem(e);
  }
  revalidateJobs();
  redirect(`/jobs/${id}`);
}

export async function trashJobAction(id: string): Promise<ActionState> {
  try {
    const t = await requireTenant();
    await trashJob(t, id);
  } catch (e) {
    return problem(e);
  }
  revalidateJobs();
  redirect('/jobs');
}

export async function saveProfileAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const raw: Record<string, unknown> = Object.fromEntries(form);
  raw.work_modes = form.getAll('work_modes');
  const parsed = parseProfile(raw);
  if (!parsed.ok) return { ok: false, message: sentence(parsed.error) };
  try {
    const t = await requireTenant();
    await saveProfile(t, parsed.value);
  } catch (e) {
    return problem(e);
  }
  revalidatePath('/jobs/profile');
  return { ok: true, message: 'Profile saved. Your AI tools will use it on the next search.' };
}

// ---------------------------------------------------------------------------
// Connecting AI tools
// ---------------------------------------------------------------------------

export type NewKeyState = { ok: true; key: string; prefix: string; name: string } | { ok: false; message: string } | null;

/**
 * Makes a personal key. The key is returned once, here, and never again: only
 * its hash is stored, so the page shows it while it is open and that is the
 * only chance to copy it.
 */
export async function createApiKeyAction(_prev: NewKeyState, form: FormData): Promise<NewKeyState> {
  try {
    const t = await requireTenant();
    await ensureSchema();
    if ((await countActiveApiKeys(t.userId)) >= MAX_ACTIVE_KEYS) {
      return { ok: false, message: `You have ${MAX_ACTIVE_KEYS} keys already. Revoke one you no longer use first.` };
    }
    const name = cleanKeyName(form.get('name'));
    const k = generateApiKey();
    await createApiKey(t.userId, { name, prefix: k.prefix, hash: k.hash });
    revalidatePath('/jobs/connect');
    return { ok: true, key: k.key, prefix: k.prefix, name };
  } catch (e) {
    return problem(e);
  }
}

export async function revokeApiKeyAction(id: string): Promise<ActionState> {
  try {
    const t = await requireTenant();
    const done = await revokeApiKey(t.userId, id);
    if (!done) return { ok: false, message: 'That key was already revoked.' };
  } catch (e) {
    return problem(e);
  }
  revalidatePath('/jobs/connect');
  return { ok: true, message: 'Revoked. Anything using that key stops working now.' };
}

/** Parser errors read as fragments ("role is required"); a form wants a sentence. */
function sentence(s: string): string {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.');
}
