# MemberForge

MemberForge is a multi-tenant SaaS platform for membership organizations —
chapters, associations, clubs, alumni groups — generalized from a
single-tenant chapter website. Any organization can sign up, get a branded
public site, a member portal, an admin dashboard, and an optional finance
sub-portal, all running on one shared codebase and one shared database.

## Architecture

**Static HTML/CSS/JS + one Supabase project, shared by every tenant.**

There is no build step and no per-tenant copy of these files. The exact
same `index.html` / `admin-dashboard.html` / `member-portal.html` / etc. are
served for every organization. What makes a page "belong" to a given org
happens entirely in the browser, at load time:

1. **Tenant resolution** (`js/org-context.js`) — figures out which org a
   request is for, in order: a `?org=<slug>` query override (local dev), a
   custom domain match, or the request's subdomain (`acme.memberforge.app`
   → slug `acme`).
2. **Branding** — fetches that org's row from `organizations` (name, logo,
   colors, contact info, terminology) and paints the page: CSS custom
   properties (`--accent`, `--ink`, ...) get set at runtime, and any element
   tagged `data-mf="org_name"` / `data-mf="org_logo"` / etc. gets filled in.
   See `css/theme.css` for the token set.
3. **Data scoping** — every table has an `org_id` column and a Row Level
   Security policy that enforces it (see `supabase/schema.sql`). Every
   client-side query goes through `MF.scope(query)` (reads) or
   `MF.stamp(data)` (inserts) to add the `org_id` filter/column.

This is the same pattern several static-site SaaS products use — it needs
no server, works on any static host, and isolation is enforced by Postgres
RLS, not by trusting the client.

### Shared front-end modules

| File | Purpose |
|---|---|
| `js/memberforge-client.js` | One place for the Supabase URL/anon key + a thin PostgREST/RPC client (`sb`). Every page includes this instead of hardcoding credentials. |
| `js/org-context.js` | Tenant resolution + branding engine (`MF`). |
| `js/auth.js` | Session management + a single, consistent authorization model (`MFAuth`) — see below. |
| `js/main.js` | Generic nav/scroll/animation behavior, no branding. |
| `js/news-articles.js` | Shared news-feed rendering used by the homepage and the News page. |
| `css/theme.css` | Base stylesheet; all brand colors are CSS custom properties overwritten at runtime, never hardcoded per page. |

### Data model & authorization

`supabase/schema.sql` is the single source of truth for the database. A few
things worth knowing if you're extending it:

- **One authorization table, not three.** The single-tenant app this was
  generalized from had three independent, inconsistent ways to check who
  could do what (a global admin allowlist, a status flag on the member row,
  and a role string looked up by different, sometimes-incompatible query
  patterns on five different pages — one of which never actually matched
  anything in production). MemberForge has one: `org_admins`
  (`org_id, email, is_full_admin, sections[], finance_role`), looked up
  consistently everywhere via `email` and read helper functions
  (`current_user_can_manage(org_id, section)`, etc.).
- **Permission checks fail closed.** Both in RLS (`org_admins` lookups
  return no rows → `false`) and in the client (`js/auth.js` treats any
  lookup error as "no access"), never falling back to broad/full access.
- **`members.portal_access` can't be self-escalated.** A trigger
  (`protect_member_privileged_fields`) resets `portal_access`/`status`/
  `org_id`/`auth_user_id` back to their prior values on any update that
  isn't performed by an org admin, and forces new self-registrations to
  `'pending'`. The client never attempts to grant its own access.
- **One dues table.** The original app had two competing, half-implemented
  "dues" systems (used by two different sub-apps, with mismatched column
  names between them, and a Stripe path that was never actually reachable
  in one of them). There is now exactly one `dues_payments` table used by
  every surface.

### Storage

Two public Storage buckets: `org-media` (gallery photos, documents, news
images) and `event-flyer-uploads`. Every object path is prefixed
`${org_id}/...` — the storage RLS policies parse that prefix to check the
uploader is an admin of that org, so **always upload under your org's id**.

## Setting up a MemberForge deployment (for the platform operator)

1. **Create a Supabase project.** Run `supabase/schema.sql` in the SQL
   editor. It's idempotent — safe to re-run.
2. **Deploy the edge functions** in `supabase/functions/` (`supabase
   functions deploy <name>` per function, or all at once). Set secrets:
   `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `ANTHROPIC_API_KEY` (for the AI announcement-drafting assist), and a
   transactional-email provider key (Resend, per the original functions).
3. **Point `js/memberforge-client.js` at your project** — set
   `window.MEMBERFORGE_SUPABASE_URL` / `window.MEMBERFORGE_SUPABASE_ANON_KEY`
   (e.g. in a small inline `<script>` before it loads, or edit the file's
   defaults directly) to your project's URL/anon key.
4. **DNS**: point a wildcard subdomain (`*.memberforge.app`) at your static
   host, plus the apex/`www` for the signup/marketing entry point
   (`signup.html`). Any static host that serves the same files regardless
   of hostname works, since tenant resolution happens client-side — GitHub
   Pages does **not** support wildcard custom domains, so use something
   like Netlify, Vercel, or Cloudflare Pages instead. Set
   `window.MEMBERFORGE_ROOT_DOMAIN` (used by `signup.html` and a few edge
   functions building links) to match.
5. A new organization signs up at `signup.html`, which calls the
   `create_organization` SQL RPC — this atomically creates the
   `organizations` row and makes the signing-up user that org's first full
   admin. From there they sign in at `admin-login.html?org=<slug>` and
   configure branding, invite members, etc.

## Feature surface

- Public site: home, about, leadership, events (with free/paid
  registration), membership info, news, gallery, contact, a membership
  inquiry form, and an optional signature-fundraiser microsite.
- Member portal: dashboard, events, meetings (RSVP + QR check-in), dues
  payment, documents, a member directory (with per-member privacy
  controls), a store, a printable digital membership card, newsletters,
  member-submitted announcements/news (moderated), requisitions &
  reimbursements.
- Admin dashboard: members, admin access & permissions, events, a
  fundraiser settings panel, meetings, announcements, moderation queues,
  a newsletter generator (with AI drafting assist), documents, gallery,
  store, leadership/officers, and a per-page website content editor.
- Finance sub-portal: member-facing dues/requisition/reimbursement
  submission plus a treasurer/financial-secretary/president admin console.
- Public kiosk pages for event and meeting check-in.

## What's intentionally out of scope for v1

- **Billing for MemberForge itself** — there's no Stripe subscription flow
  for organizations paying *MemberForge*; `organizations.plan` exists as a
  column for this to hang off later.
- **Custom domain SSL automation** — `organizations.custom_domain` is
  stored and resolved client-side, but provisioning TLS certificates for a
  customer's own domain is a hosting-provider-specific integration left to
  the operator.
- **Public kiosk member search** — `event-checkin.html`/
  `meeting-checkin.html` no longer offer a live member-directory
  autocomplete, since member records now correctly require an
  authenticated org member/admin to read (the original's kiosk pages read
  the directory with the anonymous key, which was a real PII exposure).
  Kiosks still work fully via manual name/email entry.
