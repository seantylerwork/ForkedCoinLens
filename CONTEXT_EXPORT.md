# CoinLens — session context export (2026-09-12)

Purpose: capture everything done in today's session — implementation,
assumptions, and a live production bug — so it can be pasted as context into
a future session without re-deriving it.

Branch: `seperate`. Latest pushed commit: `55bc51e` (origin/seperate).

---

## 1. What was built today, in order

### 1a. Full E2E prototype build-out (Milestones 0–8)

Replaced the mock-only scan flow with the real architecture:

```
Expo (Supabase Auth JWT) -> Flask (verify JWT, OpenAI + Numista + optional
PCGS, authoritative persistence) -> Supabase scans (RLS) -> Expo reads own
data under RLS; leaderboard via a Supabase RPC returning aggregates only.
```

Server (`server/app.py` and friends):
- **Identification**: single OpenAI **Responses API** call (not Chat
  Completions), structured JSON-schema output, model set by `OPENAI_MODEL`
  (default `gpt-4o-mini`). Replaced the old 4-call chain (free-text
  description → JSON extraction → separate valuation guess → separate
  summary call). Called via raw `requests.post` to
  `https://api.openai.com/v1/responses`, not the `openai` SDK.
- **Valuation**: Numista-first. `search_numista_types` → `score_numista_candidate`
  (country/denomination/year scoring) → `select_best_numista_match` (requires
  an unambiguous top score, ≥3, with no tie) → `fetch_numista_price` (grade-aware).
  Reports `status: "unavailable"` rather than inventing a number on any weak
  or ambiguous match. PCGS (`lookup_pcgs`) is a pure optional fallback, only
  used when Numista has no price.
- **Persistence**: `/api/identify-coin` now derives `user_id` from the
  verified JWT and `source` ("camera"/"gallery") from the authenticated
  request body, computes `denom_canonical` / `is_foreign` / `local_date` /
  `local_hour` server-side, and inserts the row via
  `supabase_admin.insert_scan` (service-role client). Never trusts
  client-supplied identity or value.
- **Quota (M6)**: new Supabase-backed `api_usage` table. `check_and_reserve_quota`
  counts today's AI *attempts* (not just successes) via `count_api_usage_since`,
  reserves an attempt via `insert_api_usage` *before* calling OpenAI, and
  returns 429 `quota_exceeded` if `DAILY_SCAN_LIMIT` is hit. Survives
  restarts/multi-worker since it's DB-backed, not in-process memory. Also
  added: per-image byte cap (`MAX_IMAGE_BYTES`, 413 `image_too_large`),
  overall request size cap (`MAX_CONTENT_LENGTH_BYTES`), per-upstream
  timeouts (`OPENAI_TIMEOUT_SECONDS`, `NUMISTA_TIMEOUT_SECONDS`,
  `PCGS_TIMEOUT_SECONDS`), and no retries on billing/quota errors
  (`is_retryable_openai_error` explicitly excludes 402/quota/billing).
- **Mock mode**: existing `MOCK_MODE`/`USE_MOCK_COIN_RESPONSE` preserved as-is
  (treated as the spec's "MOCK_AI" concept — not renamed). Mock path still
  writes real scan rows to Supabase through the same `persist_scan` code, so
  history/badges/leaderboard all work in mock mode with zero OpenAI/Numista/
  PCGS calls. Quota check is skipped in mock mode.

Supabase (`supabase/migrations/`):
- `0001_api_usage_and_leaderboard.sql` — creates `public.api_usage`
  (server-only, RLS enabled with no policies); redefines `public.leaderboard()`
  (drops + recreates because Postgres can't `CREATE OR REPLACE` a changed
  return signature) to add a `user_id` column the frontend needs.
- `0002_grant_api_usage_service_role.sql` — see §3, added later today after
  a production error.

Expo (`src/`):
- `src/api/scans.js` (new) — `fetchMyScans()` and `fetchLeaderboard()`, both
  direct-to-Supabase reads with the user's own session (RLS), bypassing Flask
  entirely for reads per the architecture.
- `src/Root.js` — `userScans` now loaded from Supabase (`refreshScans`) on
  auth state change instead of `AsyncStorage`; passed down to Account/Stats/
  Badges/Leaderboard; `ScanScreen` gets `onScanSaved={refreshScans}`.
- `src/badges/badges.js` — same 57 badges/UI/thresholds, but predicates now
  read real Supabase columns (`denom_canonical`, `is_foreign`, `year`,
  `local_hour`, `local_date`, `estimated_value`, `scanned_at`) instead of
  regex-parsing a `{coin, time, value}` display string. Added
  `tierBadgeCount()` — a safe aggregate-only approximation (scan-count/net-worth/
  membership tiers only) used for *other* users on the leaderboard, since
  computing their real badge set would require reading their raw scan history.
- `src/screens/leaderboard/LeaderboardScreen.js` — rewritten to call
  `fetchLeaderboard()` (the RPC) on an interval instead of a hardcoded
  `FAKE_USERS` array with a random `setInterval` incrementing fake stats.
  "Is this me" matches on `row.user_id`, falling back to display-name match
  if `user_id` isn't present yet (pre-migration compatibility).
- `src/screens/account/AccountScreen.js` — reads `userScans` prop instead of
  `AsyncStorage`; **removed the TEMP debug UI** (`GET /api/me` and
  `POST /api/test-scan` buttons) since it shouldn't be in the normal app flow.
- `src/screens/stats/StatsScreen.js` — same `AsyncStorage` → `userScans` prop
  swap, field renames (`coin_name`, `estimated_value`, `scanned_at`).
- `src/screens/scan/ScanScreen.js` — sends `source` and
  `tz_offset_minutes` (`Date.getTimezoneOffset()`) with every identify-coin
  call; removed local `AsyncStorage` history writes (server is now
  authoritative); "Estimated Value" card redesigned for a single
  Numista/PCGS-sourced number instead of an AI-guessed low/high range.
- `src/api/client.js` — `identifyCoin(front, back, source)` signature change;
  added friendly `ERROR_DISPLAY` entries for the new error codes
  (`quota_exceeded`, `image_too_large`, `invalid_source`, etc).

Tests: `server/tests/` (Python, `unittest`) and `__tests__/` (JS,
`node --test`, including new `badges.test.js`). Verified live against the
real Supabase project using two disposable signup accounts (RLS cross-user
isolation confirmed, real persist round-trip confirmed), then deleted.

### 1b. Disabled eBay listing generation for V1

- `server/app.py`: `ENABLE_EBAY_LISTING` env flag (default `false`).
  `/api/generate-ebay-listing` now returns immediately —
  `{"feature_disabled": true, "feature": "ebay_listing", "message": "..."}`,
  HTTP 200 — *before* reading the body, before the mock check, before any
  OpenAI call. Implementation below the flag is untouched (kept for later
  re-enable).
- `src/screens/scan/ScanScreen.js`: `EBAY_LISTING_ENABLED = false` constant;
  the whole "eBay Listing Draft" card is wrapped in it. State/handler
  (`ebayListing`, `handleCreateEbayListing`, etc.) left in place, just
  unreachable.
- Tests updated/added in `server/tests/test_app.py` to prove: default is
  disabled with the exact structured body, and `requests.post` (OpenAI) is
  never called when disabled; the enabled path is still tested by
  explicitly flipping the flag.

### 1c. Removed the unused `/api/openai/chat` route

- Confirmed via repo-wide search: **zero callers**, anywhere. Both real
  OpenAI-calling paths (`identify_coin_with_ai` for scans,
  `openai_chat_content` for the eBay listing) already call OpenAI's HTTP API
  directly — neither ever routed through this local proxy endpoint.
- Removed the route + handler from `server/app.py`; removed the now-dead
  `build_mock_reply()` from `server/mock_openai.py` (its only caller) and the
  now-unused `import json` there; removed the now-unused import in
  `server/app.py`.
- `OPENAI_CHAT_URL`, `OPENAI_TIMEOUT`, `proxy_response` were **kept** — still
  used by `openai_chat_content` (eBay path) and the other proxy routes
  (`/api/numista-specs`, `/api/pcgs-value`, `/api/log-scan`, `/api/scans`).
- Test updated: trimmed the `/api/openai/chat` assertions out of
  `test_proxy_routes_return_mock_payloads` (kept the rest — numista/pcgs/
  log-scan/scans are unrelated); added `test_openai_chat_route_removed`.
  Note: that test asserts **500**, not 404 — this app has a blanket
  `@app.errorhandler(Exception)` that catches Flask's normal 404 for an
  unmatched route and turns it into a generic 500 `server_error`. This is
  **pre-existing, unrelated behavior**, left as-is; the test was written to
  match reality rather than "fix" something out of scope.

### 1d. Committed and pushed

- One commit, `d5cd4b7`, covering all of 1a + 1b + 1c (18 files changed).
- Tightened `.gitignore` (`server/__pycache__/` → `__pycache__/`) so test
  bytecode from the new `server/tests/__pycache__/` doesn't get committed.
- No secrets staged (`.env`/`.env.local`/`server/.env` correctly ignored).
- Pushed to `origin/seperate` (`f3f7357..d5cd4b7`).

### 1e. Follow-up commits (same day, after the incident in §3)

Three more focused commits, pushed together (`d5cd4b7..fe9369d`):
- `c2ee5d9` — the `service_role` grant fix for `api_usage` (§3/§4b).
- `4a7adce` — Numista/PCGS pipeline observability logging + a bugfix found
  while adding it (§6).
- `fe9369d` — this context export document itself.

---

## 2. Assumptions made (things a future session should sanity-check)

- **Numista v3 API shape is unverified against a live key.** No
  `NUMISTA_API_KEY` was available in this environment. `search_numista_types`
  defensively checks for `types`/`items`/`results` as the result-list key,
  and `fetch_numista_price` assumes a `/types/{id}/prices?currency=USD`
  endpoint returning a `prices` array with `grade`/`price` fields. **Spot-check
  this once a real key is added** — field names may need adjusting.
- **No `openai` Python package was installed.** Chose direct `requests.post`
  calls to `https://api.openai.com/v1/responses` instead of the SDK, to keep
  the identical error-handling/mocking pattern already used for every other
  upstream call in this file, and to avoid a new dependency whose
  availability in this sandbox was unverified. Functionally equivalent to
  using the SDK; can be swapped later if preferred.
- **Confidence floor of 40** (`MIN_IDENTIFICATION_CONFIDENCE`) is an
  additional safety net on top of the model's own `status` field
  (`identified`/`uncertain`), not the sole signal — per the instruction not to
  rely solely on a fabricated numeric percentage.
- **Numista match ambiguity threshold**: best candidate must score ≥3 *and*
  not tie with the runner-up, or the match is treated as "no confident
  match" (valuation → unavailable). This threshold was chosen conservatively
  and has not been tuned against real search results.
- **Quota scope**: `DAILY_SCAN_LIMIT` only gates `/api/identify-coin`. The
  eBay-listing endpoint (even when re-enabled) is a separate, user-triggered
  action and was deliberately not folded into the scan quota.
- **`tz_offset_minutes`** is accepted from the client (`Date.getTimezoneOffset()`)
  and used only to compute `local_date`/`local_hour` for badge display
  grouping — treated as non-authoritative/cosmetic, not a security- or
  value-sensitive field, so trusting client input here was judged acceptable
  (unlike `user_id` or `estimated_value`).
- **`denom_canonical` vocabulary** intentionally mirrors the old client-side
  `_denomOf()` logic (`wheat-penny` takes precedence over generic `penny`,
  etc.) for backward-compatible badge behavior, with a generic slugified
  fallback for non-US denominations (e.g. a Canadian 5¢ won't match any of
  the US-specific type badges — expected, not a bug).
- **`is_foreign`** is a simple string match against
  `{"united states", "usa", "u.s.", "u.s.a.", "united states of america"}` —
  no fuzzy matching or country-code lookup.
- **Leaderboard "Most Badges" column for other users** deliberately uses the
  cheap `tierBadgeCount()` approximation (built only from the RPC's safe
  aggregate fields), not each user's real 57-badge set — computing the real
  set would require reading another user's raw scan history, which the
  architecture explicitly forbids. Only *your own* row shows the real count.
- **Optional Numista/PCGS metadata columns** (composition, weight, diameter,
  `numista_type_id`, `valuation_source`) were **not** added to `scans` —
  judged as not genuinely required for the prototype to work end-to-end on
  the existing columns. Deferred, not forgotten.
- **`MOCK_MODE` was kept as the source of truth**, not renamed to `MOCK_AI` —
  treated as the existing implementation of that concept per "preserve
  existing... mock mode."
- **Both `require_auth` (JWKS, no network round-trip) and `require_user`
  (calls Supabase's `/auth/v1/user`) were preserved** as separate mechanisms
  per explicit instruction, even though they're redundant in principle.
- **eBay-disabled response is HTTP 200**, not 404/503 — chosen so any caller
  (automation, a future re-enabled UI probing the flag) parses it as a clean
  data shape rather than an error path.

---

## 3. Today's production incident: Supabase permission error

**Symptom** (from Render logs, real device, mock mode off):
```
ERROR:supabase_admin:supabase count_api_usage_since failed: status=403
body={"code":"42501","details":null,
"hint":"Grant the required privileges to the current role with:
GRANT SELECT ON public.api_usage TO service_role;",
"message":"permission denied for table api_usage"}
...
127.0.0.1 - - [...] "POST /api/identify-coin HTTP/1.1" 503 106 ...
```
Client saw: `{"error": {"code": "quota_check_failed", "message": "Could not
verify your usage limit. Try again shortly."}}`.

**Root cause**: `public.api_usage` (from migration `0001`) was created by
running raw SQL directly in the Supabase SQL editor, not through Supabase
Studio's table editor. Studio auto-grants new tables to
`service_role`/`anon`/`authenticated`; a table created via plain SQL does
not get that for free. RLS-bypass and base table privileges are two
*separate* permission layers — `service_role` already bypasses RLS (that
part was fine), but it still needs an explicit `GRANT` to touch the table at
all, which it never got. `scans`/`profiles` already worked because they
were created earlier (evidently via Studio or with grants already applied).

**Behavior validation**: the app did the *correct* thing here — it failed
closed with a clean 503, not a crash and not a silent bypass of the quota
gate. No app code changes were made or needed.

**Fix**: a database-only grant, broader than the error's own hint since
Flask also inserts and updates `api_usage` rows (would have hit the same
wall next):
```sql
grant select, insert, update on public.api_usage to service_role;
```

**Status**: fix is committed and pushed (`c2ee5d9`, see §4) but **has not
yet been confirmed run against the live database** — a `git push` does not
execute SQL against Supabase. That's still the one pending external action
from today (§7).

---

## 4. All SQL run/written so far (in order)

### 4a. `supabase/migrations/0001_api_usage_and_leaderboard.sql`
Written in an earlier session; **run once already** by the user in the
Supabase SQL editor. Since then, the file has also been amended in-place
(same file, not a new one) to add the `service_role` grant for
`api_usage` — see 4b for why a *second*, standalone migration was created
instead of asking for a re-run of the whole file.

```sql
-- CoinLens prototype: API cost-protection accounting + leaderboard RPC.
-- Idempotent: safe to run multiple times.

create table if not exists public.api_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  endpoint text not null,
  status text not null check (status in ('attempted', 'identified', 'uncertain', 'error')),
  scan_id uuid references public.scans (id) on delete set null
);

create index if not exists api_usage_user_created_idx
  on public.api_usage using btree (user_id, created_at desc);

alter table public.api_usage enable row level security;

-- Added today (2026-09-12), after the production 42501 error:
grant select, insert, update on public.api_usage to service_role;

begin;
drop function if exists public.leaderboard();

create function public.leaderboard()
returns table (
  user_id uuid,
  display_name text,
  scan_count bigint,
  total_value numeric,
  avg_value numeric,
  member_since timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as user_id,
    coalesce(p.display_name, 'Member') as display_name,
    count(s.id) as scan_count,
    coalesce(sum(s.estimated_value), 0)::numeric as total_value,
    case when count(s.id) > 0
      then round(coalesce(sum(s.estimated_value), 0) / count(s.id), 2)
      else 0
    end as avg_value,
    p.created_at as member_since
  from public.profiles p
  left join public.scans s on s.user_id = p.id
  group by p.id, p.display_name, p.created_at;
$$;

grant execute on function public.leaderboard() to authenticated;

commit;
```

### 4b. `supabase/migrations/0002_grant_api_usage_service_role.sql`
**New today, NOT yet confirmed run.** This is the actual action item —
same single `GRANT` statement as embedded in 4a above, pulled out standalone
so the user's *already-migrated* project (which ran 0001 before this grant
was added to it) doesn't need to re-diff or re-run the whole original file:

```sql
grant select, insert, update on public.api_usage to service_role;
```

### 4c. Ad-hoc read-only verification (not migrations, not re-runnable SQL —
listed for completeness since they touched the live database)
Run via Supabase's PostgREST REST API (service-role/anon keys), during
earlier verification of Milestones 0–8, *before* today's session:
- Introspected live schema via `GET {SUPABASE_URL}/rest/v1/` (OpenAPI/Swagger
  document) to confirm `profiles`/`scans` columns and discover the
  pre-existing `leaderboard()` RPC.
- `GET /rest/v1/scans`, `GET /rest/v1/profiles` with anon key (no session) —
  confirmed RLS returns `[]`, not an error.
- `POST /rest/v1/scans` with anon key (no session) — confirmed RLS rejects
  the insert (`42501`).
- Signed up two disposable test accounts (`POST /auth/v1/signup`), ran two
  real `/api/identify-coin` calls in mock mode through the live Flask
  server, confirmed `GET /rest/v1/scans` with each user's own JWT shows only
  their own rows (RLS cross-user isolation).
- Cleaned up afterward: `DELETE /rest/v1/scans?user_id=eq.<id>`,
  `DELETE /auth/v1/admin/users/<id>` (×2) — production database was left in
  its original state.

None of 4c involved DDL or any statement that needs to be re-run; it's
included only so the full picture of what touched the live database today
(and in the lead-up to today) is in one place.

---

## 6. Follow-up change: Numista/PCGS pipeline observability + bugfix

**Trigger**: the user wanted to verify the Numista API contract end-to-end
(the assumptions flagged in §2 were made without a live key) and pointed out
that no Numista/PCGS response or error was being logged anywhere — so a
wrong field-name assumption would only ever show up as a silent "valuation
unavailable," never as a visible discrepancy.

**What was added** (`server/app.py` only, `commit 4a7adce`): tagged,
greppable `app.logger.info`/`.warning`/`.error` calls at every stage of the
pipeline, so a real test scan's Render logs read top-to-bottom against the
actual stages:

| Tag | What it shows |
|---|---|
| `[identify]` | OpenAI's structured result (status/confidence/country/denomination/year/grade); final valuation decision; scan-persisted confirmation with row id |
| `[numista]` | search query sent + **raw response body** (truncated to 1500 chars); candidate count; top 3 scored candidates (score, id, title); which one was selected and why, or why none qualified (score too low / tied with runner-up); type-detail fetch result; price-endpoint **raw response body**; exact-grade match vs. nearest-available-grade fallback |
| `[pcgs]` | whether the optional fallback was attempted, skipped (no PCGS reference), succeeded, or failed |
| `[valuation]` | final available/unavailable decision and why |

Raw response bodies are logged (truncated, not full) specifically so the
*actual* Numista JSON shape can be read directly from Render logs and
compared against the field names the code assumes
(`types`/`items`/`results`, `issuer.name`, `min_year`/`max_year`,
`prices[].grade`/`.price`) — this is the concrete mechanism for verifying
the contract in §2's first assumption.

**Bug found and fixed while adding this**: `fetch_numista_price`'s "no exact
grade match, use nearest available" fallback branch read a price entry via
`middle["value"]` instead of `middle["price"]` (the actual key on a Numista
price-list entry, consistent with the exact-match branch a few lines above
it, which already used `entry["price"]` correctly). This would have raised
`KeyError: 'price'` the first time a real scan's grade didn't exactly match
a priced grade in Numista's response — i.e. probably on the very first real
test scan. Caught by re-reading the diff before testing, not by a test
catching it.

**Verification performed**: wrote a one-off script (not committed — it was
throwaway) that patches `requests.get` to return realistic canned Numista
responses (a Canada 5 Cents search hit → type detail → a `prices` array with
no exact `"VF-30"` entry, forcing the nearest-available fallback) and ran
`lookup_numista()` + `estimate_value()` against it directly. Confirmed: no
crash, correct value selected, and every log line described above actually
appears in the expected order/format. This is the same technique available
for verifying real Numista responses later, just with real data instead of
a canned fixture.

**No behavior changed**: matching thresholds, scoring, valuation
decision logic, and return shapes are all identical to before — this was
purely additive logging plus the one real bug fix.

**Tests**: 24/24 Python (`python -m unittest discover -s tests` from
`server/`), 22/22 JS (`npm test`) — unaffected, since no existing test
exercises the Numista/PCGS HTTP calls directly (all gated behind
`NUMISTA_API_KEY`/mock mode in every current test, so none of them reach the
new logging code).

**Still not done**: an actual real scan against the live Numista API has not
happened yet in this session (no `NUMISTA_API_KEY` was available here). The
`[numista]` log lines are ready to read the moment that happens on Render.

---

## 7. Follow-up change: manual capture button replaces auto-capture

**Trigger**: the user reported the camera scan flow as "impractical and
broken" — it showed the scanning animation, auto-snapped the front photo
after a fixed ~2.5s timer, then auto-snapped the back photo ~2.5s after the
"flip the coin" prompt, with no way to control shutter timing.

**Root cause**: a single `useEffect` in `src/screens/scan/ScanScreen.js`
started a `setTimeout` calling `capture()` automatically whenever the camera
was ready, restarting itself every time `captureStage` flipped from
`front` → `back`. The round indicator under the camera preview was purely
decorative (an `Animated.View`, not a button) — there was no manual capture
path to fall back to at all.

**Fix** (commit `d04e3e8`, 4 files):
- `src/screens/scan/ScanScreen.js` — deleted the auto-capture `useEffect`
  and its timer ref entirely. Kept the scanning animation (corner brackets,
  scan-line sweep) unchanged. Wired the existing `capture()` state machine
  (front → back → identify — already correct, it just needed a manual
  trigger instead of a timer) to a tap on the round indicator, now a real
  `TouchableOpacity`. Added an `isCapturing` guard so a rapid double-tap
  can't fire two captures at once, and disabled the button until
  `cameraReady`.
- `src/theme/styles.js` — two small additive styles: `captureIndicatorDisabled`
  (dims the button while disabled/capturing) and `captureButtonInner` (a
  solid inner dot so the ring reads visually as a shutter button).
- `scanFlowLogic.js` — updated the front/back hint copy to say "tap the
  button below to capture the front/back of the coin" instead of "will
  capture automatically"; kept the "Flip the Coin" title as asked; dropped
  the now-unused `autoCaptureDelayMs`.
- `__tests__/scanFlowLogic.test.js` — updated the two assertions that
  specifically tested the old "automatically"/`autoCaptureDelayMs` behavior.

**Tests**: 22/22 JS passing. No Python files touched.

---

## 8. Follow-up change: identification confidence now means the COMPLETE id

**Trigger**: a real (non-mock) scan produced `status=uncertain,
confidence=84, country=Hong Kong, denomination=10 cents, year=Not legible`.
The 422/no-Numista behavior was already *correct* (status=uncertain
correctly blocked the scan) — the problem was purely semantic: a
confidence of 84 reads as "very sure" right next to "uncertain," which is
confusing and would be actively misleading if confidence were ever surfaced
to a user or used for any downstream decision. The model was evidently
scoring confidence based on how clearly it could read country/denomination,
ignoring that the year - also required for a Numista catalog lookup - was
illegible.

**Fix** (`server/app.py` only, prompt/schema text - no logic or contract
changes):
- `IDENTIFICATION_PROMPT` rewritten so `confidence` is explicitly defined as
  confidence in the *complete* identification needed for a Numista lookup -
  country **and** denomination **and** year **and** mint mark (when
  relevant) together, not just whichever field is easiest to read. Explicit
  worked example: "if the country and denomination are unmistakable but the
  year is worn away... confidence must be low (well under 40) and status
  must be 'uncertain'." `status` guidance updated to match (any one of those
  fields being illegible/guessed/unknown means uncertain, even if the rest
  are clear).
- `IDENTIFICATION_JSON_SCHEMA` — added non-breaking `"description"`
  annotations to the `status` and `confidence` properties reinforcing the
  same guidance directly in the structured-output schema (types/required/
  enum unchanged, so the wire contract is identical).
- `MIN_IDENTIFICATION_CONFIDENCE` (40) and `normalize_identification()`'s
  `identifiable = status == "identified" and confidence >= 40` logic were
  **not** changed — the 422 behavior was already correct; this fix is about
  making the *value* the model reports consistent with that behavior, not
  about how the server interprets it. No server-side clamping was added
  (e.g. forcibly capping confidence when status is "uncertain") since this
  was scoped as a prompt/schema fix, not a defensive-code fix.

**Tests added** (`server/tests/test_app.py`, all passing): since a live
model can't be invoked in a unit test, these exercise
`normalize_identification()` directly with realistic response shapes for
each scenario, plus one full-route test:
- `test_normalize_identification_fully_identified_coin_is_high_confidence` —
  all fields legible → `identified`, confidence ≥ 70.
- `test_normalize_identification_illegible_year_is_uncertain_and_low_confidence` —
  the exact reported scenario (country/denomination clear, year illegible)
  → `uncertain`, confidence < 40, country/denomination still surfaced.
- `test_normalize_identification_non_coin_is_uncertain` — nothing legible →
  `uncertain`, confidence < 40, fields fall back to "Unknown".
- `test_identify_coin_illegible_year_returns_422_without_numista` — full
  `/api/identify-coin` route test asserting 422, confidence below threshold,
  and that Numista search and scan persistence are never reached.

**Tests**: 28/28 Python passing (24 → 28), 22/22 JS passing (unaffected).

**Not yet verified against a real model call** — no `OPENAI_API_KEY` is
available in this environment, so whether GPT actually complies with the
strengthened prompt on real photos (like the reported Hong Kong 10 cents
case) still needs a live test scan to confirm.

---

## 9. Follow-up change: unmatched routes now return 404/405, not 500

**Trigger**: the user woke the Render server up in the morning by visiting
`/api/health` in a browser, then got confused seeing this in the logs:
```
GET /favicon.ico HTTP/1.1" 500 ...
GET /identify-coin HTTP/1.1" 500 ... "Mozilla/5.0 (iPhone; ...) Safari/604.1"
```
and worried the app might be crashing or someone was hitting the real scan
endpoint. Diagnosed as harmless: the `/identify-coin` hit was a plain
mobile-Safari `GET` to the wrong path (missing the `/api` prefix, wrong
HTTP method, no referer, User-Agent is Safari not the Expo app's
`Expo/... CFNetwork/... Darwin/...` signature) - confirmed by grepping the
entire client codebase and finding only one call site
(`src/api/client.js:108`), which correctly POSTs to `/api/identify-coin`.
Most likely just someone (possibly the user) typing/tapping that URL
directly into Safari, not a real scan attempt, a bot, or a security issue -
it never reached `require_auth`, so no auth, quota, OpenAI, Numista, or
Supabase code ran at all.

**Real (pre-existing) bug this surfaced**, independently flagged by another
AI reviewer as worth fixing before release testing: `server/app.py` had a
blanket `@app.errorhandler(Exception)` that catches *every* exception,
including Flask/Werkzeug's own routing-level `HTTPException`s (404 Not
Found, 405 Method Not Allowed, etc). With no more specific handler
registered for those, every wrong-URL or wrong-method request - completely
harmless - got logged and returned as a generic `500 server_error`, making
routine noise indistinguishable from a real crash. This is exactly what
made the log line above look alarming.

**Fix** (`server/app.py`): added `from werkzeug.exceptions import
HTTPException` and a new `@app.errorhandler(HTTPException)` handler that
returns the exception's real status code (404, 405, 400, etc.) in the
app's normal `{"error": {"code": ..., "message": ...}}` shape, with `code`
derived from the exception's name (e.g. `not_found`, `method_not_allowed`).
Registration order doesn't matter to Flask - it picks the most specific
match in the exception's MRO - so:
- the existing more-specific `@app.errorhandler(413)` still wins for
  oversized uploads (verified by a new test),
- the new `HTTPException` handler catches 404/405/400/etc. that have no
  more specific handler,
- the blanket `@app.errorhandler(Exception)` now only catches genuine,
  non-HTTP application bugs (verified by a new test that forces a
  `RuntimeError` and confirms it still comes back as 500).

No other behavior changed - identification, valuation, quota, persistence,
and the 422/429/413 contracts are untouched.

**Tests added** (`server/tests/test_app.py`):
- `test_unknown_route_returns_structured_404_not_500` - reproduces the
  exact `/identify-coin` scenario from the log.
- `test_wrong_method_returns_structured_405` - `GET /api/identify-coin`
  (POST-only) now 405s cleanly.
- `test_oversized_upload_still_returns_413_not_generic_http_exception` -
  confirms the new handler doesn't shadow the existing 413 handler.
- `test_unexpected_server_error_still_returns_500` - confirms a real bug
  still surfaces as 500.
- `test_openai_chat_route_removed` (existing, from an earlier session)
  updated to assert 404 instead of documenting the old 500-on-404 quirk,
  since that quirk is now fixed.

**Verified live**: booted the server locally in mock mode and reproduced
the user's exact log lines - `GET /favicon.ico` and `GET /identify-coin`
both now return 404 (previously 500); `GET /api/identify-coin` (wrong
method) returns 405; `GET /api/health` still works normally.

**Tests**: 32/32 Python passing (28 → 32), 22/22 JS passing (unaffected).

---

## 11. Follow-up change: quota_exceeded now shows "Back to Home" instead of "Try Again"

**Trigger**: after hitting the daily scan limit, the error screen still
offered a "Try Again" button that just replayed the same identify-coin
request the server would immediately 429 again — a useless retry for the
one error code where retrying can never succeed until the quota resets.

**Fix** (4 files, commit `f8038a3`):
- `scanErrorLogic.js` (new) — extracted `ScanError`, `ERROR_DISPLAY`, and
  `makeErrorDetail` out of `src/api/client.js` into a plain CommonJS module
  with no React Native imports, so it can be unit-tested directly under
  `node --test` (`client.js` pulls in `react-native` transitively via
  `src/api/supabase.js`, which can't load under plain Node — same reasoning
  as why `scanFlowLogic.js`/`aiLogic.js` already live outside `src/`). Added
  `isRetryableErrorCode(code)`, which returns `false` only for
  `quota_exceeded`; `makeErrorDetail` now also returns `code` and
  `retryable` on the detail object. Title/tip/body text is unchanged — the
  daily-limit body already comes dynamically from the server's
  `DAILY_SCAN_LIMIT`-based message (`f"Daily scan limit of {DAILY_SCAN_LIMIT}
  reached..."`), so no client-side hardcoded number was needed or added.
- `src/api/client.js` — now imports and re-exports `ScanError`/
  `makeErrorDetail` from `scanErrorLogic.js` instead of defining them
  inline; no behavior change.
- `src/screens/scan/ScanScreen.js` — in the `error` phase only, the button
  is now conditional on `ed.retryable`: `quota_exceeded` renders "Back to
  Home", whose handler calls `startNewScan()` (clears `errorDetail`/
  `frontImage`/`backImage`/phase, etc. — the same reset already used
  elsewhere) and then `navigate("home")` (the same home-navigation path the
  screen's own header back button and guest-mode exit already use). No API
  call is made and the camera is never reopened. Every other error code,
  and the separate `unidentifiable` phase (a distinct outcome, not an
  error), keep their existing "Try Again" → `startNewScan()` behavior
  unchanged.
- `__tests__/scanErrorLogic.test.js` (new) — 3 tests: `quota_exceeded` is
  non-retryable and keeps its title/dynamic-limit body; a sample of other
  codes remain retryable; a plain (non-`ScanError`) error falls back to
  retryable `unknown`.

**Not committed alongside this**: an unrelated, already-modified
`server/app.py` (pre-existing 1-line change in the working tree before this
task started) was deliberately left unstaged/uncommitted rather than swept
in with `git add -A`.

**Tests**: 25/25 JS passing (22 → 25). No Python files touched, no backend
quota logic (`DAILY_SCAN_LIMIT`, `check_and_reserve_quota`, etc.) changed.

---

## 13. Follow-up change: camera scan box shrunk + fixed zoom to fix out-of-focus captures

**Trigger**: the user reported that the square capture guide box in the
scan camera view was a bit too big — positioning a coin to fill it meant
holding the phone closer to the coin than the lens can actually focus at,
so the coin came out blurry.

**Diagnosis discussed before changing anything**: the blur is the phone's
autofocus failing at too-close a distance, not a bug in the guide box
itself. Two candidate fixes were weighed: (a) shrink the guide box, which
encourages standing farther back but also means the coin fills less of the
captured frame (a real tradeoff for AI identification, which wants
mint-mark/wear detail); (b) apply camera zoom so the phone can stay at a
safer focus distance while the coin still visually fills the frame, at the
cost of a digital-zoom crop. Decided to do both, but lean on zoom as the
main lever and only shrink the box slightly, rather than shrinking it a lot
and asking users to move even closer to compensate.

**Fix** (2 files, **not yet committed**):
- `src/theme/colors.js` — `BOX_SIZE` (used by both `ScanScreen.js` and
  `theme/styles.js` for the guide box and the scan-line animation range)
  260 → 230. All box-size usages already derive from this one constant, so
  no other file needed a change.
- `src/screens/scan/ScanScreen.js` — added `zoom={0.3}` (expo-camera's
  `CameraView` zoom prop, range 0–1) to the capture `CameraView`, so the
  preview/capture is digitally zoomed in a fixed, fairly conservative
  amount rather than relying on the user standing unnaturally close.

**Not done / explicitly deferred**:
- Rounding the guide box corners (raised as a "make it round-ish if easy"
  option) was **not** applied — decided the zoom+size change was the
  substantive fix for the blur complaint, and roundness is purely cosmetic
  with no effect on focus.
- `zoom={0.3}` is a starting guess, not measured against a real device in
  this session (no physical device/camera available here) — flagged as
  needing a real on-device check, see §14.

**Tests**: 25/25 JS passing, unaffected (no test exercises `CameraView`
props or pixel-level box size). No Python files touched.

---

## 14. Follow-up change: retry on transient Supabase gateway errors

**Trigger**: a real (non-mock) scan against the live Render deployment
identified a Canadian 2016 1-dollar coin correctly, then failed with
`Couldn't Save Scan` in the app. Render logs showed the true cause:
```
ERROR:supabase_admin:supabase insert_scan failed: status=504 body={"message":"Gateway Timeout"}
ERROR:app:scan insert failed for user_id=...: scans insert failed: status=504 body={"message":"Gateway Timeout"}
```
Not a schema, grant, or auth problem (unlike §3) — Supabase's own REST
gateway returned a 504 before our 10s client-side timeout was even reached.
The concerning part: the identification (and the quota attempt it
consumed) had already succeeded, so a single transient gateway blip cost
the user one of their daily scans for nothing.

**Fix** (`server/supabase_admin.py` only, **not yet committed**): added a
small `_request_with_gateway_retry(method, *args, **kwargs)` helper that
retries a `requests` call up to `MAX_GATEWAY_RETRIES` (2) times, with a
short linear backoff (`RETRY_BACKOFF_SECONDS = 0.5`, so 0.5s then 1s),
*only* when the response status is 502/503/504 — a real 4xx (bad data,
auth) or any 2xx returns immediately without retrying, so this can't mask
an actual bug as a "transient" one. Applied to the three admin calls that
hit Supabase's REST gateway and currently raise on failure: `insert_scan`,
`insert_api_usage`, `count_api_usage_since`. Deliberately **not** applied
to `update_api_usage` — that's already a best-effort, never-raises
bookkeeping call (out of the scope the user confirmed).

**Not changed**: `REQUEST_TIMEOUT` (10s, the client-side timeout — the
504 in the log was returned *by* Supabase, not a local timeout, so raising
this wouldn't have helped), and none of the quota/persistence decision
logic in `server/app.py` — this is purely a transport-layer retry around
the existing calls.

**Tests added** (`server/tests/test_supabase_admin.py`, new file, 5 tests,
mocks `requests.post`/`requests.get` and `time.sleep` so no real delay or
network call happens):
- `insert_scan` retries once on a transient 504 then succeeds.
- `insert_scan` gives up after 2 retries (3 total attempts) on a
  persistent 503, still raising `SupabaseAdminError`.
- `insert_scan` does **not** retry a real 400 (confirms retries are scoped
  to gateway statuses only).
- `insert_api_usage` retries on a transient 502 then succeeds.
- `count_api_usage_since` retries on a transient 503 then succeeds (and
  still parses the `Content-Range` header correctly on the retry).

**Tests**: 37/37 Python passing (32 → 37, all in 0.06s — confirms the
backoff sleep is properly mocked, not actually slowing the suite down).
25/25 JS passing, unaffected.

**Not yet done**: this has not been verified against a real Supabase
gateway timeout in production — the original 504 was intermittent, so
there's no guaranteed way to reproduce it on demand; the next time it
happens, the Render logs should show a `WARNING:supabase_admin:supabase
request got a transient 504, retrying...` line followed by a success
instead of the scan failing outright.

---

## 15. Follow-up change: resize images before identification + log OpenAI token usage

**Trigger**: the user hit `Rate Limit Hit` ("AI provider rate or quota limit
reached") twice, many minutes apart — not a burst pattern, which pointed
away from a per-minute request-count limit. They shared their OpenAI
usage-tier page: on the free/lowest tier, the models available are capped
at **10,000 TPM / 3 RPM** (one row, "gpt-5.6-luna", got 60,000 TPM / 10
RPM), and their usage dashboard showed **104,337 input tokens across just
6 requests** (~17.4K tokens/request average) — nowhere near the 50
requests/day cap, but plausibly already over a 10K-tokens-*per-minute* cap
on a single request, independent of timing between requests.

**Diagnosis**: `identify_coin_with_ai` (`server/app.py`) sends one Responses
API call per scan with one or two full-resolution photos as
`input_image`/`data_url` content. Vision models bill images by tiling them
into fixed-size chunks, so an uncompressed/undownscaled phone photo (often
3000-4000px on the long edge) can cost far more tokens than a resized one
without a proportional accuracy benefit — plausibly enough, on its own, to
exceed a low-tier account's per-minute token budget regardless of how far
apart requests are spaced. This was reasoned from the account's own
dashboard numbers, not confirmed with an exact per-request token count
(OpenAI's Responses API does return a `usage` object we weren't logging —
see the second half of the fix below, added specifically to close that gap
for next time).

**Fix** (6 files, commit `5992a54`, **user confirmed "both now" before this
was implemented** — chose to do the accuracy-affecting resize *and* the
safe logging-only addition together rather than logging first and waiting
for another failure):

- `src/api/imagePrep.js` (new) — `prepareImageForIdentification(photo)`
  takes an expo-camera capture result or an expo-image-picker asset
  (`{ uri, base64, width, height }`), and if the long edge exceeds 1280px,
  uses `expo-image-manipulator`'s `manipulateAsync` to resize (preserving
  aspect ratio) and re-encode as JPEG at `compress: 0.9`, returning the new
  base64. Images already at or under 1280px are returned untouched (no
  pointless re-compression). Added `expo-image-manipulator` as a new
  dependency via `npx expo install` (SDK-57-compatible version resolved
  automatically: `~57.0.17`).
- `src/screens/scan/ScanScreen.js` — both capture paths now call
  `prepareImageForIdentification` before storing/sending a photo: the
  front/back camera captures in `capture()`, and the gallery photo in
  `startUploadedPhotoScan()`. `identifyCoin()` itself, its signature, and
  the persisted-scan/valuation logic are all unchanged — only the bytes
  going *into* the OpenAI call are smaller.
- `server/app.py` (`identify_coin_with_ai`) — logs OpenAI's real
  `usage.input_tokens`/`output_tokens`/`total_tokens` (tagged `[identify]`)
  right after parsing the response body, *before* checking `upstream.ok`,
  so the real per-request cost is captured whether the call succeeds or
  gets rejected (a rejected/429 response may or may not include `usage`;
  the code only logs it when present, no assumption either way). Purely
  additive — no change to the 401/402/429/`quota`/`rate_limit` mapping
  logic itself.

**1280px chosen, not a smaller/"low detail" option, deliberately**: an
alternative considered (and explicitly *not* chosen) was setting OpenAI's
per-image `"detail": "low"` parameter, which gives a small, fixed token
cost regardless of resolution — but low-detail vision inputs are coarse
enough that reading mint marks, dates, and wear (the whole point of this
app) would likely suffer. Resizing to 1280px keeps "auto"/high-fidelity
tiling behavior, just on a smaller source image, trading some token
headroom for not touching identification-quality behavior.

**Not changed**: `REQUEST_TIMEOUT`/`OPENAI_TIMEOUT_SECONDS`, the
401/402/429 → `key_invalid`/`quota`/`rate_limit`/`quota` code mapping in
`identify_coin_with_ai`, `MAX_IMAGE_BYTES` (the byte-size cap, a different
axis from pixel dimensions), and nothing server-side about *when* to call
OpenAI (no retry loop was added here, unlike §14's Supabase gateway retry
— a 429 that's genuinely over a TPM/RPM cap wouldn't be fixed by an
immediate retry the way a one-off Supabase gateway blip is).

**Tests added** (`server/tests/test_app.py`):
- `test_identify_coin_openai_rate_limit_returns_429` — a real upstream 429
  from OpenAI itself (message without "quota"/"billing") maps to our
  `rate_limit` code and still marks the reserved quota attempt as
  `"error"` — this exact path (as opposed to our own `quota_exceeded`) had
  no prior test coverage.
- `test_identify_coin_logs_openai_token_usage_on_success` — a mocked
  Responses API reply carrying a `usage` object produces the
  `[identify] OpenAI usage: input_tokens=...` log line, asserted via
  `assertLogs`.

**Tests**: 39/39 Python passing (37 → 39), 25/25 JS passing (unaffected —
`imagePrep.js` isn't unit-tested; like `src/api/client.js`, it imports a
native Expo module and can't load under plain `node --test`).

**Not yet done**:
- Not verified against a real device/OpenAI call in this session (no
  camera or `OPENAI_API_KEY` available here) — the next real scan's Render
  logs should show a much lower `input_tokens` number, and ideally no more
  `Rate Limit Hit` errors on this tier.
- 1280px and `compress: 0.9` are reasoned defaults, not tuned against a
  real photo → real OpenAI token count. If a rate limit still occurs after
  this, the new usage logging will show whether it's still image-token-
  dominated (tune the constant down further) or something else entirely.

---

## 16. Follow-up change: raised max_output_tokens after a truncated-response bug

**Trigger**: the very next real scan after §15's image-resize fix. Render
logs showed the rate-limit problem was solved (`input_tokens=4584`, well
under the account's TPM caps, no 429), but a *new* failure appeared:
```
[identify] OpenAI usage: input_tokens=4584 output_tokens=1000 total_tokens=5584 status=200
```
...followed by `Coin Not Recognized` / "AI provider returned an empty
response." (HTTP 422, `identification_failure`) in the app.

**Diagnosis**: `output_tokens=1000` exactly equals the `max_output_tokens`
hard cap that was already set in `identify_coin_with_ai`'s payload — the
response was truncated at the token limit before any visible answer was
produced. This is a known behavior with reasoning-capable models: part of
`usage.output_tokens` can be silent "reasoning tokens" spent *before* the
final JSON, and if the cap is too low, the entire budget can be consumed
by reasoning with zero visible output text — which matches the symptom
exactly (not malformed JSON, which would mean *some* text came back;
*empty*, which means none did). `extract_responses_output_text` correctly
returned `None` and the existing `identification_failure` path handled it
without crashing - this was a real product gap (every real, non-mock scan
would likely hit this), not a code bug in the error handling itself.

**Fix** (`server/app.py`, `identify_coin_with_ai`, **not yet committed**):
- `max_output_tokens` 1000 → 2000 — doubles the budget so there's room for
  hidden reasoning *and* the final structured JSON. Chosen to stay
  comfortably under the account's TPM ceiling even combined with the
  §15-resized ~4-5K input tokens (4584 + 2000 = 6584, still well under the
  10,000 TPM floor tier from §15's diagnosis) - deliberately not raised
  further than needed, since more output-token headroom trades directly
  against the same rate-limit budget §15 just fixed.
- Extended the `[identify] OpenAI usage` log line to also report
  `usage.output_tokens_details.reasoning_tokens` (when present) and the
  Responses API's own `status` field, so a future truncation shows the
  reasoning/final-answer split directly instead of just a total.
- Added a new `app.logger.warning` right where `identification_failure` is
  raised for empty output, logging the response's `status` and
  `incomplete_details` (e.g. `{"reason": "max_output_tokens"}`) - this is
  the single most direct diagnostic for "was it truncation, and why."

**Not changed**: the 401/402/429 upstream-error mapping, the
`identification_failure`/422 contract itself (still the correct response
shape for "no usable answer"), and nothing about which model is used or
its reasoning settings (a `reasoning: {"effort": ...}` parameter was
considered to reduce reasoning-token spend directly, but not added -
unclear whether the currently configured `OPENAI_MODEL` accepts that
parameter at all, and guessing wrong could turn a working non-reasoning
model call into a hard 400).

**Tests added** (`server/tests/test_app.py`):
- `test_identify_coin_sends_headroom_for_reasoning_tokens` — asserts the
  outgoing payload's `max_output_tokens` is at least 2000 (a regression
  guard so this can't silently drop back to a too-low value).
- `test_identify_coin_truncated_by_max_output_tokens_logs_incomplete_details`
  — reproduces the exact production shape (`output_tokens` at the cap,
  `output_tokens_details.reasoning_tokens` equal to it, `status:
  "incomplete"`, empty `output`) and asserts it still surfaces as
  `identification_failure`/422 (not a crash), logs the incomplete-details
  warning, and marks the quota attempt `"error"`.

**Tests**: 41/41 Python passing (39 → 41), 25/25 JS passing (unaffected -
no JS files touched).

**Not yet done**:
- Not verified against a real device/OpenAI call in this session. The next
  real scan's Render logs should show a `reasoning=` value in the usage
  line (confirming or ruling out the reasoning-token theory) and, ideally,
  a completed identification instead of another 422.
- If 2000 still isn't enough (e.g. `output_tokens` again lands exactly at
  the cap), the reasoning-token figure logged here will make that obvious,
  and the next lever would be either raising the cap further (watch the
  TPM math from §15) or revisiting the `reasoning.effort` idea once the
  configured model is confirmed to support it.

---

## 17. Investigation + fix: Numista type-vs-issue matching and pricing endpoint

**Trigger**: two different real, non-mock scans (a 2016 Canada 1 dollar,
and the 2012 UK 20 pence from §16) both came back "Estimated Value: Not
available." The user asked whether hooking up PCGS would help, and then
asked for a full investigation per an explicit brief: inspect the exact
query, `score_numista_candidate`, `select_best_numista_match`, the real
logged candidate fields, and the type-detail/pricing assumptions; determine
whether the failure was a search problem, a scoring problem, or a
type-vs-issue problem; do not just lower the confidence threshold.

**Why PCGS wouldn't have helped either failure**: `lookup_pcgs()` only ever
runs off a PCGS cross-reference number that comes from an already-confident
Numista *type* match (`numista_data.get("references")`) - it returns `None`
immediately otherwise. Both failures happened at the Numista *matching*
stage, before there was ever a type to pull a PCGS number from. PCGS is
also almost entirely a US-coins database; neither example coin is American.

**Evidence directly from the two real scans' logs** (not hypothetical -
this is what made root-causing possible without a live Numista key in this
environment):
- Canada query: `search response: query='Canada 1 dollar' ... body={"count":1559,"types":[{"title":"1 Dollar - Elizabeth II (4th Portrait - Rotary Centenary)","issuer":{"code":"australie","name":"Australia"},...},{"title":"1 Dollar - Elizabeth II (...Olympic Team...)","issuer":{"name":"Australia"},...},...`
  - Numista's own free-text relevance search returned **Australian** "1
    Dollar" types ranked ahead of the actual Canadian coin, because the
    2-word query matches the denomination phrase for *any* country.
  - Our own scorer then re-ranked what came back and put Canadian "1 Cent
    - Victoria" (country match, wrong 1800s denomination, score 3) above
    everything, because a bare country-name match (+3) outweighs no match
    at all - it never saw a correctly-denominated Canadian dollar
    candidate score higher, implying one either wasn't in the small
    `count=8` window or didn't literally contain "1 dollar" in its title.
- UK query: `search response: query='United Kingdom 20 pence' ... body={"count":366,"types":[{"title":"20 Cents - Elizabeth II...","issuer":{"name":"Australia"},...},{"title":"25 Pence - Charles III...","issuer":{"name":"Alderney"},...},{"title":"20 Pence - Elizabeth II (Viking Arms and Armour"` (cut off by the 1500-char log truncation before its `issuer` field)
  - Same pattern: non-UK candidates (Australia, Alderney) surfaced ahead of
    what looks like the genuinely correct UK type (id 10799), which then
    only scored 2 (denomination-only) in our own ranking - its `issuer`
    field was truncated out of the log, so whether it failed the country
    check for a real reason or a logging-truncation artifact could not be
    confirmed from existing logs alone. This is exactly why fuller
    candidate logging (added below) was necessary, not optional.

**Independent, code-level confirmation of a third root cause** (not
inferable from our logs at all): `fetch_numista_price` was calling
`GET /types/{id}/prices`. Numista's docs (`en.numista.com/api/doc/...`)
are Cloudflare-blocked from this sandbox and the schema endpoint
(`api.numista.com/api/doc/swagger.yaml`) requires an API key we don't have
here, so this was verified instead against a hand-written third-party
Python SDK (`namachieli/numista-api-sdk` on GitHub) whose source explicitly
builds requests from Numista's own `swagger.yaml` (`API_SCHEMA_URL` in its
source) - its `getPrices()` method builds
`f"/types/{type_id}/issues/{issue_id}/prices"`, and it separately confirms
a `GET /types/{type_id}/issues` endpoint exists (`getIssues()`) distinct
from `GET /types/{type_id}` (`getType()`). This matches the user's own
architectural hint exactly: **pricing is issue-specific, not type-level**.
Every real scan that reached the pricing stage - regardless of matching
quality - was hitting a URL that doesn't match Numista's real API.

**Root cause: a combination, all three categories, not one**:
- **(A) Search** - confirmed directly from real log bodies: Numista's own
  relevance ranking for a bare `"{country} {denomination}"` query does not
  reliably surface the correct country's match near the top of even a
  modest `count=8` window.
- **(B) Scoring** - likely a contributing factor (title-substring matching
  is brittle against real Numista title conventions - e.g. a type titled
  just "Dollar" rather than "1 Dollar" would silently lose the
  denomination-match points), but not fully confirmed for the UK case
  specifically due to log truncation cutting off the one candidate that
  mattered.
- **(C) Type-vs-issue** - confirmed independently of the two real scans,
  via the third-party SDK's source: the pricing endpoint was simply wrong,
  and a type's own min/max-year range is not a substitute for checking a
  specific issue.

**Fix** (`server/app.py`, commit `1d07df6`, **not yet pushed**) - replaces
score-and-threshold matching with score-to-shortlist, then require-a-real-
issue matching, per the user's specified flow (search -> rank -> inspect
top few types' real issues -> require an issue matching the year, mint
mark to disambiguate -> select type+issue -> fetch prices for that issue):
- `score_numista_candidate` is now backed by
  `_score_numista_candidate_breakdown`, which returns *why* a candidate
  scored what it did (a dict of named components), not just a number.
  `resolve_numista_type_and_issue` logs this breakdown, plus the exact
  `cand_country` text compared, for **every** candidate returned by the
  search (not just the top 3 as before) - the single change that makes
  the next real scan's failure mode (A vs. B) conclusively diagnosable
  instead of inferred from partial log excerpts.
- New `fetch_numista_issues(type_id)` calls the now-confirmed
  `GET /types/{id}/issues` and logs the response + the years found.
- New `_issue_matches_year` (exact year, or within an issue's own
  min/max range) and `_issue_mint_text`/`_select_issue_for_year` (mint
  mark used only to disambiguate multiple same-year issues, never as a
  hard requirement - not every denomination carries one).
- New `resolve_numista_type_and_issue`: scores all candidates, takes the
  top `NUMISTA_MATCH_CANDIDATES_TO_INSPECT` (3) scoring at least
  `NUMISTA_MATCH_MIN_SCORE` (2), and for each (in score order) fetches its
  issues and requires one to match the identified year. **The first one
  with a real matching issue wins - even if a different, higher-scored
  candidate was checked first and rejected.** This directly fixes the
  observed failure mode: a wrong-era title match that scores well no
  longer wins just because of its score. If nothing among the inspected
  candidates has a matching issue, the result is `(None, None)` -
  unavailable, never invented, same honesty guarantee as before.
- `fetch_numista_price(type_id, issue_id, grade)` now takes an
  `issue_id` and calls the issue-scoped URL; `estimate_value` requires
  both a `numista_type_id` and `numista_issue_id` before attempting a
  price lookup.
- `search_numista_types`'s `count` raised 8 -> 12 (still one search call;
  gives the new inspect-top-3 step a wider net, directly addressing the
  (A) search-window evidence above).
- `_numista_result_list` now also unwraps a bare list or an `"issues"` key
  (previously only `"types"`/`"items"`/`"results"`), since the issues
  endpoint's exact wrapper shape is unconfirmed without a live key.

**Explicitly not done, per the brief**: the confidence threshold number
itself (a bare title/country score of 3) was **not** lowered or removed as
an acceptance rule - it no longer exists as an acceptance rule at all,
replaced by a strictly more rigorous factual check (a real issue for the
identified year). `NUMISTA_MATCH_MIN_SCORE` (2) is a *pre-filter* for
which candidates are worth an extra HTTP call, not an acceptance
threshold - a candidate can score 2 and still be correctly selected (as
the UK-style candidates would be), and a candidate can score 7 and still
be correctly rejected (as demonstrated by the new regression test). Also
not done: OpenAI identification, auth/quota/persistence/badges/leaderboard,
and no new database columns (none were needed - `numista_issue_id` lives
only in the in-memory `numista_data` dict passed between functions within
one request, not persisted).

**Numista endpoints actually confirmed** (via the third-party SDK's
source, cross-referenced against our own real logged responses where
possible):
- `GET /types` (search) - `q`, `issuer`, `category`, `page`, `count`,
  `lang` (default `en` - ruling out an earlier locale hypothesis about
  country-name mismatches). Our own real log bodies already confirm the
  response shape (`{"count", "types":[{"id","title","issuer":{"code","name"},"min_year","max_year",...}]}`).
  **Not used yet**: the `issuer` param (issuer code) would let us filter
  search by country precisely instead of relying on free-text ranking -
  deliberately deferred (see below), not forgotten.
- `GET /types/{id}` - full type detail (`fetch_numista_type_detail`,
  unchanged).
- `GET /types/{id}/issues` - **newly added**, confirmed to exist via the
  SDK; its exact response field names (`year` vs. a date range, mint
  field name) are **still unconfirmed against a live response** - this is
  exactly what the new `[numista] issues response`/`issues inspected` log
  lines will reveal on the next real scan that reaches this step.
- `GET /types/{id}/issues/{issue_id}/prices` - **corrected from the old,
  wrong `/types/{id}/prices`** - confirmed via the SDK; the `prices` array
  shape (`grade`/`price` fields) is carried over as a reasonable
  assumption from before, not yet confirmed live either.
- Numista's own documentation site (`en.numista.com/api/doc/...`) and
  schema endpoint (`api.numista.com/api/doc/swagger.yaml`) could **not**
  be fetched directly in this session (Cloudflare block / requires an API
  key this sandbox doesn't have) - all of the above is corroborated
  through the third-party SDK's source code, not a first-party call.

**Deferred (V2) idea, not implemented**: using `searchTypes`'s `issuer`
parameter to filter search by Numista's own issuer code instead of
free-text country matching would likely fix the (A) search-ranking
problem more directly than a wider `count`. Not done here because it
requires either a maintained country-name -> Numista-issuer-code mapping
(risk of a wrong guess *silently* returning zero results, since `issuer`
is a strict filter) or an extra live `/issuers` lookup call per scan -
both real design decisions better made with a live key in hand, and out
of scope for "smallest robust V1."

**Tests added** (`server/tests/test_numista.py`, new file, 17 tests):
scoring-breakdown correctness (including the real Australian-"1 Dollar"
false-country-credit scenario), `_issue_matches_year`/`_select_issue_for_year`
(exact year, range, no match, mint-mark disambiguation, mint-unspecified
fallback), and - the core regression guard -
`test_prefers_issue_confirmed_candidate_over_a_higher_scored_wrong_one`,
which constructs a wrong-era candidate that deliberately outscores the
correct one (mirroring the real title-omits-the-leading-"1" scoring gap
hypothesized above) and asserts the issue check still picks correctly;
plus a candidate-cap bound test, the corrected price-URL test, and two
`lookup_numista` integration tests.

**Tests**: 58/58 Python passing (41 -> 58), 25/25 JS passing (unaffected -
no JS files touched).

**Housekeeping note**: this commit (`1d07df6`) was staged with a plain
`git add server/app.py`, which - unlike earlier commits in this session -
did **not** carve out the pre-existing, unrelated `DAILY_SCAN_LIMIT`
5→20 default-value change still sitting in the working tree since before
this session started. That line was already swept into the earlier
`5747051` commit (`max_output_tokens` fix) by the same oversight and is
already pushed. Flagging this for transparency, not because it's harmful
(it's the user's own pre-existing edit and a plausible intentional
default) - just that the "keep unrelated changes separate" discipline
slipped for that one line partway through the session.

**Exact next real coin test to perform**: scan a **common, undamaged,
well-known coin** (ideally one where the AI's country/denomination/year
are all clean) - the two coins tried so far were both somewhat
unusual/damaged (a worn/mint-error-flagged UK 20p, and whatever made the
Canadian dollar not resolve), which may itself be contributing to weak
Numista search relevance. Concretely, read the Render logs for, in order:
1. `[numista] all candidates scored: ...` - check whether the correct
   type is present at all among the (now up to 12) candidates, and if so,
   whether its score reflects a real country+denomination match. Presence
   with a low score = confirms (B); absence entirely = confirms (A).
2. `[numista] issues response ...` / `issues inspected: ... years=...` -
   confirms the real field shape of an issue record (does `year` exist as
   named, or is it a min/max range? is there a mint field, and what is it
   called?).
3. `[numista] selected type+issue: ...` - confirms resolution worked
   end-to-end.
4. `[numista] price response: type_id=... issue_id=... ... body=...` -
   the first-ever real confirmation of the issue-scoped price endpoint's
   actual response shape, since neither real scan so far has reached
   pricing.
If step 1 shows the correct type present but scoring low specifically
because its title omits a leading "1" (or similar formatting variance),
that confirms hypothesis (B) concretely and would justify a follow-up:
normalizing denomination text (e.g. also trying without a leading "1 ")
before the substring check.

---

## 18. Follow-up change: diagnostics for OpenAI 429/error responses

**Trigger**: explicit follow-up request to improve diagnostics for
upstream OpenAI non-2xx responses (429 especially), without changing
retry behavior or the user-facing API contract. Prior to this, a 429 from
OpenAI logged nothing at all beyond the generic `CoinLensError` - the
existing `[identify] OpenAI usage` log line only fires when a `usage`
field is present in the response body, and a rejected/rate-limited
request typically has no `usage` field (the request never got processed).

**Fix** (`server/app.py`, commit `41abbf9`, pushed): added
`_log_openai_error_response(upstream)`, called immediately after the
`requests.post` call whenever `not upstream.ok` - **before** the
`upstream.json()` parse step, so it still logs even for a non-JSON error
body (a plain-text gateway error, for example). Logs:
- HTTP status code.
- Only the standard OpenAI rate-limit headers that are actually present
  (`x-request-id`, `x-ratelimit-limit-requests`,
  `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`,
  `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`,
  `x-ratelimit-reset-tokens`, `retry-after`) - never a synthesized `None`
  entry for one that wasn't sent.
- A sanitized/truncated response body (`OPENAI_LOG_BODY_CHARS = 1500`,
  matching the truncation length already used for Numista logging
  elsewhere in this file) - with a defense-in-depth regex redaction of any
  long base64-looking run (100+ base64 characters) as `<redacted-base64>`,
  in case an error body ever echoed request content back.

**Explicitly unchanged, per the brief**: the 401/402/429 ->
`key_invalid`/`quota`/`rate_limit` mapping logic, retry behavior (there is
none here, same as before), and every other part of the
`/api/identify-coin` contract. This is purely an additive diagnostic log
statement.

**Never logs**: the `Authorization` header, `OPENAI_API_KEY`, or any
request payload (front/back image data) - the logging function only ever
reads from the *response* object (`upstream.status_code`/`.headers`/
`.text`), never touches the request side at all, so there's no code path
by which a secret or an image could reach this log line.

**Tests added** (`server/tests/test_app.py`):
- `test_identify_coin_logs_openai_429_headers_and_body` - all 8 rate-limit
  headers present on a real 429 all appear in the log line, verbatim.
- `test_identify_coin_openai_error_logging_omits_absent_headers` - only
  `retry-after` sent -> only `retry-after` appears in the log; none of the
  other 7 header names appear.
- `test_identify_coin_openai_error_logging_never_leaks_secrets_or_images` -
  a distinctive API key value and a 500-character fake base64 blob (both
  intentionally set up to be present in the mocked response/environment)
  never appear in the log line verbatim; the blob shows up redacted as
  `<redacted-base64>` instead.
- Also **fixed** a latent gap in the pre-existing
  `test_identify_coin_openai_rate_limit_returns_429`: its mock `Response`
  never set `.text`/`.headers`, so accessing `.text` returned an
  auto-generated `Mock` object instead of a string - once the new logging
  code actually read `.text`, this crashed with a generic 500 instead of
  the expected 429. This was a test-mock gap, not a real code bug (a real
  `requests.Response` always has string `.text` and a real `.headers`
  dict); fixed by setting both explicitly on the mock.

**Tests**: 61/61 Python passing (58 -> 61), 25/25 JS passing (unaffected -
no JS files touched).

**Not yet done**: not verified against a real OpenAI 429 in this session
(would need to actually trigger one against the live low-tier account
again) - the next real rate-limit hit should now show a
`[identify] OpenAI error response: http_status=429 headers={...}
body=...` line in Render logs with the account's real rate-limit window
state (remaining requests/tokens, reset timers), which is the whole point
of this change.

---

## 19. Follow-up change: propagate OpenAI's real retry-after to the rate_limit UI

**Trigger**: a real OpenAI 429 came back with `retry-after: 11042` (~3
hours), but the app always said "Wait 30 seconds and try again" regardless
- a hardcoded, inaccurate wait time for `rate_limit` specifically (not
`quota_exceeded`, which is CoinLens's own separate daily limit).

**Backend error contract, before vs. after** (`server/app.py`, commit
`9bc4a87`):
```
before: {"error": {"code": "rate_limit", "message": "..."}}
after:  {"error": {"code": "rate_limit", "message": "...", "retry_after_seconds": 11042}}
```
`retry_after_seconds` is present only when OpenAI's `retry-after` header
parses to a positive integer; otherwise the field is simply absent (never
`null`, never a guessed value) and every other error's JSON is unchanged.
`CoinLensError` gained an optional `details` dict merged into the body -
unused by every other `CoinLensError` call site, so this is additive only.

**UI behavior** (`scanErrorLogic.js`/`src/api/client.js`, `rate_limit`
only; `ScanScreen.js` needed **zero changes** - its button was already
driven generically by the existing `retryable` field):
- `<=60s`: "Try again in about N seconds." + **Try Again**.
- `>60s, <3600s`: "Try again in about N minutes." + **Back to Home**
  (existing reset-and-navigate-home path, no API call, no camera reopen).
- `>=3600s`: "Try again in about N hours." + **Back to Home**.
- missing/malformed retry-after: "Wait a short time and try again." +
  **Try Again** (never claims a false specific wait time).

**Confirmed unchanged**: `quota_exceeded` behavior (still its own
Back-to-Home path, untouched), `DAILY_SCAN_LIMIT`/`api_usage`/quota
accounting (nothing here touches quota reservation or "refunds" an
attempt), OpenAI request payload/image preprocessing, auth, persistence,
Numista, PCGS, mock mode, and the existing §18 429 diagnostic
header/body logging (left fully intact - this task only adds a second,
narrower thing derived from the same response: the parsed retry-after,
returned to Expo rather than only logged server-side).

**Tests**: 67/67 Python passing (61 -> 67, 6 new: 30s/300s/11042s
propagated, missing/malformed header omits the field without crashing,
org/project id + x-request-id + raw body + token counts confirmed never
reaching Expo). 31/31 JS passing (25 -> 31, 6 new: the three time buckets,
the missing-header fallback, and explicit confirmation that
`quota_exceeded` and another normal error's behavior are unaffected).

**Not yet done**: not verified against a real OpenAI 429 in this session
(no live key here) - the next real rate-limit hit should show
`retry_after_seconds` in the JSON response and the matching bucketed UI
text/button on device.

---

## 20. Follow-up fix: Numista issuer-code search + ambiguous-match guard

**Trigger**: a real 2012 UK 20 pence scan narrowed §17's problem further.
Free-text search (`q="United Kingdom 20 pence"`) returned 12 candidates,
mostly **Isle of Man** 20 Pence types. The §17 issue-year validation
worked exactly as designed - candidates 10799/92170/92171 each only had
1982/1983 issues, none matched 2012, all correctly rejected, valuation
correctly stayed unavailable. The remaining gap: free-text search itself
wasn't giving the real UK match a fair shot at appearing as a plausible
candidate at all.

**Numista issuer endpoint/response shape found**: `GET
https://api.numista.com/api/v3/issuers` returns issuer records shaped
like `{"code": "...", "name": "..."}` (via a third-party SDK + community
sources, matching the same `{"count":..., "<key>":[...]}` wrapper
convention already empirically confirmed for `/types` search) - **not
confirmed against a live response** in this session (no key here). The
exact `/types` search `year` parameter's real name is also unconfirmed
first-party (Numista's docs are Cloudflare-blocked, no live key) - a
third-party Apify wrapper's own input schema uses `minYear`/`maxYear`
naming, which hints the real param might not be a bare `year`. Given
that risk, `year` is passed to `/types` search only as a low-risk
*hint* - if Numista ignores or mis-handles it, the existing issue-level
year check (confirmed correct, per this bug report) still catches
everything; it isn't relied on as a correctness gate.

**How issuer resolution works** (`server/app.py`):
`resolve_numista_issuer_code(country_text)` normalizes the AI's country
string (lowercase), applies a tiny alias map (`uk`→`united kingdom`,
`usa`/`us`→`united states`), then looks it up in a name→code index built
from `fetch_numista_issuers()` - **never a hardcoded issuer code**. The
index is cached in-process for 24h (`_numista_issuer_name_index`, module
globals, no DB table) so a scan doesn't refetch the full issuer list
every time. Any failure (fetch error, no match) returns `None` and is
treated as "use the fallback search," never a fatal error for the scan.

**Primary (structured) search params**: `q=<denomination>`,
`issuer=<resolved code>`, `year=<int>` (only if numeric), `category=coin`,
`count=12` - country name deliberately **not** duplicated in `q` once an
issuer code is supplied.

**Fallback search params** (used when issuer resolution fails, or the
structured search errors/returns zero candidates - logged either way with
why): `q=<denomination>`, `year=<int>` (if available), `category=coin` -
still no free-text country, so it can't reintroduce the original
wrong-country-ranking problem; both paths feed the same unchanged
scoring → shortlist → per-candidate `/issues` → require-a-year-match
pipeline from §17.

**New safety net**: `resolve_numista_type_and_issue` now inspects *every*
shortlisted candidate's issues (not just the first hit) before deciding -
if more than one has a real matching issue for the identified year, it
returns unavailable rather than picking by score. "Confident" now means
*exactly one* candidate survives the factual check.

**Files changed**: `server/app.py` (issuer cache/resolution, rewritten
`search_numista_types`, ambiguity check in `resolve_numista_type_and_issue`,
`_numista_result_list` now also unwraps an `"issuers"` key),
`server/tests/test_numista.py` (13 new tests).

**Not changed** (confirmed): OpenAI identification, quota/rate-limit
handling, the §19 retry-after work, Supabase persistence, auth, badges,
leaderboard, PCGS, scan schema, mock mode (explicitly tested unaffected).

**Tests**: 80/80 Python passing (67 → 80), 31/31 JS passing (unaffected,
no JS touched). Commit `fa2f3bc`, pushed.

**Exact next real scan to run**: the same 2012 UK 20 pence coin again (or
any UK coin), and read Render logs in order: `[numista] issuer
resolution: AI country='United Kingdom' resolved issuer code=...` (does a
real code resolve, and is it right?), `[numista] search params: ...`
(structured attempt), `[numista] candidate count=... (structured
search)` (did issuer-scoped search actually surface the real UK 20p type
this time, instead of Isle of Man?), then the existing `[numista] all
candidates scored`/`issues inspected`/`selected type+issue` lines through
to a price lookup - the first real end-to-end confirmation of the whole
pipeline, including the still-unverified `/types/{id}/issues/{issue_id}/prices`
response shape from §17.

---

## 21. Two small fixes: doubled grade disclaimer + redundant log-scan call

**Trigger**: the user reported two issues from the same real UK 20p scan
session: (1) the result summary showed the grade disclaimer twice back to
back, e.g. "Estimated grade: VF-25 (visual estimate; not professionally
certified) (AI visual estimate, not a professional certified grade)."; (2)
`/api/log-scan` was still being called client-side after
`/api/identify-coin` had already persisted the authoritative scan to
Supabase - flagged as "legacy behavior worth auditing later... not
blocking Numista testing," but grouped under "also fix these."

**Fix 1 - doubled disclaimer** (`server/app.py`, `build_coin_summary`):
`IDENTIFICATION_PROMPT` already instructs the AI to embed its own "visual
estimate, not a professional certified grade" wording directly inside
`estimated_grade` (confirmed - every real scan this session shows the AI
doing exactly that, e.g. "VF-30 (visual estimate; not professionally
certified)", "VF-20 (visual estimate; affected by heavy wear and
damage)"). `build_coin_summary` was *also* appending its own hardcoded
"(AI visual estimate, not a professional certified grade)" after the
grade - stacking a second disclaimer on top of the AI's own. Now just
emits `f"Estimated grade: {grade}."`, trusting the AI's own wording (which
the prompt already requires). Mock mode is unaffected - it uses a
separate hardcoded `MOCK_SUMMARY` constant, not `build_coin_summary` at
all.

**Fix 2 - redundant log-scan call** (`src/screens/scan/ScanScreen.js`):
removed both `logScanToSheet(coinData, user?.name)` call sites (camera and
gallery flows) and the now-unused `logScanToSheet` import from
`../../api/client`. This was a pre-Supabase-migration write to a
SheetDB-backed sheet (`POST /api/log-scan`), redundant since
`/api/identify-coin`'s response already reflects the authoritative
Supabase-persisted row (`scan_row` returned in the body, `onScanSaved?.()`
already triggers the Supabase-backed `refreshScans()` in `Root.js`).

**Side effect flagged, not fixed (out of scope)**: `AdminScreen.js` still
does `GET /api/scans`, which reads the *same* SheetDB sheet `log-scan` used
to write to - its "Total Scans"/per-user breakdown will stop growing with
new scans as a result of Fix 2. This isn't a *new* inconsistency:
`AdminScreen.js` was never part of the Supabase migration described in
§1a (it still separately merges in legacy `AsyncStorage` scan history
too) and was already out of step with the rest of the app, which reads
scan history straight from Supabase (`src/api/scans.js`). A real fix would
point `AdminScreen` at Supabase like everything else - not done here,
flagged for whenever that screen gets attention. Neither the
`/api/log-scan` nor `/api/scans` Flask routes themselves were touched or
removed.

**Tests added** (`server/tests/test_app.py`): `build_coin_summary` no
longer duplicates a disclaimer the AI already included, and still shows a
bare grade cleanly when the AI didn't include one.

**Tests**: 82/82 Python passing (80 → 82), 31/31 JS passing (unaffected -
`ScanScreen.js` isn't unit-tested, same reason as always: it imports
React Native). Commit `124344c`, pushed.

**Not changed**: OpenAI identification, Numista/PCGS, quota/rate-limit
handling, retry-after work, Supabase persistence itself, auth, badges,
leaderboard, scan schema.

---

## 22. Follow-up fix: prefer standard-circulation Numista variant on a year tie

**Trigger**: the §20 issuer-resolution fix worked - a real 2012 UK 20 pence
scan's structured search returned three real candidates, all with a valid
2012 issue: a non-circulating 1/10oz fine-silver type (29106), the
standard circulation type (5628, "Royal Shield"), and a silver-proof
variant of it (208022). The §17 ambiguity guard correctly refused to guess
between them and reported unavailable - correct per its own rules, but
leaving an obvious win on the table: for an ordinary circulating coin, the
right answer among these three is usually clear from information Numista
already returns.

**Exact variant-ranking rule** (`server/app.py`):
`looks_special_or_proof(candidate)` - true when a candidate's
`object_type.name` is anything other than `"Standard circulation coins"`,
**or** its title mentions `proof` / `fine silver` / `fine gold` / `bullion`
/ `specimen` / `commemorative` / `platinum`. Deliberately does **not**
trigger on bare `"silver"`/`"gold"` in a candidate's title - plenty of
genuinely standard circulation coins are historically silver or gold
(e.g. pre-1947 British coinage), and object_type already catches the
modern non-circulating/commemorative cases those bare words were meant to
flag. `ai_indicates_special_variant(identification)` - true when the AI's
own `description`/`special_notes`/`coin_name`/`varieties`/`estimated_grade`
text mentions `proof`/`silver`/`gold`/`platinum`/`bullion`/`specimen`/
`commemorative` (the fuller word list, including bare metal names, is safe
here since a live AI describing an ordinary coin essentially never says
"silver"/"gold" unless it actually means it).

**Whether an existing helper was reused**: no - despite the task
suggesting to check for an existing `looks_special_or_proof()`, none
existed before this change; both classifier functions were built fresh,
reusing only the existing `_text_of()` string-normalization helper.

**Where it plugs in** (`resolve_numista_type_and_issue`, unchanged
ordering otherwise): after the year/issue gate produces its `matches`
list (the mandatory, untouched correctness check), if there's still a tie
**and** the AI didn't itself flag a special variant, narrow `matches` to
whichever aren't `looks_special_or_proof` - but only when at least one
non-special candidate exists; if the narrowed set has exactly one entry,
that's the answer, if it still has 2+ (two circulation-type candidates
still tied) it falls straight through to the existing ambiguous ->
unavailable path unchanged. When the AI *did* flag something special, the
narrowing step is skipped entirely (never force-selects circulation on
the AI's behalf) and the original tie stands, going to the same
ambiguous -> unavailable path.

**Regression test result for the UK 2012 20p**: passes -
`test_uk_2012_20p_regression_prefers_standard_circulation_type_5628` feeds
the exact three real candidates (ids 29106/5628/208022) with an ordinary,
non-special AI description and asserts type **5628 wins**, with issue
`iss-5628-2012`.

**Other new tests, all passing**: AI explicitly saying "silver proof"
does *not* auto-select circulation (stays ambiguous/unavailable, asserted
both as "not 5628" and as the actual `None, None` result); two standard-
circulation candidates that are themselves still tied stay unavailable
(no false narrowing to a single winner); the standard-circulation type
itself lacking a 2012 issue (only the proof variant has one) still
correctly selects the proof one - proves the year/issue gate still wins
over "prefer the ordinary one" when there's no ordinary match to prefer;
plus direct unit tests for both classifier functions.

**Files changed**: `server/app.py` (two new module-level keyword tuples +
two new functions + the narrowing step inserted into
`resolve_numista_type_and_issue`), `server/tests/test_numista.py` (7 new
tests, one new `VariantDisambiguationTests` class).

**Not changed** (confirmed by re-running the full suite unmodified):
OpenAI prompt/schema, issuer lookup (§20), structured search (§20), issue
fetching (§17), auth, quota/rate-limit handling (§18/§19), persistence,
badges/leaderboard, PCGS, scan schema.

**All test results**: 89/89 Python passing (82 → 89, 7 new). 31/31 JS
passing (unaffected - no JS files touched). Commit `3c2a4f3`, pushed.

**Exact next live scan to perform**: the same 2012 UK 20 pence coin (or
any other UK coin) again. Render logs should now show, after the usual
`[numista] all candidates scored`/`issues inspected` lines, a new
`[numista] variant disambiguation: preferring 1 standard-circulation
candidate(s), deprioritizing special-variant match(es): [...]` line
naming the fine-silver and silver-proof candidates as deprioritized,
followed by `[numista] selected type+issue: type_id=5628 ...` and -
finally, for the first time across every real scan so far this session -
an actual `[numista] price response: type_id=5628 issue_id=...` line,
giving the first real confirmation of the still-unverified
`/types/{id}/issues/{issue_id}/prices` response shape from §17.

---

## 23. Follow-up fix: canonical denomination matching + issue-level variant preference

**Trigger**: the §22 fix worked (type 5628 selected correctly for one real
scan), and the very next real UK 2012 20p scan narrowed the problem
further. OpenAI returned denomination `"Twenty pence"` (word form, not
`"20 pence"`). The scorer's denomination check was a raw substring match,
so `"twenty pence"` never matched any Numista title text at all - not
"20 Pence", not "2 Pence", not "50 Pence" - meaning all three scored
identically on country+year alone, and the correct type 5628 stayed
ambiguous with an unrelated type 4039 ("2 Pence"). Separately, once 5628
itself resolves, it has *three* 2012 issues (144284 ordinary, 520198 "BU",
180337 "Proof") that also needed disambiguating.

**Denomination normalization rule** (`server/app.py`):
`normalize_numista_denomination(text)` canonicalizes to `"<digits>
<unit>"` - a small number-word map (one..ninety, hundred, plus simple
compounds like "twenty five") converts word numbers to digits, and a
narrow currency-unit alias map collapses only semantically-safe
singular/plural pairs (`penny`/`pence` -> `pence`, `cent`/`cents` ->
`cent`, `dollar`/`dollars` -> `dollar`, etc.) - deliberately not a general
NLP normalizer, and deliberately **exact-match, never fuzzy**: "2
pence"/"20 pence"/"50 pence" always canonicalize to different strings.
`_numista_title_denomination(title)` extracts a candidate's own
denomination using Numista's `"<denomination> - <series>"` title
convention (the part before the first `" - "`). The existing
`denomination_in_title` scoring key (name kept for compatibility) now
computes via canonical equality instead of a raw substring check.

**Where it plugs in**: `resolve_numista_type_and_issue` gained a new
narrowing step - inserted **before** the existing object_type-based
variant narrowing from §22 - that, when `matches` are still tied after
the year/issue gate, narrows to whichever have the exact canonical
denomination the AI identified. This is what actually lets 5628 "outrank"
4039: the score alone doesn't gate which candidates enter `matches` (only
the coarse `NUMISTA_MATCH_MIN_SCORE`/top-3 cap does), so an explicit
denomination-equality filter was needed, not just a corrected score.
Mirrors the same "narrow by an exact categorical property, never by raw
score" pattern already used for object_type.

**Issue-level variant rule**: `_select_issue_for_year` now prefers,
among same-year issues, whichever has no special `comment`/`finish`/
`description` text (checked via `_looks_special_issue`, matching whole
words only - `{"proof","bu","specimen","pattern","prooflike","matte"}` -
so short keywords like "bu" can't false-positive inside unrelated words
like "about"). Reuses the *same* `ai_indicates_special_variant()` check
from §22's type-level logic: if the AI itself said proof/BU/special, the
ordinary-preference narrowing is skipped entirely (never force-selects
the ordinary issue on the AI's behalf). If narrowing still leaves more
than one ordinary issue (or, when AI-indicated-special, more than one
issue overall), returns `None` - which correctly makes that *type*
register as "no matching issue" one level up, same effect as
type-level ambiguity.

**A pre-existing test's expectation was itself the bug being fixed**:
`test_select_issue_falls_back_to_first_year_match_when_mint_unspecified`
asserted that two indistinguishable issues (different mints, no mint info
available) resolved by blindly picking the first one in list order -
exactly the kind of silent guess this whole matching pipeline has been
built to eliminate. Renamed and changed to assert `None` (ambiguous)
instead, since that's now the correct, honest behavior.

**UK 2012 20p regression result**: passes, at both levels -
`test_uk_2012_20p_regression_with_ai_wording_twenty_pence_outranks_2_pence`
confirms the score comparison (20 Pence scores 5, both 2 Pence and 50
Pence score 3) *and* that `resolve_numista_type_and_issue` now resolves
to type 5628 end-to-end from AI wording `"Twenty pence"`;
`test_ordinary_grade_prefers_the_plain_circulation_issue_over_bu_and_proof`
confirms issue 144284 wins over 520198 (BU) and 180337 (Proof) for an
ordinary VF-25 identification.

**Test totals**: 101/101 Python passing (89 → 101, 12 new). 31/31 JS
passing (unaffected - no JS touched). Commit `55bc51e`, pushed.

**Not changed** (confirmed): OpenAI prompt/schema, issuer lookup/cache,
structured Numista search, candidate count, type-level special-variant
filtering (§22, untouched logic, just reused its AI-intent check), auth,
quota/rate-limit/retry-after logic (§18/§19), persistence,
badges/leaderboard, PCGS, DB schema.

**Exact next live scan expected path**: the same 2012 UK 20 pence coin (or
any UK coin whose AI-reported denomination uses word form, e.g. "Twenty
pence"/"Fifty pence") again. Render logs should now show, in order:
`[numista] all candidates scored: ...` (2 Pence/20 Pence/50 Pence-style
candidates with *different* scores this time, 20 Pence higher) ->
`[numista] denomination disambiguation: narrowing to 1 candidate(s)
matching denomination='20 pence', dropping: [...]` -> the existing
`[numista] selected type+issue: type_id=5628 ...` -> and, if that type has
multiple 2012 issues in real Numista data, a clean resolution to the
ordinary one without an explicit new log line (the choice happens inside
`_select_issue_for_year`, not separately logged at the level `resolve_numista_type_and_issue`
logs at) -> finally, for the first time this session, a real
`[numista] price response: type_id=5628 issue_id=...` line, confirming
the still-unverified issue-price endpoint's actual response shape (open
since §17).

---

## 24. Pending external actions

1. ~~Run this in the Supabase SQL editor~~ — **now believed applied**: the
   real scan in §14 ran with `MOCK_MODE` off and reached
   `check_and_reserve_quota`/`insert_api_usage` without a
   `quota_check_failed` error, which only succeeds if the `service_role`
   grant on `public.api_usage` is in place. Still worth a positive
   confirmation (e.g. re-check via the Supabase SQL editor) rather than
   relying solely on one successful request, but this is no longer an
   open question mark the way it was:
   ```sql
   grant select, insert, update on public.api_usage to service_role;
   ```
   (Equivalently: `supabase/migrations/0002_grant_api_usage_service_role.sql`.)

2. ~~Numista type-detail/pricing endpoint assumptions~~ — **superseded by
   §17**: the `/types/{id}/prices` assumption was wrong (confirmed via a
   third-party SDK to actually be `/types/{id}/issues/{issue_id}/prices`)
   and is now fixed, but still **unconfirmed against a live response** -
   see §17's "exact next real coin test to perform" for what to check.

2b. See §17 for the full matching-algorithm investigation and fix
   (search-vs-scoring-vs-type/issue root cause, before/after algorithm,
   and the specific next real-scan test to run).

3. Also check whether the illegible-year case (§8) now comes back with a
   confidence that actually reads as low/uncertain rather than a high
   number next to "uncertain" - the prompt fix is unverified against a
   live model. (The §14 scan was a fully-legible coin, confidence 96, so
   it didn't exercise this case either.)

4. ~~Test the §13 camera focus change on a real device~~ — **confirmed**:
   the user reported "the zoom change worked" before reporting the §14
   scan-save bug, so `zoom={0.3}` fixed the blur. `BOX_SIZE` 260→230 wasn't
   separately called out, so treat it as fine unless the user says
   otherwise.

5. Watch Render logs for the next `scan_insert_failed` (or a
   `WARNING:supabase_admin:supabase request got a transient ..., retrying`
   line that *doesn't* end in success) to confirm the §14 retry actually
   resolves real-world Supabase gateway blips rather than just passing its
   unit tests.

6. ~~Watch Render logs for the next `[identify] OpenAI usage: ...` line~~ —
   **partially confirmed**: the very next real scan showed
   `input_tokens=4584` (down from ~17.4K) and no `Rate Limit Hit` - §15's
   fix worked for the rate-limit problem specifically. That same scan then
   hit a *different* bug (§16: truncated/empty response from
   `max_output_tokens` being too low), now also fixed but unverified.

7. ~~Watch Render logs for the next `[identify] OpenAI usage: ...` line
   (§16) for a `reasoning=` value~~ — **confirmed fixed**: the very next
   real scan (2012 UK 20 pence) completed successfully:
   `output_tokens=947 (reasoning=720) total_tokens=5531
   response_status=completed`. This is a direct confirmation of the §16
   theory - reasoning spent 720 of the 947 output tokens, leaving 227 for
   the actual JSON answer, comfortably inside the new 2000 cap (vs. the
   old 1000 cap, which the reasoning tokens alone would have blown through
   on their own). Identification, Numista lookup (no confident match, so
   correctly "unavailable"), and scan persistence all completed normally
   end-to-end with no errors.

8. See §17 for the Numista type-vs-issue matching + pricing investigation
   and fix (the "estimated value not available" question) and its "exact
   next real coin test to perform" section.

9. Watch Render logs for the next real OpenAI 429 for the new
   `[identify] OpenAI error response: ...` line (§18) - confirms the
   header/body diagnostics actually surface the account's real rate-limit
   window state (remaining requests/tokens, reset timers) rather than just
   passing its unit tests.

10. See §19 for the `retry_after_seconds`/rate_limit-UI change - watch
    Render logs and the app for the next real OpenAI 429 to confirm the
    bucketed wait text and Try Again/Back to Home split actually appear
    correctly on device.

11. See §20 for the Numista issuer-code/structured-search fix - run the
    "exact next real scan to run" there (a UK coin) to confirm structured
    search actually surfaces the real match instead of Isle of Man
    candidates, and to get the first real confirmation of the issue-price
    endpoint's response shape.

12. See §21 for the doubled-disclaimer and redundant-log-scan fixes - next
    real scan's summary text should show the grade disclaimer once, and
    Render logs should no longer show a `POST /api/log-scan` call
    immediately after a successful `/api/identify-coin`. Separately, if
    `AdminScreen.js` ever needs attention, it should be pointed at Supabase
    like the rest of the app instead of SheetDB/AsyncStorage.

13. See §22 for the variant-disambiguation fix - run the "exact next live
    scan to perform" there (the same UK 2012 20p) to confirm it now
    resolves to type 5628 and to get the first real confirmation of the
    issue-price endpoint's response shape.

14. See §23 for the denomination-normalization + issue-level variant fix -
    run its "exact next live scan expected path" (the same UK 20p) to
    finally confirm an end-to-end confident valuation, including the
    still-unverified issue-price endpoint response shape.

Everything through §23 (code, tests, all commits through `55bc51e`) is
committed and pushed to `origin/seperate`. §15 (rate limit) + §16
(truncated response) are confirmed fixed by real, non-mock scans; §17-§20
(Numista matching/pricing, 429 diagnostics, retry_after_seconds, issuer
resolution), §21 (summary/log-scan fixes), §22 (type-level variant
disambiguation), and §23 (denomination normalization + issue-level
variant preference) are all implemented, tested, and pushed - but no real
scan has yet reached a confident valuation end-to-end (§23's next live
scan is the one most likely to finally do so).
