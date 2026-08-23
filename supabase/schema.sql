-- =============================================================================
-- MemberForge — master multi-tenant schema
-- Run this once in the Supabase SQL editor on a fresh project.
--
-- ONE Supabase project serves every tenant organization. Isolation is
-- enforced by an `org_id` column on every tenant-scoped table plus Row
-- Level Security — never by separate databases/projects per customer.
--
-- This schema was generalized from a single-tenant chapter website. Along
-- the way it fixes several real bugs found in that app rather than
-- reproducing them:
--   * Admin/member/finance authorization used to be three independent,
--     inconsistent checks (a global admin allowlist, a status flag on the
--     member row, and a role string looked up two incompatible ways across
--     five pages). Here it is ONE table (org_admins) per org, looked up
--     consistently by email everywhere.
--   * RLS write policies used to be `to authenticated using (true)` on most
--     content tables — i.e. ANY signed-in user (not just admins) could
--     write. Every admin-write policy below is gated on org_admins section
--     permissions instead.
--   * Permission-lookup failures used to fail OPEN (treated as full admin).
--     The application-layer equivalent (js/auth.js) fails CLOSED; the
--     helper functions below simply return false/no rows on no match.
--   * Two competing, half-broken "dues" systems (dues_payments vs.
--     finance_payments, with mismatched column names between the two pages
--     that wrote to the latter) are merged into one dues_payments table.
--   * members.id vs auth_user_id confusion (some pages compared a bigint PK
--     against the Auth UUID and could never match) is resolved by always
--     joining through members.auth_user_id.
--
-- Safe to re-run: every statement is create-if-not-exists / drop-and-recreate.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- ORGANIZATIONS (tenants)
-- =============================================================================

create table if not exists public.organizations (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  tagline           text,
  logo_url          text,
  favicon_url       text,
  hero_image_url    text,
  accent_color      text default '#4F46E5',
  ink_color         text default '#0b0f19',
  contact_email     text,
  contact_phone     text,
  contact_address   text,
  social_links      jsonb not null default '{}'::jsonb,   -- {facebook, instagram, youtube, linkedin, x}
  terminology       jsonb not null default '{}'::jsonb,   -- {member_noun, member_noun_plural, org_unit_noun, leader_noun, creed, ...}
  plan              text not null default 'free',   -- 'free' | 'start' | 'growth' | 'pro'
  custom_domain     text unique,
  owner_user_id     uuid references auth.users(id),
  -- Platform subscription billing (MemberForge charging the org, not the
  -- org's own dues/events/store — those go through stripe-checkout with a
  -- separate metadata.kind). Written only by the stripe-subscription-checkout
  -- and stripe-webhook edge functions (service role) — see
  -- protect_org_billing_fields below, which pins these back to their old
  -- values on any client-initiated update.
  stripe_customer_id     text,
  stripe_subscription_id text,
  subscription_status    text,   -- 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | null
  plan_price_id           text,   -- the Stripe Price ID currently subscribed
  plan_updated_at         timestamptz,
  suspended         boolean not null default false,
  suspended_reason  text,
  suspended_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- The block above only takes effect on a brand-new database. For a database
-- where `organizations` already exists, add the new columns explicitly —
-- `create table if not exists` is a no-op on an existing table, so it will
-- never add these on its own. All of the below is safe to re-run.
alter table public.organizations add column if not exists stripe_customer_id text;
alter table public.organizations add column if not exists stripe_subscription_id text;
alter table public.organizations add column if not exists subscription_status text;
alter table public.organizations add column if not exists plan_price_id text;
alter table public.organizations add column if not exists plan_updated_at timestamptz;
alter table public.organizations alter column plan set default 'free';
update public.organizations set plan = 'free' where plan = 'trial';

-- Platform-level suspension (distinct from an org's own plan/subscription
-- status) — set by a platform superadmin, enforced in js/org-context.js by
-- showing every visitor a "this organization has been suspended" screen
-- instead of normal branding, regardless of how the tenant was resolved.
alter table public.organizations add column if not exists suspended boolean not null default false;
alter table public.organizations add column if not exists suspended_reason text;
alter table public.organizations add column if not exists suspended_at timestamptz;

create unique index if not exists organizations_stripe_customer_id_uidx
  on public.organizations (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists organizations_stripe_subscription_id_uidx
  on public.organizations (stripe_subscription_id) where stripe_subscription_id is not null;

-- Member cap per plan. Kept as a function (not a stored column) so the
-- limit for every org of a given plan lives in exactly one place.
create or replace function public.plan_member_limit(p_plan text)
returns integer language sql immutable as $$
  select case p_plan
    when 'start'  then 250
    when 'growth' then 1000
    when 'pro'    then null   -- unlimited
    else 50                   -- 'free' and any unrecognized value
  end;
$$;

create or replace function public.current_org_member_limit(p_org_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select public.plan_member_limit(plan) from public.organizations where id = p_org_id;
$$;
grant execute on function public.plan_member_limit(text) to anon, authenticated;
grant execute on function public.current_org_member_limit(uuid) to anon, authenticated;

alter table public.organizations enable row level security;

drop policy if exists "organizations_read_all" on public.organizations;
create policy "organizations_read_all"
on public.organizations for select
to anon, authenticated
using (true);

-- =============================================================================
-- ORG_ADMINS — replaces chapter_admins + members.finance_role + the ad hoc
-- "chapter_role" text-matching from the original app. One row per
-- (org, admin person). is_full_admin/sections gate the admin dashboard;
-- finance_role gates the finance sub-portal. Both live in the same table so
-- there is exactly one place authorization is checked, per org.
-- =============================================================================

create table if not exists public.org_admins (
  id              bigint generated always as identity primary key,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  member_id       bigint,
  is_full_admin   boolean not null default false,
  sections        text[] not null default '{}',
  finance_role    text,                 -- null | 'treasurer' | 'financial_secretary' | 'president'
  granted_at      timestamptz not null default now(),
  granted_by      text not null default '',
  unique (org_id, email)
);

alter table public.org_admins enable row level security;

create or replace function public.current_user_email()
returns text language sql stable as $$
  select lower(trim(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- Platform superadmin — has cross-tenant access (browse/replan/suspend/
-- delete any org, impersonate any org's admin for support), unlike every
-- other role in this schema, which is always scoped to one org_id. There is
-- exactly one holder for now, hardcoded here rather than in a grantable
-- table, matching the operator's current single-owner setup — change the
-- email below (and redeploy schema.sql) to change who holds it, or replace
-- this function's body with a real platform_admins table lookup if/when
-- there's more than one.
create or replace function public.current_user_is_platform_admin()
returns boolean language sql stable as $$
  select public.current_user_email() = 'hello@mc3techlabs.com';
$$;
grant execute on function public.current_user_is_platform_admin() to authenticated;

create or replace function public.current_user_is_org_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_admins
    where org_id = p_org_id and lower(trim(email)) = public.current_user_email()
  );
$$;

create or replace function public.current_user_is_full_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select is_full_admin from public.org_admins
    where org_id = p_org_id and lower(trim(email)) = public.current_user_email()
  ), false);
$$;

create or replace function public.current_user_can_manage(p_org_id uuid, p_section text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_admins
    where org_id = p_org_id
      and lower(trim(email)) = public.current_user_email()
      and (is_full_admin or p_section = any(sections))
  );
$$;

create or replace function public.current_user_finance_role(p_org_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select finance_role from public.org_admins
  where org_id = p_org_id and lower(trim(email)) = public.current_user_email()
  limit 1;
$$;

create or replace function public.org_admin_count(p_org_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.org_admins where org_id = p_org_id;
$$;

grant execute on function public.current_user_email() to anon, authenticated;
grant execute on function public.current_user_is_org_admin(uuid) to authenticated;
grant execute on function public.current_user_is_full_admin(uuid) to authenticated;
grant execute on function public.current_user_can_manage(uuid, text) to authenticated;
grant execute on function public.current_user_finance_role(uuid) to authenticated;
grant execute on function public.org_admin_count(uuid) to authenticated;

-- Org admins with the 'settings' section (or full admin) can edit their own
-- org's branding/contact/terminology. Note: this deliberately does NOT allow
-- changing `slug` or `custom_domain` via ordinary UPDATE — do that through a
-- dedicated flow later if needed; for now those columns are effectively
-- immutable post-signup since nothing in the app exposes editing them.
drop policy if exists "organizations_update_settings_admin" on public.organizations;
create policy "organizations_update_settings_admin"
on public.organizations for update
to authenticated
using (public.current_user_can_manage(id, 'settings'))
with check (public.current_user_can_manage(id, 'settings'));

-- RLS only gates which ROWS an admin can update, not which COLUMNS — without
-- this, any admin with 'settings' access could PATCH plan/stripe_* directly
-- via PostgREST and grant their own org a paid plan for free. Only a
-- service-role write (the stripe-subscription-checkout and stripe-webhook
-- edge functions) may change these; every other update gets them pinned
-- back to their prior values, same pattern as protect_member_privileged_fields.
create or replace function public.protect_org_billing_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service_role: the stripe-subscription-checkout/stripe-webhook edge
  -- functions, writing real billing state.
  -- platform admin: the platform_set_org_plan/platform_set_org_suspended
  -- RPCs, which run as this org admin's own session (not service_role) but
  -- are themselves already gated by current_user_is_platform_admin().
  if auth.role() = 'service_role' or public.current_user_is_platform_admin() then
    new.updated_at := now();
    return new;
  end if;
  new.plan := old.plan;
  new.stripe_customer_id := old.stripe_customer_id;
  new.stripe_subscription_id := old.stripe_subscription_id;
  new.subscription_status := old.subscription_status;
  new.plan_price_id := old.plan_price_id;
  new.plan_updated_at := old.plan_updated_at;
  new.suspended := old.suspended;
  new.suspended_reason := old.suspended_reason;
  new.suspended_at := old.suspended_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists organizations_protect_billing_fields on public.organizations;
create trigger organizations_protect_billing_fields
before update on public.organizations
for each row execute function public.protect_org_billing_fields();

drop policy if exists "org_admins_select_self" on public.org_admins;
create policy "org_admins_select_self"
on public.org_admins for select
to authenticated
using (lower(trim(email)) = public.current_user_email());

drop policy if exists "org_admins_select_all_for_full_admins" on public.org_admins;
create policy "org_admins_select_all_for_full_admins"
on public.org_admins for select
to authenticated
using (public.current_user_is_full_admin(org_id));

drop policy if exists "org_admins_delete" on public.org_admins;
create policy "org_admins_delete"
on public.org_admins for delete
to authenticated
using (
  public.current_user_is_full_admin(org_id)
  and public.org_admin_count(org_id) > 1
  and lower(trim(email)) <> public.current_user_email()
);
-- Inserts/updates to org_admins happen only via the grant-org-admin Edge
-- Function (service role), same pattern as the original grant-chapter-admin.

-- =============================================================================
-- MEMBERS
-- =============================================================================

create table if not exists public.members (
  id                    bigint generated always as identity primary key,
  org_id                uuid not null references public.organizations(id) on delete cascade,
  auth_user_id          uuid references auth.users(id),
  member_number         text,
  first_name            text not null default '',
  middle_name           text,
  last_name             text not null default '',
  suffix                text,
  email                 text,
  phone                 text,
  birthday              text,
  city                  text,
  state                 text,
  member_since          text,
  joined_at             text,
  joined_via            text,
  college               text,
  is_lifetime_member     boolean not null default false,
  lifetime_member_number text,
  lifetime_member_date   date,
  org_active_date       date,
  renewal_date          text,
  bio                   text,
  linkedin              text,
  photo_url             text,
  share_email           boolean not null default true,
  share_phone           boolean not null default true,
  military_service      boolean not null default false,
  military_branch       text,
  status                text not null default 'pending',   -- 'active' | 'pending' | 'inactive'
  portal_access         text not null default 'pending',   -- 'pending' | 'granted' | 'revoked' | 'visiting'
  member_type           text default 'active',             -- 'active'|'financial'|'non-financial'|'life'|'honorary'
  compliance            jsonb not null default '{}'::jsonb, -- flexible bucket for org-defined certifications/compliance flags
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, auth_user_id)
);

create index if not exists members_org_email_idx on public.members (org_id, lower(email));
create index if not exists members_org_number_idx on public.members (org_id, member_number);

alter table public.members enable row level security;

create or replace function public.current_user_is_org_member(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where org_id = p_org_id and auth_user_id = auth.uid() and portal_access = 'granted'
  );
$$;
grant execute on function public.current_user_is_org_member(uuid) to authenticated;

drop policy if exists "members_select_self" on public.members;
create policy "members_select_self"
on public.members for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists "members_select_directory" on public.members;
create policy "members_select_directory"
on public.members for select
to authenticated
using (public.current_user_is_org_member(org_id) or public.current_user_is_org_admin(org_id));

drop policy if exists "members_insert_self" on public.members;
create policy "members_insert_self"
on public.members for insert
to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists "members_update_self" on public.members;
create policy "members_update_self"
on public.members for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

drop policy if exists "members_admin_all" on public.members;
create policy "members_admin_all"
on public.members for all
to authenticated
using (public.current_user_can_manage(org_id, 'members'))
with check (public.current_user_can_manage(org_id, 'members'));

-- A self-service profile edit (members_update_self above) must not be able
-- to smuggle in a portal_access/status/org_id/auth_user_id change — that
-- was a real bug in the app this schema was generalized from (the member
-- portal auto-granted its own access on first login). Enforce it here with
-- a trigger rather than a self-referential RLS check, which is fragile.
create or replace function public.protect_member_privileged_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_is_org_admin(new.org_id) then
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.portal_access := old.portal_access;
    new.status := old.status;
    new.member_type := old.member_type;
    new.org_id := old.org_id;
    new.auth_user_id := old.auth_user_id;
  else -- INSERT: a self-registering member always starts pending, never admin-set fields
    new.portal_access := 'pending';
    new.status := coalesce(new.status, 'pending');
    new.member_type := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists members_protect_privileged_fields on public.members;
create trigger members_protect_privileged_fields
before insert or update on public.members
for each row execute function public.protect_member_privileged_fields();

-- Enforce the org's plan member cap on INSERT only — never on UPDATE, so
-- editing an existing member's profile still works even if the org is
-- currently at/over its cap (e.g. right after a downgrade). Applies to both
-- the self-registration and admin-add insert paths equally, since both go
-- through this same members table.
create or replace function public.enforce_member_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  limit_n integer;
  current_n integer;
  org_plan text;
begin
  limit_n := public.current_org_member_limit(new.org_id);
  if limit_n is null then
    return new; -- unlimited plan (pro)
  end if;
  select count(*) into current_n from public.members where org_id = new.org_id;
  if current_n >= limit_n then
    select plan into org_plan from public.organizations where id = new.org_id;
    raise exception 'Member limit reached for the % plan (% members). Upgrade your plan to add more members.',
      coalesce(org_plan, 'free'), limit_n;
  end if;
  return new;
end;
$$;

drop trigger if exists members_enforce_cap on public.members;
create trigger members_enforce_cap
before insert on public.members
for each row execute function public.enforce_member_cap();

-- =============================================================================
-- SITE CONTENT (generic KV CMS) + PAGE SECTIONS (per-page rich content)
-- =============================================================================

create table if not exists public.site_content (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  content_key   text not null,
  content_json  jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  primary key (org_id, content_key)
);

create table if not exists public.page_sections (
  org_id         uuid not null references public.organizations(id) on delete cascade,
  page_id        text not null,
  section_key    text not null,
  content_html   text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (org_id, page_id, section_key)
);

alter table public.site_content enable row level security;
alter table public.page_sections enable row level security;

-- site_content is a shared key/value table (home page, officers, past
-- leaders, news articles, event gallery, member directory bulk-edit all
-- live here under different content_key values) — map each key to the
-- admin section that owns it, same pattern as the original single-tenant app.
create or replace function public.site_content_section_key(key text)
returns text language sql immutable as $$
  select case key
    when 'home'              then 'pages'
    when 'officers'          then 'officers'
    when 'president'         then 'officers'
    when 'past_presidents'   then 'presidents'
    when 'news_articles'     then 'news-manager'
    when 'event_gallery'     then 'gallery'
    when 'member_directory'  then 'members'
    when 'fundraiser_settings' then 'fundraiser'
    when 'finance_dues_config' then 'dues-admin'
    when 'finance_dashboard_snapshot' then 'dues-admin'
    else 'settings'
  end;
$$;

drop policy if exists "site_content_read_all" on public.site_content;
create policy "site_content_read_all" on public.site_content for select to anon, authenticated using (true);
drop policy if exists "site_content_write_auth" on public.site_content;
create policy "site_content_write_auth" on public.site_content for all to authenticated
using ( public.current_user_can_manage(org_id, public.site_content_section_key(content_key)) )
with check ( public.current_user_can_manage(org_id, public.site_content_section_key(content_key)) );

drop policy if exists "page_sections_read_all" on public.page_sections;
create policy "page_sections_read_all" on public.page_sections for select to anon, authenticated using (true);
drop policy if exists "page_sections_write_auth" on public.page_sections;
create policy "page_sections_write_auth" on public.page_sections for all to authenticated
using ( public.current_user_can_manage(org_id, 'pages') )
with check ( public.current_user_can_manage(org_id, 'pages') );

-- =============================================================================
-- EVENTS, EVENT REGISTRATIONS, EVENT ATTENDANCE
-- =============================================================================

create table if not exists public.events (
  id                              uuid primary key default gen_random_uuid(),
  org_id                          uuid not null references public.organizations(id) on delete cascade,
  name                            text not null,
  location                        text,
  datetime                        text,
  event_date                      date,
  sort_order                      integer,
  description                     text,
  reg_url                         text,
  flyer                           text,
  featured                        boolean not null default false,
  sponsor_enabled                 boolean not null default false,
  sponsor_url                     text,
  sponsor_label                   text default 'Become a Sponsor',
  free_registration_enabled       boolean not null default false,
  free_registration_url           text,
  paid_registration_enabled       boolean not null default false,
  members_only                    boolean not null default false,
  chapter_registration_enabled    boolean not null default false,
  registration_fee_cents          integer not null default 0,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

create table if not exists public.event_registrations (
  id                          bigint generated always as identity primary key,
  org_id                      uuid not null references public.organizations(id) on delete cascade,
  event_id                    uuid references public.events(id) on delete set null,
  full_name                   text not null default '',
  phone                       text not null default '',
  email                       text not null default '',
  payment_status              text not null default 'free',
  amount_cents                integer not null default 0,
  stripe_checkout_session_id  text,
  created_at                  timestamptz not null default now()
);

create unique index if not exists event_registrations_stripe_session_uidx
  on public.event_registrations (stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create unique index if not exists event_registrations_email_event_uidx
  on public.event_registrations (event_id, lower(trim(email))) where event_id is not null;

create table if not exists public.event_attendance (
  id             bigint generated always as identity primary key,
  org_id         uuid not null references public.organizations(id) on delete cascade,
  event_id       uuid references public.events(id) on delete cascade,
  member_email   text,
  member_name    text not null,
  checked_in_at  timestamptz not null default now()
);
create unique index if not exists event_attendance_event_email_uidx
  on public.event_attendance (event_id, lower(member_email)) where member_email is not null;

alter table public.events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.event_attendance enable row level security;

drop policy if exists "events_read_all" on public.events;
create policy "events_read_all" on public.events for select to anon, authenticated using (true);
drop policy if exists "events_write_auth" on public.events;
create policy "events_write_auth" on public.events for all to authenticated
using ( public.current_user_can_manage(org_id, 'events') ) with check ( public.current_user_can_manage(org_id, 'events') );

drop policy if exists "event_registrations_insert_free_anon" on public.event_registrations;
create policy "event_registrations_insert_free_anon"
on public.event_registrations for insert to anon, authenticated
with check (
  payment_status = 'free' and coalesce(amount_cents, 0) = 0 and event_id is not null
  and coalesce(nullif(trim(stripe_checkout_session_id), ''), null) is null
  and org_id = (select e.org_id from public.events e where e.id = event_id)
);
drop policy if exists "event_registrations_read_auth" on public.event_registrations;
create policy "event_registrations_read_auth" on public.event_registrations for select to authenticated
using ( public.current_user_can_manage(org_id, 'events') );
drop policy if exists "event_registrations_delete_auth" on public.event_registrations;
create policy "event_registrations_delete_auth" on public.event_registrations for delete to authenticated
using ( public.current_user_can_manage(org_id, 'events') );

drop policy if exists "event_attendance_insert_anon" on public.event_attendance;
create policy "event_attendance_insert_anon" on public.event_attendance for insert to anon, authenticated
with check ( event_id is not null and org_id = (select e.org_id from public.events e where e.id = event_id) );
drop policy if exists "event_attendance_read_auth" on public.event_attendance;
create policy "event_attendance_read_auth" on public.event_attendance for select to authenticated
using ( public.current_user_can_manage(org_id, 'events') );

-- Public free registration (bypasses RLS safely via SECURITY DEFINER)
create or replace function public.register_for_event_free(
  p_org_id uuid, p_event_id uuid, p_full_name text, p_phone text, p_email text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if p_event_id is null then raise exception 'Event is required'; end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and e.org_id = p_org_id) then
    raise exception 'Event not found';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Please enter your name'; end if;
  if length(trim(coalesce(p_phone, ''))) < 7 then raise exception 'Please enter a valid phone number'; end if;
  if position('@' in coalesce(p_email, '')) <= 1 then raise exception 'Please enter a valid email address'; end if;
  if exists (
    select 1 from public.event_registrations r
    where r.event_id = p_event_id and lower(trim(r.email)) = lower(trim(p_email))
  ) then
    raise exception 'You are already registered for this event';
  end if;

  insert into public.event_registrations (org_id, event_id, full_name, phone, email, payment_status, amount_cents)
  values (p_org_id, p_event_id, trim(p_full_name), trim(p_phone), trim(lower(p_email)), 'free', 0)
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.register_for_event_free(uuid, uuid, text, text, text) from public;
grant execute on function public.register_for_event_free(uuid, uuid, text, text, text) to anon, authenticated;

-- =============================================================================
-- ANNOUNCEMENTS, NEWSLETTER TEMPLATES, MEMBERSHIP INQUIRIES
-- (membership_inquiries generalizes the original "visiting brothers" form —
-- any prospective member/guest reaching out to an org, not just fraternity
-- members visiting a chapter.)
-- =============================================================================

create table if not exists public.announcements (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  text        text not null default '',
  link_text   text,
  link_url    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.newsletter_templates (
  id             bigint generated always as identity primary key,
  org_id         uuid not null references public.organizations(id) on delete cascade,
  template_name  text not null,
  subject        text not null default '',
  preheader      text not null default '',
  sections_json  jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.membership_inquiries (
  id                  bigint generated always as identity primary key,
  org_id              uuid not null references public.organizations(id) on delete cascade,
  status              text not null default 'pending',   -- 'pending' | 'approved' | 'declined'
  first_name          text not null default '',
  last_name           text not null default '',
  email               text not null default '',
  phone               text not null default '',
  city                text not null default '',
  state               text not null default '',
  message             text not null default '',
  referred_by         text not null default '',
  details             jsonb not null default '{}'::jsonb, -- flexible bucket for org-custom inquiry fields
  submitted_at        timestamptz not null default now(),
  reviewed_at         timestamptz,
  updated_at          timestamptz not null default now()
);

alter table public.announcements enable row level security;
alter table public.newsletter_templates enable row level security;
alter table public.membership_inquiries enable row level security;

drop policy if exists "announcements_read_all" on public.announcements;
create policy "announcements_read_all" on public.announcements for select to anon, authenticated using (true);
drop policy if exists "announcements_write_auth" on public.announcements;
create policy "announcements_write_auth" on public.announcements for all to authenticated
using ( public.current_user_can_manage(org_id, 'announcements') ) with check ( public.current_user_can_manage(org_id, 'announcements') );

-- Members read the newsletter archive too (member-portal.html's
-- Newsletters panel), not just admins editing/sending them.
drop policy if exists "newsletter_templates_read_auth" on public.newsletter_templates;
create policy "newsletter_templates_read_auth" on public.newsletter_templates for select to authenticated
using ( public.current_user_is_org_admin(org_id) or public.current_user_is_org_member(org_id) );
drop policy if exists "newsletter_templates_write_auth" on public.newsletter_templates;
create policy "newsletter_templates_write_auth" on public.newsletter_templates for all to authenticated
using ( public.current_user_can_manage(org_id, 'newsletter') ) with check ( public.current_user_can_manage(org_id, 'newsletter') );

drop policy if exists "membership_inquiries_insert_anon" on public.membership_inquiries;
create policy "membership_inquiries_insert_anon" on public.membership_inquiries for insert to anon, authenticated with check (true);
drop policy if exists "membership_inquiries_write_auth" on public.membership_inquiries;
create policy "membership_inquiries_write_auth" on public.membership_inquiries for all to authenticated
using ( public.current_user_can_manage(org_id, 'members') ) with check ( public.current_user_can_manage(org_id, 'members') );

insert into public.site_content select id, 'payments', '{"dues_amount_cents": 15000}'::jsonb, now() from public.organizations
on conflict (org_id, content_key) do nothing;

-- =============================================================================
-- MEETINGS, RSVPS, ATTENDANCE
-- =============================================================================

create table if not exists public.meetings (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  title         text not null,
  meeting_date  date not null,
  start_time    time,
  end_time      time,
  location      text,
  agenda        text,
  created_by    text,
  created_at    timestamptz not null default now()
);

create table if not exists public.meeting_rsvps (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  meeting_id    bigint references public.meetings(id) on delete cascade,
  member_id     bigint references public.members(id),
  member_name   text,
  member_email  text,
  response      text not null,   -- 'yes' | 'no' | 'maybe'
  updated_at    timestamptz not null default now(),
  unique (meeting_id, member_id)
);

create table if not exists public.meeting_attendance (
  id             bigint generated always as identity primary key,
  org_id         uuid not null references public.organizations(id) on delete cascade,
  meeting_id     bigint references public.meetings(id) on delete cascade,
  member_id      bigint references public.members(id),
  member_email   text,
  member_name    text not null,
  checked_in_at  timestamptz not null default now()
);

alter table public.meetings enable row level security;
alter table public.meeting_rsvps enable row level security;
alter table public.meeting_attendance enable row level security;

drop policy if exists "meetings_read_members" on public.meetings;
create policy "meetings_read_members" on public.meetings for select to anon, authenticated using (true);
drop policy if exists "meetings_write_auth" on public.meetings;
create policy "meetings_write_auth" on public.meetings for all to authenticated
using ( public.current_user_can_manage(org_id, 'meetings') ) with check ( public.current_user_can_manage(org_id, 'meetings') );

drop policy if exists "meeting_rsvps_upsert_member" on public.meeting_rsvps;
create policy "meeting_rsvps_upsert_member" on public.meeting_rsvps for all to authenticated
using ( public.current_user_is_org_member(org_id) or public.current_user_can_manage(org_id, 'meetings') )
with check ( public.current_user_is_org_member(org_id) or public.current_user_can_manage(org_id, 'meetings') );

drop policy if exists "meeting_attendance_insert_anon" on public.meeting_attendance;
create policy "meeting_attendance_insert_anon" on public.meeting_attendance for insert to anon, authenticated
with check ( meeting_id is not null and org_id = (select m.org_id from public.meetings m where m.id = meeting_id) );
drop policy if exists "meeting_attendance_read_auth" on public.meeting_attendance;
create policy "meeting_attendance_read_auth" on public.meeting_attendance for select to authenticated
using ( public.current_user_can_manage(org_id, 'meetings') );

-- =============================================================================
-- DOCUMENTS
-- =============================================================================

create table if not exists public.documents (
  id                bigint generated always as identity primary key,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  title             text not null,
  description       text,
  category          text not null default 'General',
  file_url          text not null,
  members_only      boolean not null default false,
  meeting_id        bigint references public.meetings(id) on delete set null,
  uploaded_by_name  text,
  status            text not null default 'approved',   -- 'approved' | 'pending'
  created_at        timestamptz not null default now()
);

alter table public.documents enable row level security;

drop policy if exists "documents_read_public" on public.documents;
create policy "documents_read_public" on public.documents for select to anon, authenticated
using ( status = 'approved' and members_only = false );
drop policy if exists "documents_read_members" on public.documents;
create policy "documents_read_members" on public.documents for select to authenticated
using ( status = 'approved' and public.current_user_is_org_member(org_id) );
drop policy if exists "documents_admin_all" on public.documents;
create policy "documents_admin_all" on public.documents for all to authenticated
using ( public.current_user_can_manage(org_id, 'documents') ) with check ( public.current_user_can_manage(org_id, 'documents') );
drop policy if exists "documents_insert_member_report" on public.documents;
create policy "documents_insert_member_report" on public.documents for insert to authenticated
with check ( public.current_user_is_org_member(org_id) and status = 'pending' );

-- =============================================================================
-- NEWS: org_news_posts (admin-authored feed) + member_news_submissions
-- (moderation queue) + news_articles lives in site_content (published feed)
-- =============================================================================

create table if not exists public.org_news_posts (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  title       text not null,
  body        text not null,
  category    text not null default 'General',
  pinned      boolean not null default false,
  created_by  text,
  created_at  timestamptz not null default now()
);

create table if not exists public.member_news_submissions (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  member_id     bigint references public.members(id),
  member_name   text,
  member_email  text,
  title         text not null,
  tag           text not null default 'Community',
  excerpt       text not null,
  body          text not null,
  image_url     text,
  placement     text not null default 'main',
  status        text not null default 'pending',   -- 'pending' | 'approved' | 'rejected'
  admin_note    text,
  reviewed_at   timestamptz,
  submitted_at  timestamptz not null default now()
);

alter table public.org_news_posts enable row level security;
alter table public.member_news_submissions enable row level security;

drop policy if exists "org_news_posts_read_members" on public.org_news_posts;
create policy "org_news_posts_read_members" on public.org_news_posts for select to authenticated
using ( public.current_user_is_org_member(org_id) or public.current_user_is_org_admin(org_id) );
drop policy if exists "org_news_posts_write_auth" on public.org_news_posts;
create policy "org_news_posts_write_auth" on public.org_news_posts for all to authenticated
using ( public.current_user_can_manage(org_id, 'chapter-news') ) with check ( public.current_user_can_manage(org_id, 'chapter-news') );

drop policy if exists "member_news_submissions_insert_member" on public.member_news_submissions;
create policy "member_news_submissions_insert_member" on public.member_news_submissions for insert to authenticated
with check (
  public.current_user_is_org_member(org_id)
  and member_id in (select id from public.members where auth_user_id = auth.uid())
);
drop policy if exists "member_news_submissions_select_own_or_admin" on public.member_news_submissions;
create policy "member_news_submissions_select_own_or_admin" on public.member_news_submissions for select to authenticated
using ( member_id in (select id from public.members where auth_user_id = auth.uid()) or public.current_user_can_manage(org_id, 'news-submissions') );
drop policy if exists "member_news_submissions_admin_update" on public.member_news_submissions;
create policy "member_news_submissions_admin_update" on public.member_news_submissions for update to authenticated
using ( public.current_user_can_manage(org_id, 'news-submissions') ) with check ( public.current_user_can_manage(org_id, 'news-submissions') );

-- =============================================================================
-- MEMBER ANNOUNCEMENTS (member-submitted, admin-moderated)
-- =============================================================================

create table if not exists public.member_announcements (
  id              bigint generated always as identity primary key,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  member_id       bigint references public.members(id),
  member_name     text,
  member_email    text,
  title           text not null,
  category        text not null default 'General',
  body            text not null,
  flyer_url       text,
  event_date      text not null default 'TBD',
  event_time      text not null default 'TBD',
  event_location  text not null default 'TBD',
  status          text not null default 'pending',   -- 'pending' | 'approved' | 'rejected'
  created_at      timestamptz not null default now()
);

alter table public.member_announcements enable row level security;

drop policy if exists "member_announcements_insert_member" on public.member_announcements;
create policy "member_announcements_insert_member" on public.member_announcements for insert to authenticated
with check (
  public.current_user_is_org_member(org_id)
  and member_id in (select id from public.members where auth_user_id = auth.uid())
);
drop policy if exists "member_announcements_select" on public.member_announcements;
create policy "member_announcements_select" on public.member_announcements for select to authenticated
using ( member_id in (select id from public.members where auth_user_id = auth.uid()) or public.current_user_can_manage(org_id, 'member-announcements') );
drop policy if exists "member_announcements_admin_update" on public.member_announcements;
create policy "member_announcements_admin_update" on public.member_announcements for update to authenticated
using ( public.current_user_can_manage(org_id, 'member-announcements') ) with check ( public.current_user_can_manage(org_id, 'member-announcements') );

-- =============================================================================
-- STORE (items + orders)
-- =============================================================================

create table if not exists public.store_items (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null,
  price        numeric(10,2) not null,
  category     text not null default 'General',
  description  text,
  image_url    text,
  active       boolean not null default true,
  options      jsonb not null default '[]'::jsonb,   -- [{name, values:[...]}]
  sort_order   integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.store_orders (
  id                          bigint generated always as identity primary key,
  org_id                      uuid not null references public.organizations(id) on delete cascade,
  member_id                   bigint references public.members(id),
  member_name                 text,
  member_email                text,
  items                       jsonb not null default '[]'::jsonb,
  total                       numeric(10,2) not null default 0,
  status                      text not null default 'pending',  -- pending|awaiting_payment|paid|fulfilled|cancelled
  notes                       text,
  stripe_checkout_session_id  text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

alter table public.store_items enable row level security;
alter table public.store_orders enable row level security;

drop policy if exists "store_items_read_all" on public.store_items;
create policy "store_items_read_all" on public.store_items for select to anon, authenticated using ( active = true );
drop policy if exists "store_items_admin_all" on public.store_items;
create policy "store_items_admin_all" on public.store_items for all to authenticated
using ( public.current_user_can_manage(org_id, 'store') ) with check ( public.current_user_can_manage(org_id, 'store') );

drop policy if exists "store_orders_insert_member" on public.store_orders;
create policy "store_orders_insert_member" on public.store_orders for insert to authenticated
with check (
  public.current_user_is_org_member(org_id)
  and member_id in (select id from public.members where auth_user_id = auth.uid())
);
drop policy if exists "store_orders_select_own_or_admin" on public.store_orders;
create policy "store_orders_select_own_or_admin" on public.store_orders for select to authenticated
using ( member_id in (select id from public.members where auth_user_id = auth.uid()) or public.current_user_can_manage(org_id, 'store') );
drop policy if exists "store_orders_admin_update" on public.store_orders;
create policy "store_orders_admin_update" on public.store_orders for update to authenticated
using ( public.current_user_can_manage(org_id, 'store') ) with check ( public.current_user_can_manage(org_id, 'store') );

-- =============================================================================
-- FINANCE: requisitions, reimbursements, and ONE unified dues_payments table.
--
-- The original app had two competing dues systems (a working Stripe-backed
-- `dues_payments` used by the main site, and a `finance_payments` table used
-- by a separate finance sub-portal whose own Stripe path was unreachable —
-- and whose two write paths even disagreed on column names for the same
-- fields). Both are replaced here by one dues_payments table used by every
-- surface (public/member dues checkout AND the finance admin's manual entry
-- form), so there is exactly one source of truth for who has paid.
-- =============================================================================

create table if not exists public.finance_requisitions (
  id                bigint generated always as identity primary key,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  member_id         bigint references public.members(id),
  member_name       text,
  member_email      text,
  committee         text not null,
  description       text not null,
  amount_cents      integer not null,
  payee_name        text not null,
  method            text not null,   -- 'org_card' | 'check' | 'personal_reimbursement'
  doc_url           text,
  status            text not null default 'pending',  -- 'pending' | 'approved' | 'denied'
  admin_note        text,
  reviewed_at       timestamptz,
  submitted_at      timestamptz not null default now(),
  reimbursement_id  bigint
);

create table if not exists public.finance_reimbursements (
  id                bigint generated always as identity primary key,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  member_id         bigint references public.members(id),
  member_name       text,
  member_email      text,
  item_service      text not null,
  amount_cents      integer not null,
  payee_name        text,
  method            text not null,       -- 'zelle' | 'check'
  payment_details   jsonb,
  doc_url           text,
  status            text not null default 'pending',  -- 'pending' | 'approved' | 'denied'
  admin_note        text,
  reviewed_at       timestamptz,
  submitted_at      timestamptz not null default now(),
  auto_generated    boolean not null default false,
  requisition_id    bigint references public.finance_requisitions(id)
);

-- Postgres has no `add constraint if not exists`, so guard this explicitly —
-- unlike every other statement in this file, a bare `alter table ... add
-- constraint` errors (42710) on a second run once the constraint already
-- exists, aborting the rest of the script.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'finance_requisitions_reimbursement_id_fkey'
  ) then
    alter table public.finance_requisitions
      add constraint finance_requisitions_reimbursement_id_fkey
      foreign key (reimbursement_id) references public.finance_reimbursements(id)
      deferrable initially deferred;
  end if;
end $$;

create table if not exists public.dues_payments (
  id                          bigint generated always as identity primary key,
  org_id                      uuid not null references public.organizations(id) on delete cascade,
  member_id                   bigint references public.members(id),
  full_name                   text not null default '',
  email                       text not null default '',
  phone                       text not null default '',
  dues_category               text,
  dues_category_label         text,
  fiscal_year                 text,
  amount_cents                integer not null default 0,
  late_fee                    boolean not null default false,
  building_fund                boolean not null default false,
  reference_number            text,
  payment_method               text,        -- 'check' | 'zelle' | 'cash' | 'waived' | 'stripe'
  payment_status               text not null default 'pending',  -- 'paid' | 'pending' | 'failed'
  notes                        text,
  stripe_checkout_session_id  text,
  paid_at                      timestamptz,
  logged_by                    uuid,
  created_at                   timestamptz not null default now()
);
create unique index if not exists dues_payments_stripe_session_uidx
  on public.dues_payments (stripe_checkout_session_id) where stripe_checkout_session_id is not null;

alter table public.finance_requisitions enable row level security;
alter table public.finance_reimbursements enable row level security;
alter table public.dues_payments enable row level security;

drop policy if exists "finance_requisitions_insert_member" on public.finance_requisitions;
create policy "finance_requisitions_insert_member" on public.finance_requisitions for insert to authenticated
with check (
  public.current_user_is_org_member(org_id)
  and member_id in (select id from public.members where auth_user_id = auth.uid())
);
drop policy if exists "finance_requisitions_select" on public.finance_requisitions;
create policy "finance_requisitions_select" on public.finance_requisitions for select to authenticated
using ( member_id in (select id from public.members where auth_user_id = auth.uid())
     or public.current_user_can_manage(org_id, 'requisitions')
     or public.current_user_finance_role(org_id) is not null );
drop policy if exists "finance_requisitions_admin_update" on public.finance_requisitions;
create policy "finance_requisitions_admin_update" on public.finance_requisitions for update to authenticated
using ( public.current_user_can_manage(org_id, 'requisitions') or public.current_user_finance_role(org_id) is not null )
with check ( public.current_user_can_manage(org_id, 'requisitions') or public.current_user_finance_role(org_id) is not null );

drop policy if exists "finance_reimbursements_insert" on public.finance_reimbursements;
create policy "finance_reimbursements_insert" on public.finance_reimbursements for insert to authenticated
with check (
  -- A plain member may only file a reimbursement for themselves. A finance-role
  -- staffer may file one for any member of the org — needed for the "approve
  -- requisition -> auto-create a personal reimbursement" flow in the admin
  -- console, which inserts on behalf of the original requisition's submitter.
  (public.current_user_is_org_member(org_id) and member_id in (select id from public.members where auth_user_id = auth.uid()))
  or public.current_user_finance_role(org_id) is not null
);
drop policy if exists "finance_reimbursements_select" on public.finance_reimbursements;
create policy "finance_reimbursements_select" on public.finance_reimbursements for select to authenticated
using ( member_id in (select id from public.members where auth_user_id = auth.uid())
     or public.current_user_can_manage(org_id, 'reimbursements')
     or public.current_user_finance_role(org_id) is not null );
drop policy if exists "finance_reimbursements_admin_update" on public.finance_reimbursements;
create policy "finance_reimbursements_admin_update" on public.finance_reimbursements for update to authenticated
using ( public.current_user_can_manage(org_id, 'reimbursements') or public.current_user_finance_role(org_id) is not null )
with check ( public.current_user_can_manage(org_id, 'reimbursements') or public.current_user_finance_role(org_id) is not null );

drop policy if exists "dues_payments_select" on public.dues_payments;
create policy "dues_payments_select" on public.dues_payments for select to authenticated
using ( member_id in (select id from public.members where auth_user_id = auth.uid())
     or public.current_user_can_manage(org_id, 'dues-admin')
     or public.current_user_finance_role(org_id) is not null );
drop policy if exists "dues_payments_admin_all" on public.dues_payments;
create policy "dues_payments_admin_all" on public.dues_payments for all to authenticated
using ( public.current_user_can_manage(org_id, 'dues-admin') or public.current_user_finance_role(org_id) is not null )
with check ( public.current_user_can_manage(org_id, 'dues-admin') or public.current_user_finance_role(org_id) is not null );

-- =============================================================================
-- STORAGE: org-media (gallery/news/leadership/documents) + event flyers.
-- Files are stored under an `${org_id}/...` path prefix; policies check that
-- prefix against the uploader's org-admin membership.
-- =============================================================================

insert into storage.buckets (id, name, public) values ('org-media', 'org-media', true) on conflict (id) do update set public = excluded.public;
insert into storage.buckets (id, name, public) values ('event-flyer-uploads', 'event-flyer-uploads', true) on conflict (id) do update set public = excluded.public;

-- Files live under an `${org_id}/...` path prefix. Parses that prefix
-- defensively (returns null rather than raising) so a malformed/garbage
-- path just fails the permission check instead of erroring the request.
create or replace function public.storage_path_org_id(p_name text)
returns uuid language plpgsql immutable as $$
declare prefix text;
begin
  prefix := split_part(p_name, '/', 1);
  if prefix ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return prefix::uuid;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

drop policy if exists "org_media_select_anon" on storage.objects;
create policy "org_media_select_anon" on storage.objects for select to anon, authenticated using (bucket_id = 'org-media');
-- INSERT is intentionally broader than admin-only: members upload their own
-- attachments here too (reimbursement/requisition receipts, profile photos,
-- committee-report documents, submitted-announcement flyers), not just
-- admins uploading gallery/document content. Any signed-in, granted member
-- of the org (or an org admin) may add a NEW object under that org's path
-- prefix; UPDATE/DELETE stay admin-only below so a member can't overwrite
-- or remove someone else's upload once it exists.
drop policy if exists "org_media_insert_auth" on storage.objects;
create policy "org_media_insert_auth" on storage.objects for insert to authenticated
with check (
  bucket_id = 'org-media'
  and (
    public.current_user_is_org_admin(public.storage_path_org_id(name))
    or public.current_user_is_org_member(public.storage_path_org_id(name))
  )
);
drop policy if exists "org_media_update_auth" on storage.objects;
create policy "org_media_update_auth" on storage.objects for update to authenticated
using (bucket_id = 'org-media' and public.current_user_is_org_admin(public.storage_path_org_id(name)));
drop policy if exists "org_media_delete_auth" on storage.objects;
create policy "org_media_delete_auth" on storage.objects for delete to authenticated
using (bucket_id = 'org-media' and public.current_user_is_org_admin(public.storage_path_org_id(name)));

drop policy if exists "event_flyer_uploads_select_anon" on storage.objects;
create policy "event_flyer_uploads_select_anon" on storage.objects for select to anon, authenticated using (bucket_id = 'event-flyer-uploads');
drop policy if exists "event_flyer_uploads_insert_auth" on storage.objects;
create policy "event_flyer_uploads_insert_auth" on storage.objects for insert to authenticated
with check (bucket_id = 'event-flyer-uploads' and public.current_user_is_org_admin(public.storage_path_org_id(name)));
drop policy if exists "event_flyer_uploads_update_auth" on storage.objects;
create policy "event_flyer_uploads_update_auth" on storage.objects for update to authenticated
using (bucket_id = 'event-flyer-uploads' and public.current_user_is_org_admin(public.storage_path_org_id(name)));
drop policy if exists "event_flyer_uploads_delete_auth" on storage.objects;
create policy "event_flyer_uploads_delete_auth" on storage.objects for delete to authenticated
using (bucket_id = 'event-flyer-uploads' and public.current_user_is_org_admin(public.storage_path_org_id(name)));

-- =============================================================================
-- ORG SIGNUP — creates an organization + its first (full) admin atomically.
-- Called from signup.html by a brand-new Supabase Auth user (anon key + the
-- new user's own bearer token). SECURITY DEFINER so it can write both
-- organizations and org_admins in one transaction despite RLS.
-- =============================================================================

create or replace function public.create_organization(
  p_slug text, p_name text, p_contact_email text
)
returns public.organizations
language plpgsql security definer set search_path = public as $$
declare
  new_org public.organizations;
  uid uuid := auth.uid();
  jwt_email text := auth.jwt() ->> 'email';
begin
  if uid is null then raise exception 'You must be signed in to create an organization'; end if;
  if length(trim(coalesce(p_slug, ''))) < 3 then raise exception 'Choose a URL slug of at least 3 characters'; end if;
  if not p_slug ~ '^[a-z0-9-]+$' then raise exception 'Slug can only contain lowercase letters, numbers, and hyphens'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Organization name is required'; end if;

  insert into public.organizations (slug, name, contact_email, owner_user_id)
  values (lower(trim(p_slug)), trim(p_name), nullif(trim(coalesce(p_contact_email, jwt_email)), ''), uid)
  returning * into new_org;

  insert into public.org_admins (org_id, email, is_full_admin, granted_by)
  values (new_org.id, lower(trim(jwt_email)), true, 'signup');

  return new_org;
end;
$$;
revoke all on function public.create_organization(text, text, text) from public;
grant execute on function public.create_organization(text, text, text) to authenticated;

-- =============================================================================
-- BILLING STATUS (read path for the admin Billing panel)
--
-- organizations is publicly readable (organizations_read_all, for public
-- branding) — stripe_customer_id/subscription_status are deliberately NOT
-- in that public select list in js/org-context.js, so the admin dashboard
-- fetches them through this full-admin-gated RPC instead. It returns
-- whether a Stripe customer exists, never the raw ID itself, since the
-- dashboard only needs that to decide whether to show "Manage billing".
-- =============================================================================
create or replace function public.get_org_billing_status(p_org_id uuid)
returns table (plan text, subscription_status text, has_billing_customer boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.current_user_is_full_admin(p_org_id) then
    raise exception 'Only a full admin can view billing status';
  end if;
  return query
    select o.plan, o.subscription_status, (o.stripe_customer_id is not null)
    from public.organizations o
    where o.id = p_org_id;
end;
$$;
revoke all on function public.get_org_billing_status(uuid) from public;
grant execute on function public.get_org_billing_status(uuid) to authenticated;

-- =============================================================================
-- PLATFORM ADMIN (superadmin) RPCs
--
-- Every function here starts by checking current_user_is_platform_admin()
-- and raises if not — fail closed, same convention as every other admin
-- check in this file. These are the only place cross-tenant writes (plan
-- override, suspension, deletion) or a full-roster read happen outside of
-- RLS's normal per-org scoping.
-- =============================================================================

create or replace function public.platform_list_organizations()
returns table (
  id uuid, slug text, name text, plan text, subscription_status text,
  suspended boolean, suspended_reason text, member_count bigint,
  contact_email text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.current_user_is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  return query
    select o.id, o.slug, o.name, o.plan, o.subscription_status,
           o.suspended, o.suspended_reason,
           (select count(*) from public.members m where m.org_id = o.id) as member_count,
           o.contact_email, o.created_at
    from public.organizations o
    order by o.created_at desc;
end;
$$;
revoke all on function public.platform_list_organizations() from public;
grant execute on function public.platform_list_organizations() to authenticated;

create or replace function public.platform_set_org_plan(p_org_id uuid, p_plan text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  if p_plan not in ('free', 'start', 'growth', 'pro') then
    raise exception 'Unknown plan: %', p_plan;
  end if;
  update public.organizations
  set plan = p_plan, plan_updated_at = now()
  where id = p_org_id;
  if not found then
    raise exception 'Organization not found';
  end if;
end;
$$;
revoke all on function public.platform_set_org_plan(uuid, text) from public;
grant execute on function public.platform_set_org_plan(uuid, text) to authenticated;

create or replace function public.platform_set_org_suspended(p_org_id uuid, p_suspended boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  update public.organizations
  set suspended = p_suspended,
      suspended_reason = case when p_suspended then p_reason else null end,
      suspended_at = case when p_suspended then now() else null end
  where id = p_org_id;
  if not found then
    raise exception 'Organization not found';
  end if;
end;
$$;
revoke all on function public.platform_set_org_suspended(uuid, boolean, text) from public;
grant execute on function public.platform_set_org_suspended(uuid, boolean, text) to authenticated;

-- Permanently deletes an organization and every row that cascades from it
-- (members, events, payments, everything — see the "on delete cascade"
-- foreign keys throughout this file). p_confirm_slug must match the org's
-- actual slug, so a single mis-click can't destroy a tenant's data — the
-- caller has to already know/copy the real slug.
create or replace function public.platform_delete_organization(p_org_id uuid, p_confirm_slug text)
returns void language plpgsql security definer set search_path = public as $$
declare
  real_slug text;
begin
  if not public.current_user_is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  select slug into real_slug from public.organizations where id = p_org_id;
  if real_slug is null then
    raise exception 'Organization not found';
  end if;
  if lower(trim(coalesce(p_confirm_slug, ''))) <> real_slug then
    raise exception 'Confirmation slug does not match — nothing was deleted';
  end if;
  delete from public.organizations where id = p_org_id;
end;
$$;
revoke all on function public.platform_delete_organization(uuid, text) from public;
grant execute on function public.platform_delete_organization(uuid, text) to authenticated;

-- Lets the platform-admin console look up which org(s) a signed-in email
-- administers (org_admins is otherwise only readable by full admins of
-- that SAME org — see org_admins_select_self/_for_full_admins — so a
-- platform admin needs its own bypass to find who to impersonate).
create or replace function public.platform_list_org_admins(p_org_id uuid)
returns table (email text, is_full_admin boolean, granted_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.current_user_is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  return query
    select a.email, a.is_full_admin, a.granted_at
    from public.org_admins a
    where a.org_id = p_org_id
    order by a.granted_at asc;
end;
$$;
revoke all on function public.platform_list_org_admins(uuid) from public;
grant execute on function public.platform_list_org_admins(uuid) to authenticated;
