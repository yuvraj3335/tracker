/**
 * Which screen the setup route should show.
 *
 * Pulled out of the route as a pure function because the decision has real
 * edge cases — a failed provision means different things depending on how far
 * it got — and because the route itself cannot be tested without a database
 * and a live Notion workspace.
 */
import type { TenantStatus } from './tenant';

/** The connection states the setup route has to route on. */
export type ConnectionState = Exclude<TenantStatus['kind'], 'anonymous'>;

export type SetupStage =
  /** No Notion token stored yet. */
  | 'token'
  /** Token accepted, but no page has been shared with the integration. */
  | 'page'
  /** Databases exist and the 456 questions are going in. */
  | 'seeding'
  /** Everything is wired up. This is where an already-connected user lands. */
  | 'connected';

export function setupStage(state: ConnectionState, hasDatabases: boolean): SetupStage {
  if (state === 'ready') return 'connected';
  if (state === 'needs_token') return 'token';
  if (state === 'needs_page') return 'page';
  // A provision that failed before any database existed has nothing to resume,
  // so it goes back to the page step rather than showing an empty progress bar.
  if (state === 'error') return hasDatabases ? 'seeding' : 'page';
  return 'seeding';
}
