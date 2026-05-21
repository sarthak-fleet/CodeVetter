/**
 * Owner-facing analytics — the fixed 4-event taxonomy, adapted for a desktop app.
 *
 * Every project in the fleet emits exactly these four events so PostHog can
 * build one cross-fleet funnel (signup -> activated -> core_action) and a
 * D1/D7 retention insight without any custom dashboard.
 *
 * CodeVetter is a local Tauri desktop app — it has no accounts and no server,
 * so it does NOT depend on `@saas-maker/posthog-client`. Instead it posts to
 * the PostHog capture API directly from the webview, keyed by a stable
 * anonymous install ID. The taxonomy is mapped to desktop usage:
 *
 *   signup      — the first ever launch on this install (the "account" moment).
 *   activated   — the user's first successful code review run (first real value).
 *   core_action — each review run or repo unpack (the thing the product does).
 *   returned    — a launch by an install that already has prior activity.
 *
 * Every event carries `project: "CodeVetter"`. Analytics must NEVER break a
 * user flow — every path here is wrapped and best-effort.
 */

const PROJECT = 'CodeVetter' as const;

// Same PostHog project as the landing page (apps/landing-page/app/layout.tsx).
const POSTHOG_KEY = 'phc_qgiAarw4Co4pw9fz3Fxj4UJaHmqzFetqs4JrXhGc35Nd';
const POSTHOG_HOST = 'https://us.i.posthog.com';

/** The product-specific action behind a `core_action` event. */
export type CoreAction = 'review_run' | 'repo_unpack';

const INSTALL_ID_KEY = 'codevetter_install_id';
const FIRST_LAUNCH_KEY = 'codevetter_first_launch_done';
const ACTIVATED_KEY = 'codevetter_activated';

/**
 * A stable anonymous identifier for this install. Generated once and persisted
 * to localStorage. Carries no PII — it only lets PostHog stitch a single
 * install's sessions into a funnel / retention cohort.
 */
function getInstallId(): string {
  try {
    let id = localStorage.getItem(INSTALL_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `cv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(INSTALL_ID_KEY, id);
    }
    return id;
  } catch {
    return `${PROJECT}-anon`;
  }
}

/** Fire-and-forget capture. Best-effort: never blocks or throws into a flow. */
function emit(event: string, props: Record<string, unknown>): void {
  try {
    const payload = { project: PROJECT, ...props };
    void fetch(`${POSTHOG_HOST}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event,
        distinct_id: getInstallId(),
        properties: payload,
      }),
    }).catch(() => {
      // Swallow — analytics is best-effort only.
    });
  } catch {
    // Analytics must never break a user flow.
  }
}

/**
 * Fire on app startup. Emits `signup` on the very first launch of this install,
 * and `returned` on every later launch where the install has prior activity.
 * Safe to call on every mount — it self-dedupes via localStorage.
 */
export function trackAppLaunch(): void {
  try {
    const firstLaunchDone = localStorage.getItem(FIRST_LAUNCH_KEY) === 'true';
    if (!firstLaunchDone) {
      localStorage.setItem(FIRST_LAUNCH_KEY, 'true');
      emit('signup', {});
      return;
    }
    // Returning install — only counts if they have prior real activity.
    if (localStorage.getItem(ACTIVATED_KEY) === 'true') {
      emit('returned', {});
    }
  } catch {
    // Ignore — analytics is best-effort.
  }
}

/**
 * Fire when the user completes a core action (review run or repo unpack).
 * On the FIRST successful action this also emits `activated` (first real value).
 */
export function trackCoreAction(action: CoreAction): void {
  try {
    if (localStorage.getItem(ACTIVATED_KEY) !== 'true') {
      localStorage.setItem(ACTIVATED_KEY, 'true');
      emit('activated', {});
    }
  } catch {
    // Ignore — still emit the core_action below.
  }
  emit('core_action', { action });
}
