/**
 * MemberForge — shared auth/session/permission helpers.
 *
 * One Supabase Auth user pool is shared by every tenant (Supabase Auth has
 * no concept of "org"), so a person's org membership and role always come
 * from a *table* lookup scoped by org_id — never from the JWT alone. This
 * file is the single place that does that lookup, replacing three
 * independent, inconsistent checks the original single-tenant app had
 * (chapter_admins, members.portal_access, members.finance_role): here they
 * are one row in org_admins (permissions) + one row in members (identity/
 * portal access) per (org, person).
 *
 * Requires js/memberforge-client.js and js/org-context.js loaded first, and
 * MF.ready resolved (i.e. call this after `await MF.ready`).
 *
 * Security note: permission lookups here fail CLOSED — any error or missing
 * row means "no access", never "full admin". (The chapter-specific app this
 * was generalized from had a fail-OPEN bug in the admin dashboard; do not
 * reintroduce it when porting panels.)
 */
(function () {
  function storageKey(org) { return `mf_session_${org.slug}`; }

  const MFAuth = {
    session: null,
    member: null,
    adminPermissions: null, // { isFullAdmin, sections: string[], financeRole: string|null }

    loadSession() {
      if (!MF.org) return null;
      try {
        const raw = localStorage.getItem(storageKey(MF.org));
        if (!raw) return null;
        const session = JSON.parse(raw);
        if (!session.expires_at || session.expires_at * 1000 < Date.now()) {
          localStorage.removeItem(storageKey(MF.org));
          return null;
        }
        this.session = session;
        sb.session = session;
        return session;
      } catch { return null; }
    },

    saveSession(session) {
      this.session = session;
      sb.session = session;
      localStorage.setItem(storageKey(MF.org), JSON.stringify(session));
    },

    async signIn(email, password) {
      const res = await fetch(`${sb.url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: sb.key },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign in failed');
      this.saveSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at,
        user: data.user
      });
      return data.user;
    },

    async requestPasswordReset(email, redirectTo) {
      const res = await fetch(`${sb.url}/auth/v1/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: sb.key },
        body: JSON.stringify({ email, options: redirectTo ? { redirect_to: redirectTo } : undefined })
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.msg || 'Reset request failed'); }
      return true;
    },

    /** Call after Supabase redirects back with #access_token=...&type=recovery in the URL hash. */
    async completePasswordReset(newPassword, accessToken) {
      const res = await fetch(`${sb.url}/auth/v1/user`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', apikey: sb.key, Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ password: newPassword })
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.msg || 'Password update failed'); }
      return true;
    },

    signOut() {
      if (MF.org) localStorage.removeItem(storageKey(MF.org));
      this.session = null;
      this.member = null;
      this.adminPermissions = null;
      sb.session = null;
    },

    isSignedIn() { return !!(this.session && this.session.access_token); },

    /** Fetch (and cache) this signed-in user's member record for the current org. */
    async loadMember() {
      if (!this.isSignedIn() || !MF.org) return null;
      const rows = await sb.getAll('members', `${MF.scope(`auth_user_id=eq.${this.session.user.id}`)}&limit=1`);
      this.member = rows[0] || null;
      return this.member;
    },

    /**
     * Fetch (and cache) this signed-in user's admin permissions for the
     * current org. Fails closed: any lookup error or missing row = no access.
     */
    async loadAdminPermissions() {
      this.adminPermissions = { isFullAdmin: false, sections: [], financeRole: null };
      if (!this.isSignedIn() || !MF.org) return this.adminPermissions;
      try {
        const email = (this.session.user.email || '').toLowerCase().trim();
        const rows = await sb.getAll('org_admins', `${MF.scope(`email=eq.${encodeURIComponent(email)}`)}&limit=1`);
        const row = rows[0];
        if (row) {
          this.adminPermissions = {
            isFullAdmin: !!row.is_full_admin,
            sections: row.sections || [],
            financeRole: row.finance_role || null
          };
        }
      } catch (err) {
        console.error('MemberForge: admin permission lookup failed, denying access', err);
      }
      return this.adminPermissions;
    },

    canManage(section) {
      const p = this.adminPermissions;
      if (!p) return false;
      return p.isFullAdmin || p.sections.includes(section);
    },

    isAdmin() {
      const p = this.adminPermissions;
      return !!p && (p.isFullAdmin || p.sections.length > 0);
    },

    hasFinanceRole(...roles) {
      const p = this.adminPermissions;
      return !!p && p.financeRole && (roles.length === 0 || roles.includes(p.financeRole));
    },

    /** Self-registration ("Request Access") — creates an auth user + a pending members row. */
    async registerMember({ email, password, firstName, lastName, memberNumber, phone }) {
      const res = await fetch(`${sb.url}/auth/v1/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: sb.key },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.msg || 'Registration failed');
      if (data.access_token) {
        this.saveSession({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at, user: data.user });
      }
      const memberRow = MF.stamp({
        auth_user_id: data.user.id,
        email,
        first_name: firstName || '',
        last_name: lastName || '',
        member_number: memberNumber || '',
        phone: phone || '',
        status: 'active',
        portal_access: 'pending'
      });
      const [member] = await sb.insert('members', memberRow);
      this.member = member;
      return { user: data.user, member };
    }
  };

  window.MFAuth = MFAuth;
})();
