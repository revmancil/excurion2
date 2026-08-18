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
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n: unknown): string {
  return "$" + parseFloat(String(n ?? "0")).toFixed(2);
}

function buildEmail(order: Record<string, unknown>, orgName: string, contactEmail: string): string {
  const name = esc(order.member_name ?? "Member");
  const orderId = esc(String(order.id ?? "").slice(0, 8).toUpperCase());
  const date = order.created_at
    ? new Date(String(order.created_at)).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      })
    : "";

  let rawItems: Array<Record<string, unknown>> = [];
  try {
    rawItems = typeof order.items === "string"
      ? JSON.parse(order.items)
      : (order.items as Array<Record<string, unknown>>) ?? [];
  } catch { /* empty */ }

  const itemRows = rawItems.map((li) => {
    const sels = li.selections
      ? Object.entries(li.selections as Record<string, string>)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")
      : "";
    const lineTotal = (parseFloat(String(li.price ?? 0)) * parseInt(String(li.quantity ?? 1), 10));
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #2a2a2a;color:#d4d4d4;font-size:14px;">
          <div style="font-weight:600;color:#ffffff;">${esc(li.name)}</div>
          ${sels ? `<div style="font-size:12px;color:#888;margin-top:2px;">${esc(sels)}</div>` : ""}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #2a2a2a;text-align:center;color:#d4d4d4;font-size:14px;">${esc(String(li.quantity ?? 1))}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #2a2a2a;text-align:right;color:#c9a84c;font-size:14px;font-weight:600;">${fmt(lineTotal)}</td>
      </tr>`;
  }).join("");

  const total = fmt(order.total);
  const notes = order.notes ? `
    <div style="margin-top:20px;background:#1e1e1e;border:1px solid #2a2a2a;border-radius:6px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:6px;">Notes</div>
      <div style="font-size:14px;color:#d4d4d4;">${esc(String(order.notes))}</div>
    </div>` : "";

  const contactLine = contactEmail
    ? `Questions? Contact us at <a href="mailto:${esc(contactEmail)}" style="color:#c9a84c;text-decoration:none;">${esc(contactEmail)}</a><br>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order Confirmation</title></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- Header -->
        <tr><td style="background:#111;border:1px solid #2a2a2a;border-radius:10px 10px 0 0;padding:28px 32px;text-align:center;border-bottom:none;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#c9a84c;margin-bottom:8px;">${esc(orgName)}</div>
          <div style="font-size:22px;font-weight:800;color:#ffffff;">Order Confirmed</div>
          <div style="margin-top:12px;display:inline-block;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);border-radius:20px;padding:4px 14px;font-size:12px;font-weight:700;color:#c9a84c;">ORDER #${orderId}</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#161616;border:1px solid #2a2a2a;border-top:none;border-radius:0 0 10px 10px;padding:28px 32px;">

          <p style="margin:0 0 20px;font-size:15px;color:#d4d4d4;line-height:1.6;">
            ${name}, your order has been received. ${esc(orgName)} leadership will contact you with payment details and fulfillment information.
          </p>
          ${date ? `<p style="margin:0 0 20px;font-size:13px;color:#888;">Placed on ${date}</p>` : ""}

          <!-- Item table -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #2a2a2a;border-radius:8px;overflow:hidden;margin-bottom:16px;">
            <thead>
              <tr style="background:#1e1e1e;">
                <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#888;">Item</th>
                <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#888;">Qty</th>
                <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#888;">Price</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
            <tfoot>
              <tr style="background:#1e1e1e;">
                <td colspan="2" style="padding:12px;text-align:right;font-size:14px;font-weight:700;color:#ffffff;">Total</td>
                <td style="padding:12px;text-align:right;font-size:16px;font-weight:800;color:#c9a84c;">${total}</td>
              </tr>
            </tfoot>
          </table>

          ${notes}

          <!-- Payment notice -->
          <div style="margin-top:24px;background:#1a1500;border:1px solid rgba(201,168,76,0.25);border-radius:8px;padding:16px;">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#c9a84c;margin-bottom:6px;">&#9432; Payment</div>
            <p style="margin:0;font-size:13px;color:#b8a060;line-height:1.6;">
              Payment is collected separately. An officer will reach out with instructions. Please do not submit payment until you receive confirmation.
            </p>
          </div>

          <!-- Footer -->
          <p style="margin:28px 0 0;font-size:12px;color:#555;text-align:center;line-height:1.6;">
            ${contactLine}
            ${esc(orgName)}
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "notifications@memberforge.app";
  const fromName  = Deno.env.get("RESEND_FROM_NAME")  ?? "MemberForge";

  if (!resendKey) return json({ error: "Email is not configured on the server." }, 503);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase not configured." }, 503);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const orderId = String(body.order_id ?? "").trim();
  if (!orderId) return json({ error: "order_id is required" }, 400);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: order, error } = await admin
    .from("store_orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (error || !order) return json({ error: "Order not found" }, 404);

  // org_id is optionally passed by the caller, but the order row itself
  // (which now always carries org_id) is the authoritative source.
  const orgId = String(body.org_id ?? order.org_id ?? "").trim();

  let orgName = "Your Organization";
  let contactEmail = "";
  if (orgId) {
    const { data: org } = await admin
      .from("organizations")
      .select("name, contact_email")
      .eq("id", orgId)
      .maybeSingle();
    if (org?.name) orgName = String(org.name);
    if (org?.contact_email) contactEmail = String(org.contact_email);
  }

  const toEmail = String(order.member_email ?? "").trim();
  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return json({ error: "No valid email on order" }, 422);
  }

  const html = buildEmail(order as Record<string, unknown>, orgName, contactEmail);
  const ordShort = String(order.id ?? "").slice(0, 8).toUpperCase();

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + resendKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [toEmail],
      subject: `Order Confirmed — #${ordShort} | ${orgName}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text().catch(() => "unknown");
    console.error("Resend error:", errText);
    return json({ error: "Email delivery failed." }, 502);
  }

  return json({ sent: true, to: toEmail });
});
