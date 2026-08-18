import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type Block =
  | { type: "text"; heading?: string; body?: string }
  | { type: "image"; imageUrl?: string; alt?: string; caption?: string }
  | { type: "cta"; text?: string; url?: string }
  | { type: "social"; heading?: string; links?: Array<{ network?: string; url?: string }> }
  | { type: "divider" };

type RenderRequest = {
  campaignName?: string;
  subject?: string;
  preheader?: string;
  blocks?: Block[];
  brand?: { orgName?: string; primaryColor?: string; darkColor?: string; textColor?: string };
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sanitizeBody(html: string): string {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
}

function isUrl(u: unknown): boolean {
  return /^https?:\/\//i.test(String(u ?? "").trim());
}

function wrapRow(content: string, bg = "#ffffff", pad = "20px 24px"): string {
  return `
    <tr><td style="background:${bg};padding:${pad};">
      ${content}
    </td></tr>`;
}

function buildHtml(p: RenderRequest): string {
  const gold    = p.brand?.primaryColor ?? "#4F46E5";
  const dark    = p.brand?.darkColor    ?? "#0b0f19";
  const text    = p.brand?.textColor    ?? "#2a2a2a";
  const orgName = p.brand?.orgName      ?? "Your Organization";
  const subject = p.subject ?? p.campaignName ?? `${orgName} Newsletter`;
  const pre     = p.preheader ?? "";
  const blocks  = Array.isArray(p.blocks) ? p.blocks : [];

  const rows: string[] = [];

  // Header
  rows.push(wrapRow(`
    <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;">${esc(p.campaignName ?? orgName)}</p>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#cccccc;">${esc(subject)}</p>
  `, dark, "24px"));

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;

    if (block.type === "text") {
      const h = block.heading ? `<p style="margin:0 0 10px;font-family:Georgia,serif;font-size:20px;font-weight:700;color:${text};">${esc(block.heading)}</p>` : "";
      const b = block.body ? `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:${text};">${sanitizeBody(block.body)}</div>` : "";
      if (h || b) rows.push(wrapRow(h + b));

    } else if (block.type === "image") {
      const src = String(block.imageUrl ?? "").trim();
      if (!isUrl(src)) continue;
      const cap = block.caption ? `<p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#888888;">${esc(block.caption)}</p>` : "";
      rows.push(wrapRow(`<img src="${esc(src)}" alt="${esc(block.alt ?? "")}" width="100%" style="display:block;max-width:100%;border-radius:6px;" />${cap}`));

    } else if (block.type === "cta") {
      const label = String(block.text ?? "").trim();
      const href  = String(block.url  ?? "").trim();
      if (!label || !isUrl(href)) continue;
      rows.push(wrapRow(`
        <p style="margin:0;text-align:center;">
          <a href="${esc(href)}" style="display:inline-block;padding:13px 28px;background:${gold};color:#111111;font-family:Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;border-radius:4px;">${esc(label)}</a>
        </p>
      `));

    } else if (block.type === "social") {
      const links = (block.links ?? []).filter((l) => isUrl(String(l?.url ?? "").trim()));
      if (!links.length) continue;
      const heading = block.heading ?? "Connect With Us";
      const linkHtml = links.map((l) => {
        const name = String(l.network ?? "Link").trim();
        return `<a href="${esc(String(l.url).trim())}" style="display:inline-block;margin:0 6px;padding:8px 16px;border:1px solid ${gold};border-radius:4px;color:${gold};font-family:Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;">${esc(name)}</a>`;
      }).join("");
      rows.push(wrapRow(`
        <p style="margin:0 0 12px;font-family:Georgia,serif;font-size:16px;font-weight:700;color:${text};">${esc(heading)}</p>
        <p style="margin:0;">${linkHtml}</p>
      `));

    } else if (block.type === "divider") {
      rows.push(`<tr><td style="padding:4px 24px;background:#ffffff;"><hr style="border:none;border-top:1px solid #e0e0e0;margin:0;" /></td></tr>`);
    }
  }

  // Footer
  rows.push(wrapRow(`
    <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#888888;line-height:1.6;">
      You are receiving this email because you are connected to ${esc(orgName)}.
    </p>
  `, "#f8f8f8", "16px 24px"));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${esc(subject)}</title>
${pre ? `<meta name="description" content="${esc(pre)}" />` : ""}
<style>
  body,#bodyTable{margin:0;padding:0;background:#f4f4f4;}
  img{border:0;outline:none;text-decoration:none;}
  @media only screen and (max-width:620px){
    #emailContainer{width:100%!important;}
  }
</style>
</head>
<body>
${pre ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(pre)}</div>` : ""}
<table id="bodyTable" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4;">
<tr><td align="center" style="padding:20px 10px;">
  <table id="emailContainer" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
    ${rows.join("\n")}
  </table>
</td></tr>
</table>
</body>
</html>`;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });
  try {
    const payload = await req.json() as RenderRequest;
    const html = buildHtml(payload);
    return new Response(JSON.stringify({ html, warnings: [] }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Render failed" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
