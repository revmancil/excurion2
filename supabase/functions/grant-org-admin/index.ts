/**
 * Grant org admin: creates Auth user (or links existing) + org_admins row,
 * scoped to a single organization (org_id).
 *
 * Ported from grant-chapter-admin (single-tenant chapter_admins table).
 * The original had a "bootstrap" path (first-ever admin needs no existing
 * admin to approve them). That path is now handled entirely by the
 * create_organization SQL RPC (schema.sql), which inserts the org's first
 * org_admins row atomically when the org itself is created. This function
 * therefore ALWAYS requires an existing full admin for the target org_id.
 *
 * Keep this file self-contained (no ../ imports) so Supabase deploy bundles reliably.
 * CORS: https://supabase.com/docs/guides/functions/cors
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept, accept-profile, content-profile, prefer, x-upsert, traceparent, baggage, x-supabase-api-version",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function trimLowerEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function trimStr(v: unknown, max: number): string {
  const s = String(v ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

// Keep in sync with the admin dashboard's section list in schema.sql
// (site_content_section_key) and with each admin page's own ADMIN_SECTIONS.
const ALLOWED_SECTIONS = [
  "dues-admin",
  "requisitions",
  "reimbursements",
  "members",
  "access",
  "events",
  "fundraiser",
  "registrations",
  "meetings",
  "announcements",
  "member-announcements",
  "news-submissions",
  "chapter-news",
  "news-manager",
  "documents",
  "gallery",
  "store",
  "officers",
  "presidents",
  "pages",
  "settings",
];

const ALLOWED_FINANCE_ROLES = new Set(["treasurer", "financial_secretary", "president"]);

function sanitizeSections(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const set = new Set(
    v.map((s) => String(s ?? "").trim()).filter((s) => ALLOWED_SECTIONS.includes(s)),
  );
  return Array.from(set);
}

function sanitizeFinanceRole(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return ALLOWED_FINANCE_ROLES.has(s) ? s : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ error: "Server is not configured (missing Supabase secrets)." }, 503);
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing Authorization header." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.email) {
      return json({ error: "Invalid or expired session." }, 401);
    }
    const requesterEmail = trimLowerEmail(userData.user.email);

    let body: {
      org_id?: string;
      email?: string;
      password?: string;
      isFullAdmin?: boolean;
      sections?: string[];
      finance_role?: string | null;
      updatePermissionsOnly?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const orgId = trimStr(body.org_id, 64);
    if (!orgId) {
      return json({ error: "org_id is required." }, 400);
    }

    const email = trimLowerEmail(body.email);
    const updatePermissionsOnly = body.updatePermissionsOnly === true;
    const isFullAdmin = body.isFullAdmin !== false; // default true, matches prior behavior
    const sections = isFullAdmin ? [] : sanitizeSections(body.sections);
    const financeRole = sanitizeFinanceRole(body.finance_role);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "A valid email address is required." }, 400);
    }

    const password = String(body.password ?? "");
    if (!updatePermissionsOnly && password.length < 8) {
      return json({ error: "Password must be at least 8 characters." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // The requester must already be a full admin for THIS org. There is no
    // bootstrap path here anymore — an org's first admin is created by the
    // create_organization SQL RPC when the org itself is created.
    const { data: gateRow, error: gateErr } = await admin
      .from("org_admins")
      .select("email, is_full_admin")
      .eq("org_id", orgId)
      .eq("email", requesterEmail)
      .maybeSingle();
    if (gateErr) {
      return json({ error: "Could not verify admin roster: " + gateErr.message }, 500);
    }
    if (!gateRow) {
      return json({ error: "Only organization administrators can grant access." }, 403);
    }
    if (!gateRow.is_full_admin) {
      return json({ error: "Only full admins can grant or edit admin access." }, 403);
    }

    if (updatePermissionsOnly) {
      const { data: existing, error: existingErr } = await admin
        .from("org_admins")
        .select("email")
        .eq("org_id", orgId)
        .eq("email", email)
        .maybeSingle();
      if (existingErr || !existing) {
        return json({ error: "That email is not an administrator of this organization." }, 404);
      }
      const { error: updErr } = await admin
        .from("org_admins")
        .update({ is_full_admin: isFullAdmin, sections, finance_role: financeRole })
        .eq("org_id", orgId)
        .eq("email", email);
      if (updErr) {
        return json({ error: "Could not update permissions: " + updErr.message }, 500);
      }
      return json({ ok: true, message: "Admin permissions updated." });
    }

    const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
      }),
    });

    let createdNewAuthUser = false;
    if (authRes.ok) {
      createdNewAuthUser = true;
    } else {
      let errMsg = "";
      try {
        const errJson = await authRes.json();
        errMsg = String(errJson.message || errJson.msg || errJson.error_description || "");
      } catch {
        errMsg = await authRes.text();
      }
      const lower = errMsg.toLowerCase();
      const duplicate =
        lower.includes("already") ||
        lower.includes("registered") ||
        lower.includes("exists") ||
        authRes.status === 422;
      if (!duplicate) {
        return json({ error: errMsg || "Could not create auth user." }, 400);
      }
    }

    const now = new Date().toISOString();
    const { error: insErr } = await admin.from("org_admins").upsert(
      {
        org_id: orgId,
        email,
        granted_by: requesterEmail,
        granted_at: now,
        is_full_admin: isFullAdmin,
        sections,
        finance_role: financeRole,
      },
      { onConflict: "org_id,email" },
    );
    if (insErr) {
      return json({ error: "User step ok but could not update admin roster: " + insErr.message }, 500);
    }

    return json({
      ok: true,
      createdNewAuthUser,
      message: createdNewAuthUser
        ? "Supabase login created and admin access granted. Share the password securely."
        : "That email already had an account; admin access was granted. They can use Forgot Password if needed.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: "Unexpected error: " + msg }, 500);
  }
});
