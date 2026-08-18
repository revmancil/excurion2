/* =============================================
   MemberForge — Shared page interactions (nav, scroll, animations)
============================================= */

document.addEventListener('DOMContentLoaded', function () {

  // ── Sticky Nav scroll effect ──
  const nav = document.getElementById('siteNav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  });

  // ── Hero BG Ken Burns ──
  const hero = document.getElementById('hero');
  if (hero) {
    setTimeout(() => hero.classList.add('loaded'), 100);
  }

  // ── Mobile Menu ──
  const hamburger = document.getElementById('hamburgerBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileClose = document.getElementById('mobileClose');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      mobileMenu.classList.add('open');
      document.body.style.overflow = 'hidden';
    });
  }
  if (mobileClose && mobileMenu) {
    mobileClose.addEventListener('click', () => {
      mobileMenu.classList.remove('open');
      document.body.style.overflow = '';
    });
  }
  if (mobileMenu) {
    // Close menu on link click — exclude label spans inside subsections
    mobileMenu.querySelectorAll('a:not(.mobile-nav-subsection-label)').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        document.body.style.overflow = '';
        const hamburger = document.getElementById('hamburgerBtn');
        if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ── Intersection Observer for fade-up / fade-in animations ──
  const animEls = document.querySelectorAll('.fade-up, .fade-in');
  if (animEls.length > 0) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          // Slight stagger for grouped items
          const delay = entry.target.closest('.pillars-grid, .news-grid, .impact-grid, .events-list')
            ? Array.from(entry.target.parentElement.children).indexOf(entry.target) * 120
            : 0;
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, delay);
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -40px 0px'
    });

    animEls.forEach(el => observer.observe(el));
  }

  // ── Mark active nav link ──
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .mobile-menu a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // ── Smooth scroll for anchor links ──
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

});
