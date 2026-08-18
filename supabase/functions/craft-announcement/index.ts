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

interface Payload {
  description: string;   // what the member wants to say
  title?: string;        // announcement title (context)
  category?: string;     // General, Event, Scholarship, etc.
  tone?: string;         // Professional, Casual, Formal
  org_id?: string;       // organization this announcement belongs to
  org_name?: string;     // caller-supplied org name (used if org_id lookup fails/omitted)
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return json({ error: "AI service not configured. Ask your organization admin to add the ANTHROPIC_API_KEY secret in Supabase." }, 500);
    }

    const { description, title, category, tone, org_id, org_name } = await req.json() as Payload;

    if (!description || description.trim().length < 5) {
      return json({ error: "Please provide a description of what you want to announce." }, 400);
    }

    // Resolve the org's real name + terminology so the prompt isn't
    // hardcoded to any one tenant. Prefer a server-side lookup by org_id
    // (authoritative); fall back to the caller-supplied org_name; fall back
    // to a generic label if neither is available.
    let orgName = String(org_name ?? "").trim();
    let memberNoun = "member";

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (org_id && supabaseUrl && serviceKey) {
      try {
        const admin = createClient(supabaseUrl, serviceKey);
        const { data: org } = await admin
          .from("organizations")
          .select("name, terminology")
          .eq("id", String(org_id).trim())
          .maybeSingle();
        if (org?.name) orgName = String(org.name);
        const terminology = (org?.terminology ?? {}) as Record<string, unknown>;
        const noun = String(terminology.member_noun ?? "").trim();
        if (noun) memberNoun = noun;
      } catch (e) {
        console.error("craft-announcement: org lookup failed", e);
        // Non-fatal — fall through with whatever org_name/defaults we have.
      }
    }

    if (!orgName) orgName = "your organization";
    const memberNounPlural = memberNoun.endsWith("s") ? memberNoun : `${memberNoun}s`;

    const toneGuide = tone === "Formal"
      ? "Use formal, dignified language appropriate for a professional organizational communication."
      : tone === "Casual"
      ? "Use warm, friendly language that feels personal and approachable."
      : "Use professional but approachable language — clear, respectful, and warm.";

    const categoryContext = category && category !== "General"
      ? `The category is "${category}".`
      : "";

    const titleContext = title ? `The announcement title is: "${title}".` : "";

    const systemPrompt = `You are drafting a brief announcement for ${orgName}, a membership organization. You help ${orgName} craft well-written announcements for its ${memberNounPlural}. Address members as "${memberNounPlural}" where a collective term is natural.

When writing announcements:
- Write in the voice of someone from ${orgName} speaking to fellow ${memberNounPlural}
- Be clear, concise, and action-oriented
- Include all relevant information from the description
- Use inclusive, welcoming language appropriate to a membership organization
- Do NOT include a subject line or title — only the message body
- Do NOT use placeholder text like [Name] or [Date] — if information is missing, write around it naturally
- Keep it warm, concise, and professional — 2-4 short paragraphs unless more detail is clearly needed
- ${toneGuide}`;

    const userPrompt = `Please craft a well-written announcement message for our ${memberNoun} portal.

${titleContext}
${categoryContext}

Here is what they want to communicate:
${description.trim()}

Write only the announcement message body — no title, no greeting, and no sign-off.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-5",
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", err);
      let errMsg = "AI service error. Please try again.";
      try {
        const parsed = JSON.parse(err);
        if (parsed?.error?.message) errMsg = parsed.error.message;
      } catch (_) { /* use default */ }
      return json({ error: errMsg }, 502);
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text ?? "";

    return json({ announcement: text.trim() });
  } catch (e) {
    console.error("craft-announcement error:", e);
    return json({ error: "Unexpected error. Please try again." }, 500);
  }
});
