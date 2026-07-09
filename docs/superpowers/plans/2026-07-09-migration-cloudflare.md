# Migration Cloudflare (repairdesk.fr) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish standing up iziGSM on Cloudflare Pages directly (project `izigsm`, account `Contact@soteli.fr`) so `repairdesk.fr` can serve production traffic without depending on Genspark's `gsk hosted deploy`.

**Architecture:** Existing Cloudflare Pages project `izigsm` (already created 2026-07-08) stays as-is. Apply the 31 D1 migrations to the empty `izigsm-production` database, enable R2 and wire the `PHOTOS` binding, set the missing `RESEND_API_KEY` secret, redeploy the current `main` HEAD, validate on `izigsm.pages.dev`, then attach `repairdesk.fr` as a Pages custom domain.

**Tech Stack:** Cloudflare Pages, Cloudflare D1 (SQLite edge), Cloudflare R2, Wrangler CLI (`npx wrangler`, v4.109.0 confirmed available), Cloudflare API via MCP (`cloudflare-api`, account id `88cfb31e7023ac0740536222bda8a8ae`).

## Global Constraints

- No data migration — `izigsm-production` D1 gets schema only (31 migrations), zero data rows expected at the end of this plan.
- Pages now, not Workers — do not convert `wrangler.jsonc` to a Workers config in this plan.
- Never modify the `repairdesk.fr` MX records, the SPF TXT record, or the `webmail.repairdesk.fr` CNAME at any point.
- Never let a secret value (`JWT_SECRET`, `RESEND_API_KEY`) appear in plaintext in the agent conversation.
- Explicit user confirmation is required immediately before Task 8 (attaching `repairdesk.fr` — a production DNS change).
- Repo root for all commands: `C:\Users\Said\Downloads\claude-test\izigsm\webapp` (Bash: `/c/Users/Said/Downloads/claude-test/izigsm/webapp`).
- Cloudflare account: `Contact@soteli.fr` (account id `88cfb31e7023ac0740536222bda8a8ae`). Pages project name: `izigsm`. D1 database: `izigsm-production` (uuid `1e5c6e26-6b55-4b00-bf83-72ba26b6b112`).

---

### Task 1: Install dependencies

**Files:**
- None created/modified — installs into `node_modules/` (gitignored)

**Interfaces:**
- Produces: working `npm run build`, `npm test`, `npx wrangler` commands for all later tasks

- [ ] **Step 1: Install**

Run: `npm install`
Expected: exits 0, `node_modules/` populated, no `npm error` lines in output

- [ ] **Step 2: Verify wrangler is usable from the local install**

Run: `npx wrangler --version`
Expected: prints a version string (e.g. `⛅️ wrangler 4.x.x`), no error

- [ ] **Step 3: Verify test suite still passes on current HEAD**

Run: `npm test`
Expected: all suites pass (18 suites, ~705+ tests — exact count may have grown since `docs/TODO.md` was last updated, but 0 failures expected)

No commit — no files changed in this task.

---

### Task 2: Enable R2 on the Cloudflare account (manual, blocking)

**Files:** none

**Interfaces:**
- Consumes: nothing
- Produces: R2 API calls stop returning error 10042, unblocking Task 4

- [ ] **Step 1: User enables R2**

The user opens the Cloudflare dashboard (`dash.cloudflare.com`, account `Contact@soteli.fr`) → R2 → clicks "Enable R2". This cannot be done via API (confirmed 2026-07-09: `GET /accounts/{id}/r2/buckets` returns `{"code":10042,"message":"Please enable R2 through the Cloudflare Dashboard."}`).

- [ ] **Step 2: Agent verifies R2 is enabled**

Use `mcp__plugin_cloudflare_cloudflare-api__execute` with:
```js
async () => {
  try {
    const r = await cloudflare.request({ method: "GET", path: `/accounts/${accountId}/r2/buckets` });
    return { enabled: true, buckets: r.result?.buckets?.map(b => b.name) };
  } catch (e) {
    return { enabled: false, error: String(e) };
  }
}
```
Expected: `{ enabled: true, buckets: [] }` (empty list is fine — bucket created in Task 4)

Do not proceed to Task 4 until `enabled: true`.

No commit — no files changed in this task.

---

### Task 3: Apply the 31 D1 migrations to `izigsm-production`

**Files:**
- Reads: `migrations/0001_users_roles.sql` through `migrations/0031_marques_modeles_global.sql` (already exist, no changes)

**Interfaces:**
- Consumes: nothing (D1 database already exists, currently 0 tables)
- Produces: `izigsm-production` D1 database with full schema (all tables from the 31 migrations), consumed by Task 6's validation and every later runtime request

- [ ] **Step 1: List pending migrations**

Run: `npx wrangler d1 migrations list izigsm-production --remote`
Expected: lists all 31 migrations as not-yet-applied (since `num_tables` was confirmed 0 on 2026-07-09)

- [ ] **Step 2: Apply migrations**

Run: `npx wrangler d1 migrations apply izigsm-production --remote`
Expected: wrangler prompts to confirm applying 31 migrations against the remote `izigsm-production` database — confirm yes. Output ends with all 31 migrations marked applied, exit code 0.

- [ ] **Step 3: Verify schema is populated**

Use `mcp__plugin_cloudflare_cloudflare-api__execute` with:
```js
async () => {
  const d1 = await cloudflare.request({ method: "GET", path: `/accounts/${accountId}/d1/database/1e5c6e26-6b55-4b00-bf83-72ba26b6b112` });
  return { num_tables: d1.result.num_tables, file_size: d1.result.file_size };
}
```
Expected: `num_tables` > 0 (should be in the 30-40 range given 31 migrations create/alter multiple tables — anything above 0 confirms the migrations landed; cross-check against the migration table list in `docs/ARCHITECTURE_MODULES.md` section 2 if an exact count is needed)

No commit — this task only touches remote D1 state, no local files change.

---

### Task 4: Create the R2 bucket and re-enable the binding

**Files:**
- Modify: `wrangler.jsonc`

**Interfaces:**
- Consumes: R2 enabled on the account (Task 2)
- Produces: `PHOTOS` R2 binding available to the Worker/Pages Functions, consumed by `src/services/photosService.ts` (already implemented, currently returns 503 gracefully when the binding is absent) and by Task 6's deploy

- [ ] **Step 1: Create the bucket**

Run: `npx wrangler r2 bucket create izigsm-photos`
Expected: `Created bucket 'izigsm-photos'` (or similar success message), exit code 0

- [ ] **Step 2: Verify the bucket exists**

Use `mcp__plugin_cloudflare_cloudflare-api__execute` with:
```js
async () => {
  const r = await cloudflare.request({ method: "GET", path: `/accounts/${accountId}/r2/buckets` });
  return r.result.buckets.map(b => b.name);
}
```
Expected: array includes `"izigsm-photos"`

- [ ] **Step 3: Uncomment the R2 binding in `wrangler.jsonc`**

Current (commented) block in `wrangler.jsonc`:
```jsonc
  // "r2_buckets": [
  //   {
  //     "binding":     "PHOTOS",
  //     "bucket_name": "izigsm-photos"
  //   }
  // ]
```

Replace with:
```jsonc
  "r2_buckets": [
    {
      "binding":     "PHOTOS",
      "bucket_name": "izigsm-photos"
    }
  ]
```

- [ ] **Step 4: Regenerate Cloudflare types**

Run: `npm run cf-typegen`
Expected: exits 0, updates the generated `CloudflareBindings` interface to include `PHOTOS: R2Bucket`

- [ ] **Step 5: Verify the project still builds and typechecks**

Run: `npm run build`
Expected: exits 0, `dist/` produced, no TypeScript errors related to `PHOTOS`

- [ ] **Step 6: Commit**

```bash
git add wrangler.jsonc
git commit -m "feat: active le binding R2 PHOTOS (izigsm-photos) — migration Cloudflare"
```

---

### Task 5: Set the `RESEND_API_KEY` secret

**Files:** none

**Interfaces:**
- Consumes: nothing
- Produces: `RESEND_API_KEY` available at runtime to `src/services/emailService.ts`, consumed by Task 7's validation (email-dependent flows: OTP registration, devis emails, relances)

- [ ] **Step 1: User runs the secret command interactively**

The user (not the agent — the key must never appear in the conversation) runs, from `C:\Users\Said\Downloads\claude-test\izigsm\webapp`:

```bash
npx wrangler pages secret put RESEND_API_KEY --project-name izigsm
```

Wrangler will prompt for the value interactively (hidden input). The user pastes the Resend API key from the Resend dashboard and presses enter.

Expected: `✨ Success! Uploaded secret RESEND_API_KEY`

- [ ] **Step 2: Agent verifies the secret is set (name only, never the value)**

Use `mcp__plugin_cloudflare_cloudflare-api__execute` with:
```js
async () => {
  const p = await cloudflare.request({ method: "GET", path: `/accounts/${accountId}/pages/projects/izigsm` });
  return Object.keys(p.result.deployment_configs?.production?.env_vars || {});
}
```
Expected: array includes both `"JWT_SECRET"` and `"RESEND_API_KEY"`

No commit — secrets are not stored in the repo.

---

### Task 6: Build and deploy the current HEAD

**Files:** none (deploys existing `dist/` build output)

**Interfaces:**
- Consumes: R2 binding wired (Task 4), secret set (Task 5), D1 schema present (Task 3)
- Produces: a Pages deployment at commit HEAD, replacing the stale `eddd3af` deployment; consumed by Task 7's validation

- [ ] **Step 1: Confirm current HEAD**

Run: `git log -1 --oneline`
Expected: shows the latest commit (at minimum `5106d93` "docs: spec migration Cloudflare..." or later — must be newer than `eddd3af`, the currently-deployed commit)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exits 0, `dist/` regenerated with the R2-enabled build from Task 4

- [ ] **Step 3: Deploy**

Run: `npx wrangler pages deploy dist --project-name izigsm --branch main`
Expected: wrangler uploads the build, prints a new deployment URL (`https://<hash>.izigsm.pages.dev`) and `✨ Deployment complete!`

- [ ] **Step 4: Verify the deployment is tied to the current commit**

Use `mcp__plugin_cloudflare_cloudflare-api__execute` with:
```js
async () => {
  const d = await cloudflare.request({ method: "GET", path: `/accounts/${accountId}/pages/projects/izigsm/deployments` });
  return d.result[0]; // most recent
}
```
Expected: `latest_stage.status === "success"`, `created_on` is recent (within the last few minutes)

No commit — deployment is not a git action.

---

### Task 7: Functional validation on `izigsm.pages.dev`

**Files:** none

**Interfaces:**
- Consumes: deployment from Task 6
- Produces: confidence gate before Task 8 (DNS change) — do not proceed to Task 8 if any check fails

- [ ] **Step 1: User checks health endpoint from a real browser**

Note: agent-issued requests to `*.pages.dev` return `403 Forbidden: requests to izigsm.pages.dev are not allowed` (Cloudflare Bot Fight Mode blocking non-browser traffic) — this check must be done by the user, not the agent.

User opens `https://izigsm.pages.dev/api/health` in a browser.
Expected: JSON response `{"status":"ok","app":"iziGSM","version":"2.45.0", ...}` (version should match `src/index.tsx`, not the stale `2.44.0` seen on the old Genspark deployment)

- [ ] **Step 2: User checks the login page renders**

User opens `https://izigsm.pages.dev/login`.
Expected: login page renders, no sidebar/nav errors (regression check for the `3856e4f`/`5fd3ddf` nav fixes)

- [ ] **Step 3: User registers a test boutique end-to-end**

User goes through `https://izigsm.pages.dev/register`, creates a test account, checks the OTP email arrives (validates `RESEND_API_KEY` from Task 5) and confirms login works after verification.
Expected: OTP email received, verification succeeds, login redirects to `/dashboard`

- [ ] **Step 4: User creates one ticket and uploads one photo**

From the dashboard, user creates a client + ticket, then uploads a photo on the ticket (validates the R2 binding from Task 4).
Expected: photo uploads without error, appears in the gallery, no 503 from `photosService.ts`

- [ ] **Step 5: Agent confirms no server errors via deployment tail**

Run: `npx wrangler pages deployment tail --project-name izigsm` in a background shell while the user performs Steps 2-4, watching for `500`/uncaught exceptions.
Expected: no 5xx entries during the manual test pass

If any step fails, stop — fix the underlying issue, redeploy (repeat Task 6), and re-run this task before proceeding.

---

### Task 8: Attach `repairdesk.fr` as a custom domain

**Files:** none

**Interfaces:**
- Consumes: Task 7 passed (explicit go-ahead)
- Produces: `repairdesk.fr` → Pages project `izigsm`; consumed by Task 9's DNS verification

- [ ] **Step 1: Get explicit user confirmation**

Ask the user directly: "Task 7 validation passed — confirmer l'attachement de `repairdesk.fr` au projet Pages `izigsm` maintenant ?" Do not proceed without an explicit yes in this session.

- [ ] **Step 2: Attach the domain**

Use `mcp__plugin_cloudflare_cloudflare-api__execute` with:
```js
async () => {
  const r = await cloudflare.request({
    method: "POST",
    path: `/accounts/${accountId}/pages/projects/izigsm/domains`,
    body: { name: "repairdesk.fr" }
  });
  return r;
}
```
Expected: `success: true`, `result.status` is `"pending"` or `"active"` (Cloudflare auto-provisions the DNS record + TLS cert since the zone is on the same account)

- [ ] **Step 3: Poll until active**

Use `mcp__plugin_cloudflare_cloudflare-api__execute` with:
```js
async () => {
  const r = await cloudflare.request({ method: "GET", path: `/accounts/${accountId}/pages/projects/izigsm/domains/repairdesk.fr` });
  return { status: r.result.status, verification_data: r.result.verification_data };
}
```
Expected: `status` becomes `"active"` within a few minutes (SSL cert provisioning). Re-run this check every 30-60s if still `"pending"`.

No commit — Cloudflare-side configuration only.

---

### Task 9: Verify mail DNS records are untouched

**Files:** none

**Interfaces:**
- Consumes: Task 8 complete
- Produces: final confirmation the migration didn't break email

- [ ] **Step 1: Re-fetch the zone's DNS records**

Use `mcp__plugin_cloudflare_cloudflare-api__execute` with:
```js
async () => {
  const zoneId = "2d24d2ee38701d8595045447e2f3371f";
  const r = await cloudflare.request({ method: "GET", path: `/zones/${zoneId}/dns_records`, query: { per_page: 100 } });
  return r.result.map(rec => ({ type: rec.type, name: rec.name, content: rec.content }));
}
```

- [ ] **Step 2: Confirm mail records are present and unchanged**

Expected in the output:
- `MX` record(s) still pointing to `spool.mail.gandi.net` and `fb.mail.gandi.net`
- `TXT` record on `repairdesk.fr` still containing `v=spf1 include:_mailcust.gandi.net`
- `CNAME` `webmail.repairdesk.fr` still → `webmail.gandi.net`
- `CNAME` `www.repairdesk.fr` still → `webredir.vip.gandi.net`
- The root `repairdesk.fr` record now points at the Cloudflare Pages project (added/modified by Task 8) — this is the only expected change

If any mail record is missing or altered, stop immediately and restore it manually from `izigsm/repairdesk.fr.txt` (the DNS export backup) before doing anything else.

- [ ] **Step 3: Update project docs**

Update `project-docs/current-state.md` and `project-docs/decisions.md` to record the migration as complete, with the final deployment commit hash and timestamp.

```bash
git add project-docs/
git commit -m "docs: migration Cloudflare repairdesk.fr terminée"
```

Migration complete.
