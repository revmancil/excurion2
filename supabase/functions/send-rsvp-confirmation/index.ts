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

interface Payload {
  member_name: string;
  member_email: string;
  meeting_title: string;
  meeting_date?: string;
  meeting_time?: string;
  meeting_location?: string;
  response: "yes" | "maybe" | "no";
  org_id?: string;
  notify_email?: string;
}

function buildMemberEmail(
  p: Payload,
  orgName: string,
  portalUrl: string,
): { subject: string; html: string } {
  const gold = "#c9a84c";
  const responseLabels: Record<string, { label: string; icon: string; color: string }> = {
    yes:   { label: "Attending",     icon: "✅", color: "#27ae60" },
    maybe: { label: "Maybe",         icon: "🤔", color: "#f39c12" },
    no:    { label: "Not Attending", icon: "❌", color: "#e74c3c" },
  };
  const res = responseLabels[p.response] ?? responseLabels.yes;
  const firstName = p.member_name.split(" ")[0] || "there";

  const detailRows = [
    p.meeting_date     ? `<tr><td style="padding:6px 0;color:#aaa;font-size:13px;">Date</td><td style="padding:6px 0;color:#fff;font-size:13px;">${esc(p.meeting_date)}</td></tr>` : "",
    p.meeting_time     ? `<tr><td style="padding:6px 0;color:#aaa;font-size:13px;">Time</td><td style="padding:6px 0;color:#fff;font-size:13px;">${esc(p.meeting_time)}</td></tr>` : "",
    p.meeting_location ? `<tr><td style="padding:6px 0;color:#aaa;font-size:13px;">Location</td><td style="padding:6px 0;color:#fff;font-size:13px;">${esc(p.meeting_location)}</td></tr>` : "",
  ].join("");

  const subject = `RSVP Confirmed — ${esc(p.meeting_title)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td style="background:#111;border:1px solid #2a2a2a;border-radius:10px 10px 0 0;padding:24px 28px;border-bottom:none;text-align:center;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:${gold};margin-bottom:6px;">${esc(orgName)}</div>
          <div style="font-size:18px;font-weight:800;color:#fff;">Meeting RSVP Confirmed</div>
        </td></tr>
        <tr><td style="background:#161616;border:1px solid #2a2a2a;border-top:none;border-radius:0 0 10px 10px;padding:24px 28px;">
          <p style="margin:0 0 16px;font-size:14px;color:#d4d4d4;line-height:1.7;">
            ${esc(firstName)}, your RSVP for <strong style="color:#fff;">${esc(p.meeting_title)}</strong> has been recorded.
          </p>
          <div style="background:#1e1e1e;border:1px solid #2a2a2a;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              ${detailRows}
              <tr><td style="padding:6px 0;color:#aaa;font-size:13px;">Your Response</td>
                <td style="padding:6px 0;font-size:13px;">
                  <span style="color:${res.color};font-weight:700;">${res.icon} ${res.label}</span>
                </td>
              </tr>
            </table>
          </div>
          <p style="margin:0 0 20px;font-size:13px;color:#888;line-height:1.6;">
            If your plans change, you can update your RSVP anytime from the member portal.
          </p>
          <div style="text-align:center;">
            <a href="${esc(portalUrl)}" style="display:inline-block;background:${gold};color:#000;font-weight:800;font-size:14px;padding:12px 28px;border-radius:7px;text-decoration:none;">Go to Member Portal →</a>
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

  return { subject, html };
}

function buildAdminEmail(
  p: Payload,
  orgName: string,
  dashboardUrl: string,
): { subject: string; html: string } {
  const gold = "#c9a84c";
  const responseLabels: Record<string, { label: string; color: string }> = {
    yes:   { label: "Attending",     color: "#27ae60" },
    maybe: { label: "Maybe",         color: "#f39c12" },
    no:    { label: "Not Attending", color: "#e74c3c" },
  };
  const res = responseLabels[p.response] ?? responseLabels.yes;

  const subject = `Meeting RSVP — ${esc(p.member_name)} — ${esc(p.meeting_title)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td style="background:#111;border:1px solid #2a2a2a;border-radius:10px 10px 0 0;padding:24px 28px;border-bottom:none;text-align:center;">
          <div style="font-size:28px;margin-bottom:8px;">📋</div>
          <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:${gold};margin-bottom:6px;">${esc(orgName)} — Admin Alert</div>
          <div style="font-size:18px;font-weight:800;color:#fff;">New Meeting RSVP</div>
        </td></tr>
        <tr><td style="background:#161616;border:1px solid #2a2a2a;border-top:none;border-radius:0 0 10px 10px;padding:24px 28px;">
          <p style="margin:0 0 20px;font-size:14px;color:#d4d4d4;line-height:1.7;">
            <strong style="color:#fff;">${esc(p.member_name)}</strong> has submitted an RSVP for <strong style="color:#fff;">${esc(p.meeting_title)}</strong>.<br><br>
            <strong style="color:${gold};">Response:</strong> <span style="color:${res.color};font-weight:700;">${res.label}</span>
            ${p.member_email ? `<br><strong style="color:${gold};">Email:</strong> ${esc(p.member_email)}` : ""}
          </p>
          <div style="text-align:center;margin-top:24px;">
            <a href="${esc(dashboardUrl)}" style="display:inline-block;background:${gold};color:#000;font-weight:800;font-size:14px;padding:12px 28px;border-radius:7px;text-decoration:none;">View in Dashboard →</a>
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

  return { subject, html };
}

async function sendEmail(resendKey: string, from: string, to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    console.error("Resend error:", err);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const resendKey  = Deno.env.get("RESEND_API_KEY");
  const fromEmail  = Deno.env.get("RESEND_FROM_EMAIL") ?? "notifications@memberforge.app";
  const fromName   = Deno.env.get("RESEND_FROM_NAME")  ?? "MemberForge";
  const rootDomain = Deno.env.get("MEMBERFORGE_ROOT_DOMAIN") ?? "memberforge.app";

  if (!resendKey) return json({ error: "Email not configured." }, 503);

  let payload: Payload;
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (!payload.member_email || !payload.member_name || !payload.meeting_title || !payload.response) {
    return json({ error: "Missing required fields." }, 400);
  }

  // org_id is expected directly in the payload — the meeting RSVP flow
  // already knows which org it's operating in when it calls this function.
  const orgId = String(payload.org_id ?? "").trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  let orgName = "Your Organization";
  let portalUrl = `https://app.${rootDomain}/member-portal.html`;
  let dashboardUrl = `https://app.${rootDomain}/admin-dashboard.html`;
  let adminEmail = String(payload.notify_email ?? "").trim();

  if (orgId && supabaseUrl && serviceKey) {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: org } = await admin
      .from("organizations")
      .select("name, slug, custom_domain, contact_email")
      .eq("id", orgId)
      .maybeSingle();
    if (org) {
      if (org.name) orgName = String(org.name);
      const base = org.custom_domain ? `https://${org.custom_domain}` : `https://${org.slug}.${rootDomain}`;
      portalUrl = `${base.replace(/\/$/, "")}/member-portal.html`;
      dashboardUrl = `${base.replace(/\/$/, "")}/admin-dashboard.html`;
      if (!adminEmail && org.contact_email) adminEmail = String(org.contact_email).trim();
    }
  }

  if (!adminEmail) adminEmail = Deno.env.get("ADMIN_NOTIFY_EMAIL") ?? "";

  const from = `${fromName} <${fromEmail}>`;

  // Send both emails concurrently — don't fail if one bounces
  const { subject: memberSubject, html: memberHtml } = buildMemberEmail(payload, orgName, portalUrl);
  const sends: Promise<void>[] = [
    sendEmail(resendKey, from, payload.member_email, memberSubject, memberHtml),
  ];
  if (adminEmail) {
    const { subject: adminSubject, html: adminHtml } = buildAdminEmail(payload, orgName, dashboardUrl);
    sends.push(sendEmail(resendKey, from, adminEmail, adminSubject, adminHtml));
  }

  await Promise.allSettled(sends);

  return json({ sent: true });
});
