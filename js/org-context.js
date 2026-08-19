/**
 * MemberForge — tenant resolution + branding engine.
 *
 * MemberForge is one static codebase shared by every member organization
 * ("tenant"). There is no per-tenant build step or per-tenant copy of these
 * files — the SAME index.html/admin-dashboard.html/member-portal.html/etc.
 * are served for every org. What makes a page "belong" to a given org
 * happens entirely in the browser, at load time, in three steps:
 *
 *   1. Figure out which org this request is for (resolveOrgSlug below):
 *      a) `?org=<slug>` query override — used for local dev/testing.
 *      b) the request's hostname, matched against organizations.custom_domain
 *         (a customer's own domain, e.g. www.acmealumni.org) or else the
 *         subdomain label (e.g. `acme` in acme.memberforge.app).
 *   2. Fetch that org's branding/config row from the `organizations` table
 *      (public, read-only — see supabase/schema.sql "organizations_read_all").
 *   3. Paint the page: set CSS custom properties for color, swap in the
 *      org's name/logo/contact info/terminology via [data-mf] attributes,
 *      and expose org.id so every other Supabase query on the page can
 *      scope itself with `org_id=eq.<id>` (see MF.scope()).
 *
 * Every tenant-facing page should include, in this order:
 *   <script src="js/memberforge-client.js"></script>
 *   <script src="js/org-context.js"></script>
 *   <script> MF.ready.then(org => { ...page-specific init... }); </script>
 */
(function () {
  const DEFAULT_TERMS = {
    member_noun: 'Member',
    member_noun_plural: 'Members',
    org_unit_noun: 'Organization',
    leader_noun: 'President',
    creed: ''
  };

  // Shared hosting-platform domains whose subdomain label is a project/
  // deployment name, not a tenant slug (e.g. Vercel gives every project a
  // `your-project.vercel.app` URL, and preview deploys look like
  // `your-project-git-branch-you.vercel.app` — none of that is under an
  // org's control the way a real subdomain under your own root domain is).
  // Before a custom domain with real wildcard subdomains is set up, the
  // whole site lives on one of these and should be treated as marketing
  // root; tenant pages are reached via the `?org=<slug>` override instead.
  const SHARED_PLATFORM_SUFFIXES = ['.vercel.app', '.netlify.app', '.pages.dev', '.github.io'];

  // True for the bare apex or www.<root domain> (e.g. memberforge.app,
  // www.memberforge.app), or any host on a shared hosting-platform domain
  // (see above) — with no ?org= override. MemberForge's own marketing
  // site, not a tenant request. A custom tenant domain (e.g.
  // www.acmealumni.org) is NOT marketing-root; it still resolves by
  // `custom_domain` lookup below. Exposed as MF.isMarketingRoot so a page
  // (namely index.html, which serves both marketing and tenant content from
  // one file) can render the marketing homepage instead of treating a
  // no-tenant-found result as a broken link.
  function isMarketingRootHost() {
    if (new URLSearchParams(window.location.search).get('org')) return false;
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(host);
    if (isLocal) return !!window.MEMBERFORGE_LOCAL_IS_MARKETING_ROOT;
    if (SHARED_PLATFORM_SUFFIXES.some(suffix => host.endsWith(suffix))) return true;
    const labels = host.split('.');
    return labels.length <= 2 || (labels.length === 3 && labels[0] === 'www');
  }

  function resolveOrgSlug() {
    const params = new URLSearchParams(window.location.search);
    const override = params.get('org');
    if (override) return { by: 'slug', value: override.toLowerCase().trim() };

    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(host);
    if (isLocal) return null;

    const labels = host.split('.');
    // Bare apex or www.<root domain> is marketing-root (see isMarketingRootHost) —
    // still worth a custom_domain lookup in case a customer's own domain
    // happens to collide with this shape, but expect null in the normal case.
    const isApexOrWww = labels.length <= 2 || (labels.length === 3 && labels[0] === 'www');
    if (isApexOrWww) {
      return { by: 'custom_domain', value: host };
    }
    return { by: 'subdomain', value: labels[0].toLowerCase() };
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  function mix(hex, withHex, weight) {
    const a = hexToRgb(hex), b = hexToRgb(withHex);
    if (!a || !b) return hex;
    return rgbToHex(
      a.r + (b.r - a.r) * weight,
      a.g + (b.g - a.g) * weight,
      a.b + (b.b - a.b) * weight
    );
  }
  function relativeLuminance(hex) {
    const c = hexToRgb(hex);
    if (!c) return 1;
    const chan = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
  }

  function applyBranding(org) {
    const root = document.documentElement.style;
    const accent = (org.accent_color && hexToRgb(org.accent_color)) ? org.accent_color : '#c7562d';
    const ink = (org.ink_color && hexToRgb(org.ink_color)) ? org.ink_color : '#1a1613';
    root.setProperty('--accent', accent);
    root.setProperty('--accent-light', mix(accent, '#ffffff', 0.28));
    root.setProperty('--accent-dark', mix(accent, '#000000', 0.28));
    root.setProperty('--accent-pale', mix(accent, '#ffffff', 0.92));
    root.setProperty('--on-accent', relativeLuminance(accent) > 0.5 ? '#1a1613' : '#ffffff');
    root.setProperty('--ink', ink);
    root.setProperty('--ink-deep', mix(ink, '#000000', 0.25));

    const terms = Object.assign({}, DEFAULT_TERMS, org.terminology || {});
    const favicon = org.favicon_url || org.logo_url;
    if (favicon) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = favicon;
    }

    if (document.title && document.title.includes('{{ORG_NAME}}')) {
      document.title = document.title.replaceAll('{{ORG_NAME}}', org.name);
    }

    const setText = (el, value) => { if (value != null && value !== '') el.textContent = value; };
    document.querySelectorAll('[data-mf="org_name"]').forEach(el => setText(el, org.name));
    document.querySelectorAll('[data-mf="org_tagline"]').forEach(el => setText(el, org.tagline));
    document.querySelectorAll('[data-mf="org_email"]').forEach(el => {
      setText(el, org.contact_email);
      if (el.tagName === 'A' && org.contact_email) el.href = `mailto:${org.contact_email}`;
    });
    document.querySelectorAll('[data-mf="org_phone"]').forEach(el => setText(el, org.contact_phone));
    document.querySelectorAll('[data-mf="org_address"]').forEach(el => setText(el, org.contact_address));
    document.querySelectorAll('[data-mf="org_creed"]').forEach(el => setText(el, terms.creed));
    document.querySelectorAll('[data-mf="year"]').forEach(el => setText(el, String(new Date().getFullYear())));
    document.querySelectorAll('[data-mf="org_logo"]').forEach(el => { el.src = org.logo_url || 'images/default-logo.svg'; });
    document.querySelectorAll('[data-mf="hero_bg"]').forEach(el => { if (org.hero_image_url) el.style.backgroundImage = `url('${org.hero_image_url}')`; });

    document.querySelectorAll('[data-mf-term]').forEach(el => {
      const key = el.getAttribute('data-mf-term');
      if (terms[key] != null) el.textContent = terms[key];
    });

    document.querySelectorAll('a[data-mf-social]').forEach(el => {
      const key = el.getAttribute('data-mf-social'); // facebook | instagram | youtube | linkedin | x
      const url = (org.social_links || {})[key];
      if (url) { el.href = url; el.style.display = ''; }
      else { el.style.display = 'none'; }
    });

    document.body.classList.add('mf-branded');
    document.dispatchEvent(new CustomEvent('mf:branded', { detail: org }));
  }

  // Detects "nobody has pointed js/memberforge-client.js at a real Supabase
  // project yet" — i.e. this is being viewed (e.g. via GitHub Pages) before
  // setup, not a real deployment having an outage. Only in that specific
  // case do we render sample content instead of the "not found" screen, so
  // there's something to look at before wiring up a backend. A configured
  // deployment that's genuinely unreachable still gets the honest error.
  function isUnconfiguredBackend() {
    return /YOUR-PROJECT-REF|YOUR-SUPABASE-ANON-KEY/.test(sb.url + sb.key);
  }

  const DEMO_ORG = {
    id: '00000000-0000-0000-0000-000000000000',
    slug: 'demo',
    name: 'Sample Organization',
    tagline: 'Preview · Connect Supabase to make this live',
    logo_url: null,
    favicon_url: null,
    hero_image_url: null,
    accent_color: '#c7562d',
    ink_color: '#1a1613',
    contact_email: 'hello@example.org',
    contact_phone: '',
    contact_address: '123 Main St, Anytown, USA',
    social_links: {},
    terminology: {},
    plan: 'demo',
    custom_domain: null,
    __demo: true
  };

  function showDemoBanner() {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#1a1613;color:#fff;font-family:Inter,sans-serif;font-size:0.78rem;padding:10px 16px;text-align:center;border-top:2px solid #c7562d;';
    bar.innerHTML = 'Preview mode — showing sample content because no Supabase project is connected yet. <a href="README.md" style="color:#7C74EF;">Setup instructions</a>';
    document.body.appendChild(bar);
  }

  function orgNotFound() {
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Inter',sans-serif;background:#1a1613;color:#fff;text-align:center;padding:24px;">
        <div>
          <h1 style="font-size:1.5rem;margin-bottom:12px;">We couldn't find that organization</h1>
          <p style="opacity:0.7;">Check the link you used, or if you're setting up MemberForge for the first time, <a href="/signup.html" style="color:#7C74EF;">create your organization</a>.</p>
        </div>
      </div>`;
  }

  async function resolve() {
    const target = resolveOrgSlug();
    if (!target) {
      // Local dev with no ?org= override — try a MEMBERFORGE_DEV_ORG_SLUG global.
      const devSlug = window.MEMBERFORGE_DEV_ORG_SLUG;
      if (!devSlug) { console.warn('MemberForge: no org context resolved (set ?org=<slug> for local dev).'); return null; }
      return fetchOrg('slug', devSlug);
    }
    const org = await fetchOrg(target.by, target.value);
    if (!org && target.by === 'custom_domain') {
      // Custom domain didn't match — fall back to treating the first label as a slug
      // (covers orgs still on the shared *.memberforge.app domain during setup).
      return fetchOrg('slug', target.value.split('.')[0]);
    }
    return org;
  }

  async function fetchOrg(by, value) {
    const column = by === 'custom_domain' ? 'custom_domain' : 'slug';
    const cols = 'id,slug,name,tagline,logo_url,favicon_url,hero_image_url,accent_color,ink_color,contact_email,contact_phone,contact_address,social_links,terminology,plan,custom_domain';
    const rows = await sb.getAll('organizations', `${column}=eq.${encodeURIComponent(value)}&select=${cols}&limit=1`);
    return rows[0] || null;
  }

  const MF = {
    org: null,
    isMarketingRoot: false,
    ready: (async () => {
      if (isMarketingRootHost()) {
        // MemberForge's own marketing domain (apex/www) — there is no
        // tenant to resolve, and no Supabase call is made. Pages that
        // serve both marketing and tenant content from one file (namely
        // index.html) check MF.isMarketingRoot after awaiting MF.ready to
        // decide which branch to render, instead of getting the generic
        // "organization not found" screen.
        MF.isMarketingRoot = true;
        return null;
      }
      if (isUnconfiguredBackend()) {
        MF.org = DEMO_ORG;
        applyBranding(DEMO_ORG);
        showDemoBanner();
        return DEMO_ORG;
      }
      try {
        const org = await resolve();
        if (!org) {
          if (!window.MEMBERFORGE_ALLOW_NO_ORG) orgNotFound();
          return null;
        }
        MF.org = org;
        applyBranding(org);
        return org;
      } catch (err) {
        console.error('MemberForge: failed to resolve organization', err);
        if (!window.MEMBERFORGE_ALLOW_NO_ORG) orgNotFound();
        return null;
      }
    })(),
    /** Prefix a PostgREST query string with this tenant's org_id filter. */
    scope(query = '') {
      if (!MF.org) throw new Error('MemberForge: org not resolved yet — await MF.ready first.');
      return `org_id=eq.${MF.org.id}${query ? '&' + query : ''}`;
    },
    /** Stamp org_id onto a row before insert/upsert. */
    stamp(data) {
      if (!MF.org) throw new Error('MemberForge: org not resolved yet — await MF.ready first.');
      return Object.assign({}, data, { org_id: MF.org.id });
    }
  };

  window.MF = MF;
})();
