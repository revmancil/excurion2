/**
 * Opens Stripe's hosted Billing Portal for an org's platform subscription —
 * lets a full admin update their payment method, view invoices, change
 * plans, or cancel, without MemberForge building any of that UI itself.
 *
 * Keep this file self-contained (no ../ imports) so Supabase deploy bundles reliably.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "npm:stripe@17.4.0";
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

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return json({ error: "Stripe is not configured on the server." }, 503);

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
  if (!orgId) return json({ error: "org_id is required." }, 400);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Sign in as an organization admin to manage billing." }, 401);
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user?.email) {
    return json({ error: "Invalid or expired session. Please sign in again." }, 401);
  }
  const requesterEmail = String(userData.user.email).toLowerCase().trim();

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: adminRow } = await admin
    .from("org_admins")
    .select("is_full_admin")
    .eq("org_id", orgId)
    .eq("email", requesterEmail)
    .maybeSingle();
  if (!adminRow?.is_full_admin) {
    return json({ error: "Only a full admin of this organization can manage billing." }, 403);
  }

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("slug, custom_domain, stripe_customer_id")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr || !org) return json({ error: "Organization not found." }, 404);
  if (!org.stripe_customer_id) {
    return json({ error: "This organization hasn't subscribed to a paid plan yet." }, 400);
  }

  const orgSiteBase = org.custom_domain
    ? `https://${org.custom_domain}`
    : `https://${org.slug}.${rootDomain}`;
  const siteBase = (Deno.env.get("PUBLIC_SITE_URL") ?? orgSiteBase).replace(/\/$/, "");

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${siteBase}/admin-dashboard.html?section=billing`,
  });

  return json({ url: session.url });
});
