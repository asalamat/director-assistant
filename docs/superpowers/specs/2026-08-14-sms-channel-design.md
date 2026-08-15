# SMS Channel — Design Spec

**Date:** 2026-08-14
**Status:** Approved for implementation planning

## Purpose

Cortex Executive Inbox unifies email, LinkedIn DMs, and Instagram DMs into one
inbox, but has no SMS support. Competing products (Front, Missive, Spike) all
unify SMS alongside email. This closes that gap for the smallest, cleanest-fit
channel first — SMS only, no WhatsApp (separate future gap item).

## Constraints

- App is local-first: backend binds `127.0.0.1`, no public server, no
  always-on tunnel infrastructure. Any inbound-message mechanism must not
  require a publicly reachable webhook endpoint.
- Must reuse existing patterns (provider abstraction, poll cycle, social inbox
  schema, AI draft pipeline, keychain secret storage) rather than introduce
  parallel infrastructure.

## Approach: poll, not webhook

Twilio's normal inbound-SMS flow is a webhook POST to a public URL. Since this
app has no public endpoint, we poll Twilio's Messages REST API instead, on the
same cadence as the existing IMAP poll cycle. This trades a few seconds of
latency for zero new infrastructure — acceptable for an executive-assistant
tool where near-real-time (not instant) is the existing bar for every other
channel. Outbound send is a plain REST call regardless of which inbound
approach is used, so this choice only affects the inbound path.

Rejected alternative: webhook + tunnel (ngrok/Cloudflare Tunnel). Gives
real-time delivery but adds an always-on external process that can silently
die, and contradicts the local-first/no-server-infra design of the rest of the
app. Not worth it for a low-volume channel.

## Data model

Reuse the existing `social_inbox` table (`backend/routers/social_inbox.py`)
rather than create a new table — it already stores platform-agnostic
message rows (`sender_name`, `sender_id`, `content`, `type`, `is_read`,
`created_at`).

Changes required:
- `VALID_PLATFORMS` constant (currently `("instagram", "linkedin")`) gains
  `"sms"`.
- The `platform` column's `CHECK(platform IN ('instagram','linkedin'))`
  constraint must be rebuilt to include `'sms'` — SQLite doesn't support
  `ALTER ... DROP CONSTRAINT`, so this needs a migration that creates the new
  table shape, copies rows, drops the old table, renames. Use the project's
  existing migration pattern (see `ruflo-migrations` skill / existing
  migration files) for the up/down pair.
- SMS rows map onto the existing columns as: `platform='sms'`, `type='dm'`
  (SMS has no comment/mention concept), `sender_id`=phone number (E.164),
  `sender_name`=contact-lookup result if the number matches a known contact,
  else the raw number, `content`=message body, `media_url` unused for v1
  (no MMS).

## Backend

**New file: `backend/services/sms_provider.py`** — mirrors the shape of
`imap_provider.py`/`gmail_provider.py` (the existing `EmailProvider`
duck-typed interface family):
- `fetch_new(since_sid: str | None) -> list[dict]` — calls Twilio's Messages
  list API filtered to inbound messages after the given SID/timestamp cursor.
- `send(to: str, body: str) -> str` — calls Twilio's Messages create API,
  returns the new message SID.
- Credentials (`account_sid`, `auth_token`, `from_number`) read via
  `config_secrets.py`'s keychain overlay (`overlay_from_keychain`/
  `protect_to_keychain`), same as other provider credentials — never stored
  as plaintext in the SQLite config table.

**`backend/workers/poll.py`** gains a new step in the existing poll cycle
(alongside the per-account IMAP checks in `_do_poll_cycle_inner`): if SMS
credentials are configured, call `sms_provider.fetch_new()` using a persisted
last-seen SID cursor, and insert new rows into `social_inbox` via the same
insert path `social_inbox.py`'s Instagram/LinkedIn sync already uses. Gated
identically to how IMAP accounts are gated (skip entirely if not configured
— no behavior change for users who don't set up SMS).

**New endpoint** `POST /api/social/inbox/sms/send` (or reuse the existing
generic reply endpoint in `social_inbox.py` with `platform='sms'` — prefer
reuse if the existing reply endpoint's shape supports it; confirm during
implementation) — calls `sms_provider.send()`.

**Settings — Test Connection endpoint**: `POST /api/config/sms/test` sends a
test SMS to the configured `from_number` itself (or an operator-supplied test
number) to confirm credentials work before saving.

## AI drafting

No new AI code path. The existing draft-generation service (used by Smart
Draft and social-platform autopilot) gains a `channel` parameter so the
prompt can bias toward SMS-length output (roughly 160 characters, no
greeting/signature boilerplate) versus email-length. A "Draft Reply" button
on an SMS thread in the frontend calls this with `channel='sms'`.

Explicitly out of scope for v1: urgency/priority triage scoring for SMS,
VIP-alert integration, proactive-alert-engine coverage. SMS volume is
expected to be low enough that a message log + on-demand AI draft is
sufficient; this can be revisited later if usage proves otherwise.

## Settings UI

New card in **Settings → 🔗 Integrations**, modeled directly on the existing
AI Provider setup panel (`AIProvidersPanel.tsx`) pattern:
- Guided copy: "Create a Twilio account → buy a phone number (~$1/mo) → copy
  your Account SID and Auth Token from the Twilio console."
- Three fields: Account SID, Auth Token, From Number (E.164 format).
- "Test Connection" button → calls the test endpoint above, shows
  success/failure inline.
- Save persists credentials via the keychain path, not the plaintext config
  table.

## Frontend

`SocialInbox.tsx` gains a third value in its existing platform filter
(currently Instagram / LinkedIn / All) → Instagram / LinkedIn / SMS / All.
No new component — the existing thread-list rendering, read/unread handling,
and reply composer are platform-agnostic already (they key off the
`platform` field per row), so this is a filter-option addition plus wiring
the new "Draft Reply" channel parameter through the existing reply UI.

## Explicitly out of scope for v1

- MMS / attachments
- Group texts
- WhatsApp (tracked as a separate future gap item, not bundled here)
- Read receipts / delivery status
- Multiple SMS numbers per account
- Urgency triage scoring, VIP alerts, proactive-alert-engine coverage for SMS

## Testing

- Unit test for the SQLite migration (old rows survive, new `'sms'` platform
  value accepted, old code paths querying `platform IN (...)` still work).
- Unit test for `sms_provider.fetch_new()` cursor logic (no duplicate
  messages across polls, correctly picks up new ones).
- Manual verification: send a real test SMS via Settings, confirm it appears
  in Social Inbox, reply via Draft + Send, confirm delivery.
