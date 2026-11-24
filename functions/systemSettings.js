/**
 * The Admin Portal's notification preferences, as the Cloud Functions see
 * them (schema: web-portal/packages/shared/src/lib/systemSettingsStore.js).
 *
 *   system_settings/operations.push.enabled   resident push notifications —
 *                                             report updates and "help is on
 *                                             the way". The SOS fan-out to
 *                                             on-duty officers does NOT read it.
 *
 * ── DEFAULTS ARE THE ORIGINAL BEHAVIOUR ────────────────────────────────────
 * A missing document, a missing field or a failed read all mean "send". A
 * settings outage must never be what silences a notification.
 *
 * ── CACHED BRIEFLY ─────────────────────────────────────────────────────────
 * Cached per warm instance for SETTINGS_TTL_MS, so a burst of status changes
 * costs one settings read rather than one each, and a change an administrator
 * saves still applies within seconds.
 */

const admin = require("firebase-admin");

const SETTINGS_TTL_MS = 15 * 1000;

let cache = { at: 0, value: null };

async function loadSettings() {
  if (cache.value && Date.now() - cache.at < SETTINGS_TTL_MS) return cache.value;
  let value = {};
  try {
    const snap = await admin.firestore().doc("system_settings/operations").get();
    value = snap.exists ? snap.data() : {};
  } catch (err) {
    console.error("[settings] read failed; sending as normal", err);
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Are resident push notifications on? Anything but an explicit `false` means yes. */
async function residentPushEnabled() {
  const settings = await loadSettings();
  return settings?.push?.enabled !== false;
}

/**
 * The raw stored document, cached. Exported for the operations sweep, which
 * needs four numbers out of it rather than one boolean and clamps them itself
 * (see sweepRules.sweepSettings).
 */
module.exports = { residentPushEnabled, loadSettings };
