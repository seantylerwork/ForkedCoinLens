# CoinLens — session context export (2026-09-12)

Purpose: capture everything done in today's session — implementation,
assumptions, and a live production bug — so it can be pasted as context into
a future session without re-deriving it.

Branch: `seperate`. Latest pushed commit: `d5cd4b7` (origin/seperate).

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

**Status**: fix has been written into the repo (see §4) but **has not yet
been confirmed run** against production by the user — that's the one
pending external action from today.

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

## 5. Pending external action

Run this in the Supabase SQL editor (the one thing from today not yet done):

```sql
grant select, insert, update on public.api_usage to service_role;
```

(Equivalently: run `supabase/migrations/0002_grant_api_usage_service_role.sql`.)

Everything else from today (code, tests, commit, push) is already done and
live on `origin/seperate` at `d5cd4b7`.
