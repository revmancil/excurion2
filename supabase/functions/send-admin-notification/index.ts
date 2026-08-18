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

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type NotificationType = "announcement" | "member_request" | "visitor_request";

interface Payload {
  type: NotificationType;
  name?: string;
  email?: string;
  title?: string;
  category?: string;
  message?: string;
  chapter?: string;
  org_id?: string;
  notify_email?: string; // explicit fallback if the org row has no contact_email
}

function buildEmail(payload: Payload, orgName: string, dashboardUrl: string): { subject: string; html: string } {
  const gold = "#c9a84c";

  const configs: Record<NotificationType, { subject: string; icon: string; heading: string; body: string; action: string }> = {
    announcement: {
      subject: `New Announcement Submitted — ${esc(payload.title ?? "Untitled")}`,
      icon: "📣",
      heading: "New Announcement Submitted",
      body: `<strong style="color:#fff;">${esc(payload.name ?? "A member")}</strong> submitted an announcement for review.
             <br><br>
             <strong style="color:${gold};">Title:</strong> ${esc(payload.title ?? "")}<br>
             <strong style="color:${gold};">Category:</strong> ${esc(payload.category ?? "General")}`,
      action: "Review Announcement",
    },
    member_request: {
      subject: `New Member Portal Request — ${esc(payload.name ?? payload.email ?? "Unknown")}`,
      icon: "🙋",
      heading: "New Member Portal Request",
      body: `<strong style="color:#fff;">${esc(payload.name ?? "Someone")}</strong> has requested access to the member portal.
             <br><br>
             <strong style="color:${gold};">Email:</strong> ${esc(payload.email ?? "—")}`,
      action: "Review Request",
    },
    visitor_request: {
      subject: `New Visitor Request — ${esc(payload.name ?? payload.email ?? "Unknown")}`,
      icon: "🤝",
      heading: "New Visitor Request",
      body: `<strong style="color:#fff;">${esc(payload.name ?? "A visitor")}</strong> has submitted a request for guest access.
             <br><br>
             <strong style="color:${gold};">Email:</strong> ${esc(payload.email ?? "—")}
             ${payload.chapter ? `<br><strong style="color:${gold};">Organization/Chapter:</strong> ${esc(payload.chapter)}` : ""}`,
      action: "Review Request",
    },
  };

  const cfg = configs[payload.type] ?? configs.announcement;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td style="background:#111;border:1px solid #2a2a2a;border-radius:10px 10px 0 0;padding:24px 28px;border-bottom:none;text-align:center;">
          <div style="font-size:28px;margin-bottom:8px;">${cfg.icon}</div>
          <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:${gold};margin-bottom:6px;">${esc(orgName)} — Admin Alert</div>
          <div style="font-size:18px;font-weight:800;color:#fff;">${cfg.heading}</div>
        </td></tr>
        <tr><td style="background:#161616;border:1px solid #2a2a2a;border-top:none;border-radius:0 0 10px 10px;padding:24px 28px;">
          <p style="margin:0 0 20px;font-size:14px;color:#d4d4d4;line-height:1.7;">${cfg.body}</p>
          <div style="text-align:center;margin-top:24px;">
            <a href="${esc(dashboardUrl)}" style="display:inline-block;background:${gold};color:#000;font-weight:800;font-size:14px;padding:12px 28px;border-radius:7px;text-decoration:none;">${cfg.action} →</a>
          </div>
          <p style="margin:24px 0 0;font-size:11px;color:#555;text-align:center;">
            ${esc(orgName)}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject: cfg.subject, html };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "notifications@memberforge.app";
  const fromName  = Deno.env.get("RESEND_FROM_NAME")  ?? "MemberForge";
  const rootDomain = Deno.env.get("MEMBERFORGE_ROOT_DOMAIN") ?? "memberforge.app";

  if (!resendKey) return json({ error: "Email not configured." }, 503);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  let payload: Payload;
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!payload.type) return json({ error: "type is required" }, 400);

  let orgName = "Your Organization";
  let dashboardUrl = `https://app.${rootDomain}/admin-dashboard.html`;
  let adminEmail = String(payload.notify_email ?? "").trim();

  const orgId = String(payload.org_id ?? "").trim();
  if (orgId && supabaseUrl && serviceKey) {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("name, slug, custom_domain, contact_email")
      .eq("id", orgId)
      .maybeSingle();
    if (!orgErr && org) {
      if (org.name) orgName = String(org.name);
      const base = org.custom_domain ? `https://${org.custom_domain}` : `https://${org.slug}.${rootDomain}`;
      dashboardUrl = `${base.replace(/\/$/, "")}/admin-dashboard.html`;
      if (!adminEmail && org.contact_email) adminEmail = String(org.contact_email).trim();
    }
  }

  if (!adminEmail) adminEmail = Deno.env.get("ADMIN_NOTIFY_EMAIL") ?? "";
  if (!adminEmail) return json({ error: "No admin notification email is configured for this organization." }, 400);

  const { subject, html } = buildEmail(payload, orgName, dashboardUrl);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [adminEmail],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    console.error("Resend error:", err);
    return json({ error: "Email delivery failed." }, 502);
  }

  return json({ sent: true });
});
