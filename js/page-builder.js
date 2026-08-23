/**
 * MemberForge — website builder block registry.
 *
 * The single source of truth for what a "block" is, shared by both
 * website-editor.html (the visual editor) and the public renderer
 * (index.html's applyBuilderPage()) so they can never drift apart — a
 * block that renders one way in the editor's preview and another way on
 * the live public page would be a real, confusing bug.
 *
 * A block is `{ type, locked, props: { id, ...type-specific fields } }`.
 * `locked` is the one canonical key enforced server-side (see
 * enforce_builder_page_locks in schema.sql) — only a platform admin can
 * remove or change a locked block.
 *
 * render(props, ctx) always returns a Promise<string> of HTML, even for
 * purely static blocks, so callers never need to branch on sync vs async —
 * EventFeed/MemberDirectoryPreview need to fetch live data (ctx.orgId),
 * everything else resolves immediately.
 */
(function () {
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escAttr(str) { return esc(str).replace(/'/g, '&#39;'); }
  function newId(type) {
    return type.toLowerCase() + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  const BLOCK_TYPES = {

    HeroSection: {
      label: 'Hero',
      icon: 'fa-image',
      defaultProps: () => ({
        headline: 'Welcome to Our Organization',
        subheadline: 'Empowering members and connecting our community.',
        ctaText: 'Become a Member',
        ctaLink: 'membership.html',
        backgroundImage: '',
        align: 'center'
      }),
      fields: [
        { key: 'headline', label: 'Headline', type: 'text' },
        { key: 'subheadline', label: 'Subheadline', type: 'textarea' },
        { key: 'ctaText', label: 'Button text', type: 'text' },
        { key: 'ctaLink', label: 'Button link', type: 'url' },
        { key: 'backgroundImage', label: 'Background image', type: 'image' },
        { key: 'align', label: 'Text alignment', type: 'select', options: ['left', 'center', 'right'] }
      ],
      async render(p) {
        const bg = p.backgroundImage
          ? `background-image:linear-gradient(rgba(0,0,0,0.45),rgba(0,0,0,0.45)),url('${escAttr(p.backgroundImage)}');background-size:cover;background-position:center;`
          : 'background:var(--ink);';
        const align = p.align === 'left' ? 'left' : p.align === 'right' ? 'right' : 'center';
        return `<section style="${bg}color:#fff;padding:100px 24px;text-align:${align};">
          <div style="max-width:760px;margin:0 auto;">
            <h1 style="font-size:2.6rem;font-weight:800;margin:0 0 16px;">${esc(p.headline)}</h1>
            <p style="font-size:1.15rem;opacity:0.9;margin:0 0 28px;">${esc(p.subheadline)}</p>
            ${p.ctaText ? `<a href="${escAttr(p.ctaLink || '#')}" style="display:inline-block;background:var(--accent);color:var(--on-accent, #fff);padding:14px 28px;border-radius:8px;font-weight:700;text-decoration:none;">${esc(p.ctaText)}</a>` : ''}
          </div>
        </section>`;
      }
    },

    FeatureGrid: {
      label: 'Feature Grid',
      icon: 'fa-table-cells',
      defaultProps: () => ({
        heading: 'What We Offer',
        columns: 3,
        items: [
          { icon: 'fa-star', title: 'Feature One', body: 'Describe this feature.' },
          { icon: 'fa-star', title: 'Feature Two', body: 'Describe this feature.' },
          { icon: 'fa-star', title: 'Feature Three', body: 'Describe this feature.' }
        ]
      }),
      fields: [
        { key: 'heading', label: 'Heading', type: 'text' },
        { key: 'columns', label: 'Columns', type: 'select', options: [2, 3, 4] },
        { key: 'items', label: 'Cards', type: 'card-list', itemFields: [
          { key: 'icon', label: 'Icon (Font Awesome class)', type: 'text' },
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'body', label: 'Body', type: 'textarea' }
        ] }
      ],
      async render(p) {
        const cols = [2, 3, 4].includes(Number(p.columns)) ? Number(p.columns) : 3;
        const items = Array.isArray(p.items) ? p.items : [];
        return `<section style="padding:64px 24px;">
          <div style="max-width:1100px;margin:0 auto;">
            ${p.heading ? `<h2 style="text-align:center;font-size:1.8rem;font-weight:800;margin:0 0 40px;">${esc(p.heading)}</h2>` : ''}
            <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:24px;">
              ${items.map(it => `
                <div style="padding:24px;border:1px solid var(--gray-200,#e5e7eb);border-radius:10px;">
                  ${it.icon ? `<i class="fas ${escAttr(it.icon)}" style="font-size:1.6rem;color:var(--accent);margin-bottom:12px;display:block;"></i>` : ''}
                  <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px;">${esc(it.title)}</h3>
                  <p style="font-size:0.92rem;color:var(--gray-500,#6b7280);margin:0;">${esc(it.body)}</p>
                </div>`).join('')}
            </div>
          </div>
        </section>`;
      }
    },

    RichText: {
      label: 'Rich Text',
      icon: 'fa-paragraph',
      defaultProps: () => ({ content: '<h2>About Us</h2><p>Tell your story here.</p>' }),
      fields: [
        { key: 'content', label: 'Content', type: 'richtext' }
      ],
      async render(p) {
        return `<section style="padding:48px 24px;"><div style="max-width:760px;margin:0 auto;line-height:1.7;">${p.content || ''}</div></section>`;
      }
    },

    EventFeed: {
      label: 'Event Feed',
      icon: 'fa-calendar-days',
      defaultProps: () => ({ heading: 'Upcoming Events', limit: 3 }),
      fields: [
        { key: 'heading', label: 'Heading', type: 'text' },
        { key: 'limit', label: 'Number of events', type: 'number' }
      ],
      async render(p, ctx) {
        const limit = Math.max(1, Math.min(12, Number(p.limit) || 3));
        let events = [];
        try {
          if (ctx && ctx.orgId && ctx.sb) {
            events = await ctx.sb.getAll(
              'events',
              `org_id=eq.${ctx.orgId}&select=id,name,event_date,location&order=event_date.asc&limit=${limit}`
            ) || [];
          }
        } catch (e) { console.error('EventFeed', e); }
        const rows = events.length
          ? events.map(ev => `
              <div style="display:flex;gap:16px;align-items:baseline;padding:14px 0;border-top:1px solid var(--gray-200,#e5e7eb);">
                <div style="font-family:monospace;color:var(--accent);font-size:0.85rem;white-space:nowrap;">${ev.event_date ? esc(new Date(ev.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) : ''}</div>
                <div>
                  <div style="font-weight:700;">${esc(ev.name)}</div>
                  ${ev.location ? `<div style="font-size:0.85rem;color:var(--gray-500,#6b7280);">${esc(ev.location)}</div>` : ''}
                </div>
              </div>`).join('')
          : `<p style="color:var(--gray-500,#6b7280);">No upcoming events yet.</p>`;
        return `<section style="padding:48px 24px;"><div style="max-width:640px;margin:0 auto;">
          ${p.heading ? `<h2 style="font-size:1.6rem;font-weight:800;margin:0 0 12px;">${esc(p.heading)}</h2>` : ''}
          ${rows}
        </div></section>`;
      }
    },

    MemberDirectoryPreview: {
      label: 'Leadership Preview',
      icon: 'fa-users',
      defaultProps: () => ({ heading: 'Our Leadership', limit: 4 }),
      fields: [
        { key: 'heading', label: 'Heading', type: 'text' },
        { key: 'limit', label: 'Number to show', type: 'number' }
      ],
      // Sources from the org's public officer roster (site_content key
      // "officers"), never the members table directly — members is
      // RLS-gated to signed-in org members/admins, and this block renders
      // for anonymous public visitors.
      async render(p, ctx) {
        const limit = Math.max(1, Math.min(12, Number(p.limit) || 4));
        let officers = [];
        try {
          if (ctx && ctx.orgId && ctx.sb) {
            const rows = await ctx.sb.getAll(
              'site_content',
              `org_id=eq.${ctx.orgId}&content_key=eq.officers&select=content_json&limit=1`
            );
            const list = rows && rows[0] && Array.isArray(rows[0].content_json) ? rows[0].content_json : [];
            officers = list.slice(0, limit);
          }
        } catch (e) { console.error('MemberDirectoryPreview', e); }
        const cards = officers.length
          ? officers.map(o => `
              <div style="text-align:center;">
                <div style="width:88px;height:88px;border-radius:50%;margin:0 auto 10px;background:var(--gray-100,#f3f4f6) center/cover;${o.photo ? `background-image:url('${escAttr(o.photo)}');` : ''}"></div>
                <div style="font-weight:700;">${esc(o.name || '')}</div>
                <div style="font-size:0.85rem;color:var(--gray-500,#6b7280);">${esc(o.title || '')}</div>
              </div>`).join('')
          : `<p style="color:var(--gray-500,#6b7280);">Leadership roster coming soon.</p>`;
        return `<section style="padding:48px 24px;"><div style="max-width:800px;margin:0 auto;text-align:center;">
          ${p.heading ? `<h2 style="font-size:1.6rem;font-weight:800;margin:0 0 28px;">${esc(p.heading)}</h2>` : ''}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:24px;">${cards}</div>
        </div></section>`;
      }
    },

    ContactForm: {
      label: 'Contact Form',
      icon: 'fa-envelope',
      defaultProps: () => ({ heading: 'Get in Touch', subheading: 'We would love to hear from you.' }),
      fields: [
        { key: 'heading', label: 'Heading', type: 'text' },
        { key: 'subheading', label: 'Subheading', type: 'text' }
      ],
      // Routes through the existing membership_inquiries table/RLS policy
      // (membership_inquiries_insert_anon) rather than inventing a second
      // inquiry pipeline — same table membership-inquiry.html already uses.
      async render(p) {
        const formId = 'mfb-contact-' + Math.random().toString(36).slice(2, 8);
        return `<section style="padding:48px 24px;"><div style="max-width:480px;margin:0 auto;">
          ${p.heading ? `<h2 style="font-size:1.6rem;font-weight:800;margin:0 0 6px;">${esc(p.heading)}</h2>` : ''}
          ${p.subheading ? `<p style="color:var(--gray-500,#6b7280);margin:0 0 20px;">${esc(p.subheading)}</p>` : ''}
          <form id="${formId}" class="mfb-contact-form" onsubmit="return MFBuilder.handleContactSubmit(event, '${formId}')">
            <input type="text" name="name" placeholder="Your name" required style="width:100%;padding:11px;margin-bottom:10px;border:1px solid var(--gray-200,#e5e7eb);border-radius:6px;" />
            <input type="email" name="email" placeholder="Your email" required style="width:100%;padding:11px;margin-bottom:10px;border:1px solid var(--gray-200,#e5e7eb);border-radius:6px;" />
            <textarea name="message" placeholder="Message" rows="4" required style="width:100%;padding:11px;margin-bottom:10px;border:1px solid var(--gray-200,#e5e7eb);border-radius:6px;font-family:inherit;"></textarea>
            <button type="submit" style="width:100%;padding:12px;background:var(--accent);color:var(--on-accent,#fff);border:none;border-radius:6px;font-weight:700;cursor:pointer;">Send</button>
            <div class="mfb-contact-status" style="margin-top:10px;font-size:0.85rem;"></div>
          </form>
        </div></section>`;
      }
    },

    CallToActionBanner: {
      label: 'CTA Banner',
      icon: 'fa-bullhorn',
      defaultProps: () => ({ text: 'Ready to join us?', ctaText: 'Get Started', ctaLink: 'membership.html', bgColor: '' }),
      fields: [
        { key: 'text', label: 'Banner text', type: 'text' },
        { key: 'ctaText', label: 'Button text', type: 'text' },
        { key: 'ctaLink', label: 'Button link', type: 'url' },
        { key: 'bgColor', label: 'Background color (blank = brand accent)', type: 'color' }
      ],
      async render(p) {
        const bg = p.bgColor ? escAttr(p.bgColor) : 'var(--accent)';
        return `<section style="background:${bg};color:#fff;padding:48px 24px;text-align:center;">
          <div style="max-width:640px;margin:0 auto;display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:center;">
            <div style="font-size:1.3rem;font-weight:700;">${esc(p.text)}</div>
            ${p.ctaText ? `<a href="${escAttr(p.ctaLink || '#')}" style="background:#fff;color:var(--ink);padding:12px 24px;border-radius:8px;font-weight:700;text-decoration:none;">${esc(p.ctaText)}</a>` : ''}
          </div>
        </section>`;
      }
    },

    StatsCounter: {
      label: 'Stats Counter',
      icon: 'fa-chart-simple',
      defaultProps: () => ({ items: [
        { value: '500+', label: 'Active Members' },
        { value: '25', label: 'Years Active' },
        { value: '120', label: 'Events Hosted' }
      ] }),
      fields: [
        { key: 'items', label: 'Stats', type: 'card-list', itemFields: [
          { key: 'value', label: 'Value', type: 'text' },
          { key: 'label', label: 'Label', type: 'text' }
        ] }
      ],
      async render(p) {
        const items = Array.isArray(p.items) ? p.items : [];
        return `<section style="padding:48px 24px;background:var(--gray-50,#f9fafb);">
          <div style="max-width:760px;margin:0 auto;display:grid;grid-template-columns:repeat(${Math.max(1, items.length)},1fr);gap:24px;text-align:center;">
            ${items.map(it => `
              <div>
                <div style="font-size:2rem;font-weight:800;color:var(--accent);">${esc(it.value)}</div>
                <div style="font-size:0.85rem;color:var(--gray-500,#6b7280);">${esc(it.label)}</div>
              </div>`).join('')}
          </div>
        </section>`;
      }
    }
  };

  async function renderBlock(block, ctx) {
    const def = BLOCK_TYPES[block.type];
    if (!def) return `<!-- unknown block type: ${esc(block.type)} -->`;
    try {
      return await def.render(block.props || {}, ctx || {});
    } catch (e) {
      console.error('renderBlock', block.type, e);
      return '';
    }
  }

  async function renderPage(contentJson, ctx) {
    const blocks = (contentJson && Array.isArray(contentJson.content)) ? contentJson.content : [];
    const parts = await Promise.all(blocks.map(b => renderBlock(b, ctx)));
    return parts.join('\n');
  }

  function newBlock(type) {
    const def = BLOCK_TYPES[type];
    if (!def) throw new Error('Unknown block type: ' + type);
    return { type, locked: false, props: Object.assign({ id: newId(type) }, def.defaultProps()) };
  }

  // Public contact-form submission handler — used by the ContactForm block
  // on the live public page (not the editor preview). Writes to the same
  // membership_inquiries table membership-inquiry.html already uses, so it
  // shows up in the existing admin moderation queue with no new plumbing.
  async function handleContactSubmit(evt, formId) {
    evt.preventDefault();
    const form = document.getElementById(formId);
    const statusEl = form.querySelector('.mfb-contact-status');
    const btn = form.querySelector('button[type="submit"]');
    const org = window.MF && window.MF.org;
    if (!org || !window.sb) {
      statusEl.textContent = 'This form is not available right now.';
      return false;
    }
    const fd = new FormData(form);
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Sending…';
    try {
      const nameParts = String(fd.get('name') || '').trim().split(/\s+/);
      await sb.insert('membership_inquiries', MF.stamp({
        first_name: nameParts[0] || '',
        last_name: nameParts.slice(1).join(' '),
        email: String(fd.get('email') || '').trim(),
        message: String(fd.get('message') || '').trim(),
        status: 'pending'
      }));
      form.reset();
      statusEl.style.color = '#3c6b4f';
      statusEl.textContent = 'Thanks — we’ll be in touch soon.';
    } catch (err) {
      statusEl.style.color = '#b3261e';
      statusEl.textContent = 'Could not send — please try again.';
      console.error('contact form submit', err);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
    return false;
  }

  window.MFBuilder = { BLOCK_TYPES, renderBlock, renderPage, newBlock, handleContactSubmit };
})();
