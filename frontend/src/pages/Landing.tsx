import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion, type Variants } from 'framer-motion';

// ─── Section reveal helper ──────────────────────────────────────────────────
//
// Every block of marketing copy on the page slides up + fades in once it
// crosses ~30% of the viewport. `useReducedMotion` respects the user's OS
// "reduce motion" setting — important for vestibular-sensitive visitors.
function useReveal(): Variants {
  const reduce = useReducedMotion();
  return {
    hidden: { opacity: 0, y: reduce ? 0 : 24 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: reduce ? 0.0 : 0.6, ease: [0.22, 1, 0.36, 1] },
    },
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function Landing() {
  return (
    <div className="text-ink-900">
      <Header />
      <main>
        <Hero />
        <FeatureGrid />
        <Stats />
        <ClosingCTA />
      </main>
      <Footer />
    </div>
  );
}

// ─── Header (sticky, hamburger on mobile) ──────────────────────────────────

function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Subtle visual tell that the page has scrolled — header gets a deeper
  // backdrop and a hairline border so it separates from content.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={
        'sticky top-0 z-40 transition-colors duration-200 ' +
        (scrolled
          ? 'bg-cream-50/80 backdrop-blur-xl border-b border-cream-200/40'
          : 'bg-transparent')
      }
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8 h-16 flex items-center gap-6">
        <Logo />

        <nav className="hidden md:flex items-center gap-7 mx-auto text-sm text-ink-500">
          <a href="#features" className="hover:text-ink-900 transition-colors">Features</a>
          <a href="#stats" className="hover:text-ink-900 transition-colors">Pricing</a>
          <a href="#about" className="hover:text-ink-900 transition-colors">About</a>
        </nav>

        <div className="hidden md:flex items-center gap-2">
          <Link
            to="/login"
            className="rounded-xl px-4 py-2 text-sm font-medium text-ink-900 border border-cream-200/60 hover:bg-cream-100 transition-colors"
          >
            Log In
          </Link>
          <Link
            to="/signup"
            className="rounded-xl px-4 py-2 text-sm font-semibold bg-gold-500 hover:bg-gold-600 text-ink-900 transition-colors shadow-md shadow-gold-500/20"
          >
            Sign Up
          </Link>
        </div>

        <button
          aria-label="Toggle menu"
          className="md:hidden ml-auto w-10 h-10 rounded-xl bg-cream-100 border border-cream-200/40 flex items-center justify-center"
          onClick={() => setOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-ink-900" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            {open ? (
              <>
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </>
            ) : (
              <>
                <path d="M4 7h16" />
                <path d="M4 12h16" />
                <path d="M4 17h16" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile drawer — collapses the same nav + auth links into a vertical
          stack. Closes itself when a link is tapped (good UX for SPAs). */}
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="md:hidden border-t border-cream-200/40 bg-cream-50/95 backdrop-blur-xl"
        >
          <div className="px-5 py-4 flex flex-col gap-2 text-sm">
            <a href="#features" onClick={() => setOpen(false)} className="py-2 text-ink-500">Features</a>
            <a href="#stats" onClick={() => setOpen(false)} className="py-2 text-ink-500">Pricing</a>
            <a href="#about" onClick={() => setOpen(false)} className="py-2 text-ink-500">About</a>
            <div className="grid grid-cols-2 gap-2 pt-3">
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                className="text-center rounded-xl px-4 py-3 text-sm font-medium text-ink-900 border border-cream-200/60"
              >
                Log In
              </Link>
              <Link
                to="/signup"
                onClick={() => setOpen(false)}
                className="text-center rounded-xl px-4 py-3 text-sm font-semibold bg-gold-500 text-ink-900"
              >
                Sign Up
              </Link>
            </div>
          </div>
        </motion.div>
      )}
    </header>
  );
}

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 shrink-0">
      <span className="w-8 h-8 rounded-xl bg-gold-500 flex items-center justify-center shadow-md shadow-gold-500/30">
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] text-ink-900" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="11" r="3" />
          <path d="M7.5 17c1-1.8 2.8-2.7 4.5-2.7s3.5.9 4.5 2.7" />
          <path d="M5 8V6a1 1 0 0 1 1-1h2M19 8V6a1 1 0 0 0-1-1h-2M5 16v2a1 1 0 0 0 1 1h2M19 16v2a1 1 0 0 1-1 1h-2" />
        </svg>
      </span>
      <span className="font-extrabold tracking-tight text-ink-900">FaceID Access</span>
    </Link>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────────────

function Hero() {
  const reveal = useReveal();
  return (
    <section className="relative overflow-hidden">
      {/* Decorative glow blobs — purely cosmetic, sit behind everything. */}
      <div aria-hidden className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute -top-40 -right-32 w-[520px] h-[520px] rounded-full bg-gold-500/15 blur-[140px]" />
        <div className="absolute -bottom-40 -left-32 w-[460px] h-[460px] rounded-full bg-gold-400/10 blur-[140px]" />
      </div>

      <div className="mx-auto max-w-6xl px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24">
        <motion.div
          variants={reveal}
          initial="hidden"
          animate="show"
          className="grid lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-14 items-center"
        >
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-cream-100 border border-cream-200/40 px-3 py-1 text-xs font-semibold text-gold-300">
              <span className="w-1.5 h-1.5 rounded-full bg-gold-400 animate-pulse" />
              Biometric platform · v2.0
            </span>
            <h1 className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.05]">
              Secure Identity Management
              <br />
              <span className="bg-gradient-to-r from-gold-300 via-gold-400 to-gold-500 bg-clip-text text-transparent">
                Powered by AI
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-base sm:text-lg text-ink-500 leading-relaxed">
              Passwordless login, multi-angle liveness checks, and role-based
              access in one CRM-ready platform. Onboard your team in minutes,
              not weeks.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/signup"
                className="rounded-2xl bg-gold-500 hover:bg-gold-600 text-ink-900 font-semibold px-6 py-3.5 shadow-lg shadow-gold-500/25 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Get Started
              </Link>
              <a
                href="#features"
                className="rounded-2xl bg-cream-100 hover:bg-cream-200/40 border border-cream-200/40 text-ink-900 font-medium px-6 py-3.5 transition-colors"
              >
                Learn More
              </a>
            </div>

            <div className="mt-8 flex items-center gap-3 text-sm text-ink-500">
              <Stars />
              <span>
                <span className="font-semibold text-ink-900">4.8</span> · trusted by 500+ teams
              </span>
            </div>
          </div>

          <HeroVisual />
        </motion.div>
      </div>
    </section>
  );
}

function Stars() {
  return (
    <div className="flex items-center gap-0.5 text-gold-400">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} viewBox="0 0 20 20" className="w-4 h-4 fill-current">
          <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9z" />
        </svg>
      ))}
    </div>
  );
}

// Stylized "auth in progress" mock — pure CSS/SVG, no asset deps.
function HeroVisual() {
  const reduce = useReducedMotion();
  return (
    <div className="relative aspect-[4/5] sm:aspect-[5/6] lg:aspect-[4/5] max-w-md mx-auto w-full">
      <div className="absolute inset-0 rounded-[36px] bg-gradient-to-br from-cream-100 to-cream-50 border border-cream-200/40 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.6)] overflow-hidden">
        {/* Grid backdrop */}
        <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,#ffffff10_1px,transparent_1px),linear-gradient(to_bottom,#ffffff10_1px,transparent_1px)] [background-size:32px_32px]" />

        {/* Centered face glyph + scanning ring */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-44 h-44">
            <motion.div
              aria-hidden
              className="absolute inset-0 rounded-full border-2 border-gold-500/60"
              animate={reduce ? undefined : { scale: [1, 1.12, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              aria-hidden
              className="absolute inset-3 rounded-full border-2 border-gold-400/50"
              animate={reduce ? undefined : { scale: [1, 1.18, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
            />
            <div className="absolute inset-6 rounded-full bg-gold-500/15 border border-gold-500/40 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-16 h-16 text-gold-300" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="11" r="3.2" />
                <path d="M7.4 17.2c1-1.9 2.9-2.9 4.6-2.9s3.6 1 4.6 2.9" />
              </svg>
            </div>
          </div>
        </div>

        {/* Floating "auth result" cards */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="absolute top-6 left-6 right-auto bg-cream-50/90 backdrop-blur-xl border border-cream-200/40 rounded-2xl px-4 py-3 shadow-xl"
        >
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Match score</div>
          <div className="text-lg font-extrabold text-gold-300">99.4%</div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="absolute bottom-6 right-6 bg-cream-50/90 backdrop-blur-xl border border-cream-200/40 rounded-2xl px-4 py-3 shadow-xl"
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-500">Authorized</div>
              <div className="text-sm font-bold text-ink-900">Role: Admin</div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Feature grid ──────────────────────────────────────────────────────────

const FEATURES: { title: string; copy: string; icon: JSX.Element }[] = [
  {
    title: 'Biometric Security',
    copy: 'Face-only sign-in built on dlib embeddings — passwords stop being a liability.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 8V6a1 1 0 0 1 1-1h2M19 8V6a1 1 0 0 0-1-1h-2M5 16v2a1 1 0 0 0 1 1h2M19 16v2a1 1 0 0 1-1 1h-2" />
        <circle cx="12" cy="11" r="3" />
        <path d="M7.5 17c1-1.8 2.8-2.7 4.5-2.7s3.5.9 4.5 2.7" />
      </svg>
    ),
  },
  {
    title: 'Role-Based Access',
    copy: 'Three permission tiers — Admin, Accountant, Marketing — enforced by the backend on every request.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 3v6c0 4.5-3.4 8.4-8 9-4.6-.6-8-4.5-8-9V6l8-3z" />
        <path d="M9.5 12l2 2 3.5-4" />
      </svg>
    ),
  },
  {
    title: 'Liveness Detection',
    copy: 'Multi-angle pose challenges — turn, look up/down, smile — block photo and replay attacks.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h3l2 -6 4 12 2 -8 2 4h5" />
      </svg>
    ),
  },
  {
    title: 'CRM Integration',
    copy: 'Drop-in client records, masked PII per role, REST API ready for your existing stack.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
        <path d="M8.5 6h7M8.5 18h7M6 8.5v7M18 8.5v7" />
      </svg>
    ),
  },
];

function FeatureGrid() {
  const reveal = useReveal();
  return (
    <section id="features" className="border-t border-cream-200/30">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
        <motion.div
          variants={reveal}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.4 }}
          className="text-center max-w-2xl mx-auto"
        >
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Smart Authentication,
            <br />
            <span className="text-ink-500 font-extrabold">Endless Possibilities</span>
          </h2>
          <p className="mt-4 text-ink-500 text-base sm:text-lg leading-relaxed">
            With FaceID Access, you get a hardened identity stack designed to
            scale with your team — not slow it down.
          </p>
        </motion.div>

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              variants={reveal}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              transition={{ delay: i * 0.08 }}
              className="rounded-2xl border border-cream-200/40 bg-cream-100/60 p-6 hover:-translate-y-1 hover:border-gold-500/40 transition-all duration-200"
            >
              <div className="w-11 h-11 rounded-xl bg-gold-500/15 border border-gold-500/30 text-gold-300 flex items-center justify-center mb-4">
                <span className="block w-5 h-5">{f.icon}</span>
              </div>
              <h3 className="font-extrabold tracking-tight text-base">{f.title}</h3>
              <p className="mt-2 text-sm text-ink-500 leading-relaxed">{f.copy}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Stats ─────────────────────────────────────────────────────────────────

function Stats() {
  const reveal = useReveal();
  const items: { value: string; label: string }[] = [
    { value: '< 200ms', label: 'Average match latency' },
    { value: '99.4%', label: 'Match accuracy across poses' },
    { value: '4', label: 'Liveness challenges per signup' },
    { value: '3', label: 'RBAC tiers, fully enforced' },
  ];
  return (
    <section id="stats" className="border-t border-cream-200/30">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28 grid lg:grid-cols-[1fr_1.2fr] gap-10 lg:gap-16 items-center">
        <motion.div
          variants={reveal}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.4 }}
        >
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Built for teams that
            <br />
            ship serious software.
          </h2>
          <p className="mt-4 text-ink-500 text-base sm:text-lg leading-relaxed max-w-md">
            Every protected route runs through a server-side guard. UI hiding
            is purely cosmetic — the backend remains the source of truth.
          </p>
          <ul className="mt-6 space-y-3 text-sm">
            {[
              'Personalised role enforcement',
              'PII masking by capability',
              'Audit-ready event logs',
              'Dependency-free dlib pipeline',
            ].map((line) => (
              <li key={line} className="flex items-center gap-3 text-ink-700">
                <span className="w-5 h-5 rounded-full bg-gold-500/15 border border-gold-500/40 text-gold-300 flex items-center justify-center">
                  <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6.5l3 3 5-6" />
                  </svg>
                </span>
                {line}
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          variants={reveal}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.4 }}
          className="grid grid-cols-2 gap-4 sm:gap-5"
        >
          {items.map((s, i) => (
            <motion.div
              key={s.label}
              variants={reveal}
              transition={{ delay: i * 0.06 }}
              className="rounded-2xl border border-cream-200/40 bg-cream-100/60 p-6"
            >
              <div className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-gradient-to-br from-ink-900 to-gold-300 bg-clip-text text-transparent">
                {s.value}
              </div>
              <div className="mt-1.5 text-xs sm:text-sm text-ink-500">{s.label}</div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─── Closing CTA ──────────────────────────────────────────────────────────

function ClosingCTA() {
  const reveal = useReveal();
  return (
    <section id="about" className="border-t border-cream-200/30">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
        <motion.div
          variants={reveal}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.4 }}
          className="relative overflow-hidden rounded-3xl border border-cream-200/40 bg-gradient-to-br from-cream-100 to-cream-50 p-8 sm:p-14 text-center"
        >
          <div aria-hidden className="absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full bg-gold-500/20 blur-[120px]" />
          <div aria-hidden className="absolute -bottom-24 -left-24 w-[420px] h-[420px] rounded-full bg-gold-400/15 blur-[120px]" />

          <h2 className="relative text-3xl sm:text-4xl font-extrabold tracking-tight">
            Ready to retire the password?
          </h2>
          <p className="relative mt-3 text-ink-500 max-w-xl mx-auto text-base sm:text-lg leading-relaxed">
            Spin up FaceID Access in under five minutes. Sign up creates your
            account; existing operators just log in.
          </p>
          <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/signup"
              className="rounded-2xl bg-gold-500 hover:bg-gold-600 text-ink-900 font-semibold px-6 py-3.5 shadow-lg shadow-gold-500/25 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Create your account
            </Link>
            <Link
              to="/login"
              className="rounded-2xl bg-cream-100 hover:bg-cream-200/40 border border-cream-200/40 text-ink-900 font-medium px-6 py-3.5 transition-colors"
            >
              I already have one
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-cream-200/30">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-ink-500">
        <div className="flex items-center gap-2.5">
          <span className="w-6 h-6 rounded-lg bg-gold-500 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-ink-900" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="11" r="3" />
              <path d="M7.5 17c1-1.8 2.8-2.7 4.5-2.7s3.5.9 4.5 2.7" />
            </svg>
          </span>
          <span className="font-semibold text-ink-700">FaceID Access</span>
          <span>· biometric identity, made simple</span>
        </div>
        <div className="flex items-center gap-5">
          <a href="#features" className="hover:text-ink-900 transition-colors">Features</a>
          <a href="#stats" className="hover:text-ink-900 transition-colors">Pricing</a>
          <a href="#about" className="hover:text-ink-900 transition-colors">About</a>
        </div>
      </div>
    </footer>
  );
}
