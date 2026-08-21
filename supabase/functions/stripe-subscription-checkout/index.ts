/**
 * Platform subscription checkout — MemberForge charging an ORGANIZATION to
 * use the platform (the "Start"/"Growth"/"Pro" plans on pricing.html).
 *
 * Not to be confused with stripe-checkout, which handles an org's OWN
 * dues/event/store payments from ITS members — a completely separate money
 * flow with its own metadata.kind values ("dues" | "event" | "store"). This
 * function always sends metadata.kind = "platform_subscription", which is
 * how stripe-webhook tells the two apart.
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

const PLAN_PRICE_ENV: Record<string, string> = {
  start: "STRIPE_PRICE_START",
  growth: "STRIPE_PRICE_GROWTH",
  pro: "STRIPE_PRICE_PRO",
};

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
  const plan = trimStr(payload.plan, 32).toLowerCase();
  if (!orgId) return json({ error: "org_id is required." }, 400);
  const priceEnvName = PLAN_PRICE_ENV[plan];
  if (!priceEnvName) return json({ error: "Unknown plan." }, 400);
  const priceId = Deno.env.get(priceEnvName);
  if (!priceId) {
    return json({ error: `The ${plan} plan is not configured on the server (missing ${priceEnvName}).` }, 503);
  }

  // Require a signed-in FULL admin of this org — billing changes are not a
  // section-scoped permission, they're an ownership-level decision.
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
    return json({ error: "Only a full admin of this organization can change its plan." }, 403);
  }

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, slug, custom_domain, contact_email, stripe_customer_id")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr || !org) return json({ error: "Organization not found." }, 404);

  const orgSiteBase = org.custom_domain
    ? `https://${org.custom_domain}`
    : `https://${org.slug}.${rootDomain}`;
  const siteBase = (Deno.env.get("PUBLIC_SITE_URL") ?? orgSiteBase).replace(/\/$/, "");

  // Reuse the org's existing Stripe Customer if it has one (e.g. changing
  // plans, or re-subscribing after a cancellation), otherwise create one.
  let customerId = org.stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: org.name,
      email: org.contact_email || requesterEmail,
      metadata: { org_id: orgId, org_slug: org.slug },
    });
    customerId = customer.id;
    // Persisting this now (rather than waiting for the webhook) means a
    // second checkout attempt before the first completes still reuses one
    // customer instead of creating a duplicate.
    await admin.from("organizations").update({ stripe_customer_id: customerId }).eq("id", orgId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${siteBase}/admin-dashboard.html?section=billing&billing=success`,
    cancel_url: `${siteBase}/admin-dashboard.html?section=billing&billing=cancel`,
    metadata: { kind: "platform_subscription", org_id: orgId, plan },
    subscription_data: {
      metadata: { kind: "platform_subscription", org_id: orgId, plan },
    },
  });

  return json({ url: session.url });
});
