import Link from 'next/link';
import { Logo } from '../components/flow/AppHeader';
import { AssemblyScroll } from '../components/home/AssemblyScroll';
import { Decor } from '../components/home/Decor';
import { HeroParallax } from '../components/home/HeroParallax';
import { ExampleButton, HeroFlow } from '../components/home/HeroFlow';
import { Icon } from '../components/system/Icon';
import { ThemeToggle } from '../components/system/ThemeToggle';
import '../components/home/marketing.css';

const REPO_URL = 'https://github.com/RohanGottipati/Rivet';

const PROJECT_FAMILIES = [
  {
    family: 'Indoor rover',
    status: 'supported',
    label: 'Supported',
    tone: 'ok',
    note: 'Two-wheel ESP32 rover with a motor driver and range sensor: 3D assembly, parts list, wiring, simulation and starter firmware.',
    href: '/new',
    cta: 'Start a rover build',
  },
  {
    family: 'Mini RC car',
    status: 'planned',
    label: 'Planned',
    tone: 'warn',
    note: 'Reuses the rover drive. Turned on only once it is independently verified.',
  },
  {
    family: 'Drones and robot arms',
    status: 'unsupported',
    label: 'Coming later',
    tone: 'neutral',
    note: 'Flight and arm verification are outside this version.',
  },
] as const;

const HERO_DECOR = [
  { name: 'gear', spot: 'hero-gear' },
  { name: 'wrench-b', spot: 'hero-wrench' },
  { name: 'nut-cube', spot: 'hero-nut' },
  { name: 'spring', spot: 'hero-spring' },
  { name: 'nut-hex', spot: 'hero-hexnut' },
  { name: 'crystal', spot: 'hero-crystal' },
] as const;

const OUTPUTS = [
  { tag: 'Parts list', title: 'A BOM you can buy from', body: 'Every line is a real catalog part with a vendor, a price and a link, or it says plainly that it has none.' },
  { tag: 'Verification', title: 'Checks before you solder', body: 'Voltage, current, pin and fit checks run on every revision. Blocking findings stay visible until they are resolved.' },
  { tag: 'Wiring', title: 'Wires drawn on the model', body: 'Each connection is routed in 3D and colored by signal, with a schematic fallback when the geometry is approximate.' },
  { tag: 'Firmware', title: 'ESP32 starter code', body: 'A PlatformIO project with the real pin map from your build, exported as a ZIP and optionally compile-checked.' },
  { tag: 'Simulation', title: 'Drive it before you build it', body: 'A differential-drive simulator runs the obstacle behavior so you can watch the rover stop short of a wall.' },
  { tag: 'Revisions', title: 'Ask for a change', body: '“Make it cheaper and move the sensor higher.” Each edit becomes a new revision only if the checks accept it.' },
] as const;

const FOOTER = [
  { title: 'Product', links: [['Start building', '/new'], ['Your projects', '/projects'], ['See an example', 'example']] },
  { title: 'Builds', links: [['Indoor rover', '/new'], ['Mini RC car (planned)', null], ['Drones and arms (later)', null]] },
  { title: 'Docs', links: [['README', `${REPO_URL}#readme`], ['API contract', `${REPO_URL}/blob/main/contracts/api.md`], ['Project spec', `${REPO_URL}/blob/main/docs/project.md`]] },
  { title: 'Project', links: [['GitHub', REPO_URL], ['SOON Hackathon', null]] },
] as const;

const BADGE_CLASS = { ok: 'ui-badge ui-badge--ok', warn: 'ui-badge ui-badge--warn', neutral: 'ui-badge' } as const;

export default function HomePage() {
  return (
    <div data-testid="home-page" className="mk">
      <header className="mk-nav">
        <Logo />
        <nav className="mk-nav__links" aria-label="Main">
          <a href="#how">How it works</a>
          <a href="#outputs">What you get</a>
          <a href="#families">Builds</a>
          <a href={REPO_URL}>Docs</a>
        </nav>
        <div className="mk-nav__actions">
          <Link href="/projects" className="ui-btn ui-btn--ghost ui-btn--sm mk-nav__projects" data-testid="home-nav-projects">
            Projects
          </Link>
          <ThemeToggle />
          <Link href="/new" data-testid="open-studio-link" className="ui-btn ui-btn--primary">
            Start building <Icon name="arrowRight" />
          </Link>
        </div>
      </header>

      <main>
        <section className="mk-hero" aria-labelledby="home-title">
          <Decor items={HERO_DECOR} eager />
          <HeroParallax />

          <div className="mk-hero__copy">
            <p className="mk-pill">
              <span className="mk-pill__dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Built for Rivet
            </p>
            <h1 id="home-title" className="mk-hero__title">
              Hardware designed &amp; built faster with AI
            </h1>
            <p className="mk-hero__lede">
              Use AI as your build partner, not a guess. Describe a robot and Rivet turns it into real catalog
              parts, a 3D assembly, wiring and starter firmware you can review step by step.
            </p>
          </div>

          <HeroFlow />
        </section>

        <div id="how">
          <AssemblyScroll />
        </div>

        <section className="mk-section mk-paths" aria-labelledby="mk-paths-title">
          <div className="mk-paths__head">
            <div>
              <span className="mk-eyebrow">Choose your path</span>
              <h2 id="mk-paths-title" className="mk-h2">
                Review it in the app, or take it to your bench.
              </h2>
            </div>
            <p className="mk-muted">
              Everything starts from the same build plan. Walk the review in 3D, or export the parts list, build
              file and firmware and start ordering.
            </p>
          </div>

          <article className="mk-path">
            <div className="mk-path__copy">
              <span className="mk-eyebrow">Review</span>
              <h3 className="mk-h3">See every part, wire and step before you buy.</h3>
              <p className="mk-muted">
                Click any part for its catalog data and fit checks. Explode the assembly, trace the wiring and run
                the simulator, all in the browser.
              </p>
              <div className="mk-row">
                <Link href="/new" className="ui-btn ui-btn--primary">
                  Start building
                </Link>
                <ExampleButton className="ui-btn ui-btn--secondary">Open the example</ExampleButton>
              </div>
              <ul className="mk-path__list">
                <li><strong>Interactive 3D</strong><span>Explode, isolate and outline any part</span></li>
                <li><strong>Verification</strong><span>Electrical and fit checks on every revision</span></li>
                <li><strong>Simulation</strong><span>Watch the obstacle behavior before you wire it</span></li>
              </ul>
            </div>
            <div className="mk-path__visual mk-path__visual--pink" aria-hidden="true">
              <div className="mk-mock">
                <div className="mk-mock__bar">
                  {['Review', 'Parts', 'Wiring', 'Buy', 'Build'].map((t, i) => (
                    <span key={t} className={i === 0 ? 'is-on' : undefined}>{t}</span>
                  ))}
                </div>
                <div className="mk-mock__body">
                  <div className="mk-mock__scene">
                    <span className="mk-mock__chassis" />
                    <span className="mk-mock__wheel mk-mock__wheel--l" />
                    <span className="mk-mock__wheel mk-mock__wheel--r" />
                    <span className="mk-mock__board" />
                  </div>
                  <div className="mk-mock__side">
                    <b>Build overview</b>
                    {['Status · Needs review', 'Parts · 11 placed', 'Assembly · 8 steps', 'Blocking · 2 findings'].map((l) => (
                      <span key={l}>{l}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </article>

          <article className="mk-path mk-path--flip">
            <div className="mk-path__visual mk-path__visual--violet" aria-hidden="true">
              <div className="mk-files">
                {[
                  ['bom.csv', 'Parts, vendors, prices'],
                  ['build.json', 'The full build plan'],
                  ['firmware.zip', 'PlatformIO, ESP32'],
                ].map(([f, d]) => (
                  <div key={f} className="mk-file">
                    <span className="mk-file__icon" />
                    <span className="mk-file__name">{f}</span>
                    <span className="mk-file__desc">{d}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mk-path__copy">
              <span className="mk-eyebrow">Export</span>
              <h3 className="mk-h3">Take the build to your bench.</h3>
              <p className="mk-muted">
                Download a parts list you can order from, the build file for your own tools, and ESP32 starter
                firmware with the pin map already filled in.
              </p>
              <div className="mk-row">
                <ExampleButton className="ui-btn ui-btn--primary">Try an export</ExampleButton>
                <a href={`${REPO_URL}/blob/main/contracts/api.md`} className="ui-btn ui-btn--secondary">
                  Read the API
                </a>
              </div>
              <ul className="mk-path__list">
                <li><strong>BOM CSV</strong><span>Vendor links only where they are verified</span></li>
                <li><strong>build.json</strong><span>Versioned, schema-checked build plan</span></li>
                <li><strong>Firmware ZIP</strong><span>Optional PlatformIO compile check</span></li>
              </ul>
            </div>
          </article>
        </section>

        <section id="families" className="mk-section">
          <div className="mk-showcase mk-dark" aria-labelledby="home-families">
            <ul className="mk-showcase__grid">
              {PROJECT_FAMILIES.map((f) => (
                <li key={f.family} className="mk-family" data-testid={`family-card-${f.status}`}>
                  <span className={BADGE_CLASS[f.tone]} data-testid={`family-badge-${f.status}`}>
                    {f.label}
                  </span>
                  <h3 className="mk-family__title">{f.family}</h3>
                  <p>{f.note}</p>
                  {'href' in f ? (
                    <Link href={f.href} className="ui-btn ui-btn--secondary">
                      {f.cta}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="mk-showcase__foot">
              <h2 id="home-families" className="mk-showcase__title">
                <span>What Rivet can</span>
                Build today
              </h2>
              <div>
                <p>
                  The indoor rover works end to end. Other families stay labeled planned until they are implemented
                  and verified.
                </p>
                <div className="mk-row">
                  <ExampleButton className="ui-btn ui-btn--primary">Open the example</ExampleButton>
                  <a href={REPO_URL} className="ui-btn ui-btn--ghost">
                    View on GitHub
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="outputs" className="mk-section mk-proof" aria-labelledby="mk-proof-title">
          <div className="mk-proof__head">
            <div className="mk-proof__statwrap">
              <Decor items={[{ name: 'bolt-tee', spot: 'proof-bolt' }]} />
              <p className="mk-proof__stat">19</p>
              <p className="mk-proof__label">Sourced parts behind every build</p>
            </div>
            <div>
              <h2 id="mk-proof-title" className="mk-proof__title">
                Every build comes with the files and checks you need to actually make it.
              </h2>
              <div className="mk-row">
                <Link href="/new" className="ui-btn ui-btn--dark">
                  Start building
                </Link>
                <a href={`${REPO_URL}#readme`} className="ui-btn ui-btn--secondary">
                  Read the docs
                </a>
              </div>
            </div>
          </div>
          <div className="mk-masonry">
            {OUTPUTS.map((o) => (
              <article key={o.tag} className="mk-note">
                <h3>{o.title}</h3>
                <p>{o.body}</p>
                <footer>
                  <span className={`mk-note__dot mk-note__dot--${o.tag.toLowerCase().replace(/\s+/g, '-')}`} aria-hidden="true" />
                  {o.tag}
                </footer>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="mk-footer">
        <div className="mk-footer__cta">
          <Decor
            items={[
              { name: 'bolt', spot: 'cta-bolt' },
              { name: 'nut-hex', spot: 'cta-nut' },
              { name: 'wrench-a', spot: 'cta-wrench' },
            ]}
          />
          <h2 className="mk-footer__title">
            Describe it, review it, <span className="mk-grad">build it for real</span>
          </h2>
          <div className="mk-footer__go">
            <Link href="/new" className="ui-btn ui-btn--primary ui-btn--lg">
              <Icon name="sparkle" /> Start building
            </Link>
            <p>Saved examples open instantly. No key needed.</p>
          </div>
        </div>
        <div className="mk-footer__cols">
          {FOOTER.map((col) => (
            <div key={col.title}>
              <h3>{col.title}</h3>
              <ul>
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    {href === null ? (
                      <span>{label}</span>
                    ) : href === 'example' ? (
                      <ExampleButton>{label}</ExampleButton>
                    ) : href.startsWith('/') ? (
                      <Link href={href}>{label}</Link>
                    ) : (
                      <a href={href}>{label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mk-footer__base">
          <Logo />
          <span>© 2026 Rivet. Built for the SOON Hackathon.</span>
        </div>
      </footer>
    </div>
  );
}
