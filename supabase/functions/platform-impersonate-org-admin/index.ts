/**
 * Platform-admin-only: generates a real Supabase magic link for one of an
 * organization's admins, so the platform superadmin can open it and land
 * signed in AS that admin — for support, without ever knowing or resetting
 * their password.
 *
 * This is a genuinely powerful capability (equivalent to "log in as any
 * user"), so it's gated twice: once here (the caller's own session must
 * pass current_user_is_platform_admin(), checked via a call made AS the
 * caller — not the service role — so auth.jwt() reflects who's actually
 * asking), and structurally, since only the hardcoded platform-admin email
 * in schema.sql can ever pass that check.
 *
 * Keep this file self-contained (no ../ imports) so Supabase deploy bundles reliably.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function trimStr(v: unknown, max: number): string {
  const s = String(v ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: "Supabase is not configured on the server." }, 503);
  }

  const rootDomain = Deno.env.get("MEMBERFORGE_ROOT_DOMAIN") ?? "memberforge.app";

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const orgId = trimStr(payload.org_id, 64);
  const requestedEmail = trimStr(payload.admin_email, 320).toLowerCase();
  if (!orgId) return json({ error: "org_id is required." }, 400);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Sign in as the platform admin first." }, 401);
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "Invalid or expired session. Please sign in again." }, 401);
  }

  // Checked AS the caller (via userClient, not the service role), so
  // auth.jwt()/auth.role() inside the function reflect the actual signed-in
  // user — this is the real gate, not just a UI-side assumption.
  const { data: isPlatformAdmin, error: gateErr } = await userClient.rpc(
    "current_user_is_platform_admin",
  );
  if (gateErr || isPlatformAdmin !== true) {
    return json({ error: "Platform admin access required." }, 403);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("slug, custom_domain")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr || !org) return json({ error: "Organization not found." }, 404);

  let targetEmail = requestedEmail;
  if (!targetEmail) {
    const { data: adminRow } = await admin
      .from("org_admins")
      .select("email")
      .eq("org_id", orgId)
      .eq("is_full_admin", true)
      .order("granted_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!adminRow?.email) {
      return json({ error: "This organization has no full admin to impersonate." }, 404);
    }
    targetEmail = String(adminRow.email).toLowerCase();
  } else {
    // Reject impersonating an email that isn't actually an admin of this org.
    const { data: match } = await admin
      .from("org_admins")
      .select("email")
      .eq("org_id", orgId)
      .eq("email", targetEmail)
      .maybeSingle();
    if (!match) {
      return json({ error: "That email is not an admin of this organization." }, 404);
    }
  }

  const orgSiteBase = org.custom_domain
    ? `https://${org.custom_domain}`
    : `https://${org.slug}.${rootDomain}`;
  const siteBase = (Deno.env.get("PUBLIC_SITE_URL") ?? orgSiteBase).replace(/\/$/, "");
  const redirectTo = `${siteBase}/admin-dashboard.html?org=${encodeURIComponent(org.slug)}`;

  const linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "magiclink",
      email: targetEmail,
      options: { redirect_to: redirectTo },
    }),
  });

  if (!linkRes.ok) {
    const errText = await linkRes.text().catch(() => "");
    console.error("generate_link failed:", linkRes.status, errText);
    return json({ error: "Could not generate a sign-in link for that admin." }, 500);
  }

  const linkData = await linkRes.json();
  const actionLink = linkData.action_link || linkData.properties?.action_link;
  if (!actionLink) {
    console.error("generate_link response missing action_link:", linkData);
    return json({ error: "Sign-in link was not returned by Supabase Auth." }, 500);
  }

  return json({ url: actionLink, admin_email: targetEmail });
});
