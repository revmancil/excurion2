import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const resendKey   = Deno.env.get("RESEND_API_KEY");
  const fromEmail   = Deno.env.get("RESEND_FROM_EMAIL") ?? "notifications@memberforge.app";
  const fromNameEnv = Deno.env.get("RESEND_FROM_NAME");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")      ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!resendKey)   return json({ error: "RESEND_API_KEY not configured." }, 503);
  if (!serviceKey)  return json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured." }, 503);

  let payload: { subject: string; html: string; org_id?: string };
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!payload.subject || !payload.html) return json({ error: "subject and html are required." }, 400);

  const orgId = String(payload.org_id ?? "").trim();
  if (!orgId) return json({ error: "org_id is required." }, 400);

  // Verify caller is an authenticated org admin
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Authentication required." }, 401);
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user?.email) {
    return json({ error: "Invalid or expired session." }, 401);
  }
  const requesterEmail = String(userData.user.email).trim().toLowerCase();

  // BUG FIX (ported from send-newsletter): the original queried
  // chapter_admins?user_id=eq.<uuid> — but chapter_admins (now org_admins)
  // has never had a user_id column, only email. That check silently failed
  // (or behaved unpredictably) every time. The correct check is by email,
  // scoped to this org.
  const adminCheck = await fetch(
    `${supabaseUrl}/rest/v1/org_admins?org_id=eq.${encodeURIComponent(orgId)}&email=eq.${encodeURIComponent(requesterEmail)}&select=email&limit=1`,
    { headers: { "apikey": serviceKey, "Authorization": "Bearer " + serviceKey } }
  );
  const adminRows = adminCheck.ok ? await adminCheck.json() : [];
  if (!Array.isArray(adminRows) || adminRows.length === 0) {
    return json({ error: "Admin access required." }, 403);
  }

  // Look up the org's real name for the "from" display name (falls back to
  // RESEND_FROM_NAME, then a generic label, if the org lookup fails).
  let fromName = fromNameEnv ?? "MemberForge";
  const admin = createClient(supabaseUrl, serviceKey);
  if (!fromNameEnv) {
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    if (org?.name) fromName = String(org.name);
  }

  // Fetch all active, portal-granted members with emails, scoped to this org
  const membersRes = await fetch(
    `${supabaseUrl}/rest/v1/members?org_id=eq.${encodeURIComponent(orgId)}&status=eq.active&portal_access=eq.granted&select=email,first_name&email=not.is.null`,
    { headers: { "apikey": serviceKey, "Authorization": "Bearer " + serviceKey } }
  );
  if (!membersRes.ok) return json({ error: "Failed to fetch members." }, 502);
  const members: Array<{ email: string; first_name?: string }> = await membersRes.json();

  const emails = members.filter((m) => m.email && m.email.includes("@"));
  if (!emails.length) return json({ error: "No active members with email addresses found." }, 404);

  const from = `${fromName} <${fromEmail}>`;
  let sent = 0;

  // Send in batches of 50 (Resend batch limit)
  for (let i = 0; i < emails.length; i += 50) {
    const batch = emails.slice(i, i + 50);
    await Promise.allSettled(batch.map((m) =>
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [m.email],
          subject: payload.subject,
          html: payload.html,
        }),
      }).then((r) => { if (r.ok) sent++; else r.text().then((t) => console.error("Resend error:", t)); })
    ));
  }

  return json({ sent, total: emails.length });
});
