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
    note: 'A two-wheel rover with an ESP32 controller board, a motor driver and a distance sensor. You get a 3D model, parts list, wiring, a test drive and starter code.',
    href: '/new',
    cta: 'Start a rover build',
  },
  {
    family: 'Mini RC car',
    status: 'planned',
    label: 'Planned',
    tone: 'warn',
    note: 'Uses the same wheels and motors as the rover. It gets switched on once it has been tested on its own.',
  },
  {
    family: 'Drones and robot arms',
    status: 'unsupported',
    label: 'Coming later',
    tone: 'neutral',
    note: "Rivet can't check flying robots or arms yet.",
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
  { key: 'parts list', tag: 'Parts list', title: 'A parts list you can shop from', body: 'Every line is a real part with a store, a price and a link, or it says plainly that it has none.' },
  { key: 'verification', tag: 'Checks', title: 'Checks before you solder', body: 'Rivet checks power, wiring and fit every time the design changes. Anything serious stays on screen until it is sorted.' },
  { key: 'wiring', tag: 'Wiring', title: 'Wires drawn on the model', body: 'Every wire is drawn on the 3D model and colored by what it carries. When exact pin spots are unknown, wires are placed roughly and labelled that way.' },
  { key: 'firmware', tag: 'Starter code', title: 'Code for the controller board', body: 'Code for the ESP32 board that already knows which pin each wire uses. Download it as a ZIP (a PlatformIO project) and copy it onto the board over USB.' },
  { key: 'simulation', tag: 'Test drive', title: 'Drive it before you build it', body: 'A simple simulation drives the rover on screen so you can watch it stop short of a wall.' },
  { key: 'revisions', tag: 'Changes', title: 'Ask for a change', body: '“Make it cheaper and move the sensor higher.” Rivet saves a new version only if the change passes its checks.' },
] as const;

const FOOTER = [
  { title: 'Product', links: [['Start building', '/new'], ['Your projects', '/projects'], ['See an example', 'example']] },
  { title: 'Builds', links: [['Indoor rover', '/new'], ['Mini RC car (planned)', null], ['Drones and arms (later)', null]] },
  { title: 'Docs', links: [['Read me first', `${REPO_URL}#readme`], ['Developer API', `${REPO_URL}/blob/main/contracts/api.md`], ['Project plan', `${REPO_URL}/blob/main/docs/project.md`]] },
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
              Use AI as your build partner, not a guess. Describe a robot and Rivet turns it into real parts you can
              buy, a 3D model, wiring and starter code you can check step by step.
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
              Everything comes from the same design. Look it over in 3D, or download the parts list, design file
              and starter code and start ordering.
            </p>
          </div>

          <article className="mk-path">
            <div className="mk-path__copy">
              <span className="mk-eyebrow">Review</span>
              <h3 className="mk-h3">See every part, wire and step before you buy.</h3>
              <p className="mk-muted">
                Click any part to see its specs and whether it fits. Spread the parts out, follow each wire and take
                a test drive, all in your browser.
              </p>
              <div className="mk-row">
                <Link href="/new" className="ui-btn ui-btn--primary">
                  Start building
                </Link>
                <ExampleButton className="ui-btn ui-btn--secondary">Open the example</ExampleButton>
              </div>
              <ul className="mk-path__list">
                <li><strong>3D model</strong><span>Spread the parts out and highlight any one</span></li>
                <li><strong>Checks</strong><span>Power, wiring and fit, every time the design changes</span></li>
                <li><strong>Test drive</strong><span>Watch it dodge obstacles before you wire it</span></li>
              </ul>
            </div>
            <div className="mk-path__visual mk-path__visual--pink" aria-hidden="true">
              <div className="mk-mock">
                <div className="mk-mock__bar">
                  {['Review', 'Parts', 'Wiring & code', 'Buy', 'Build'].map((t, i) => (
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
                    {['Status · Needs a look', 'Parts · 11 placed', 'Build · 8 steps', 'Problems · 2 to fix'].map((l) => (
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
                  ['bom.csv', 'Parts list: stores, prices'],
                  ['build.json', 'The whole design'],
                  ['firmware.zip', 'Starter code for the board'],
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
                Download a parts list you can order from, the design file for your own tools, and starter code for
                the ESP32 controller board with every pin already set.
              </p>
              <div className="mk-row">
                <ExampleButton className="ui-btn ui-btn--primary">Try an export</ExampleButton>
                <a href={`${REPO_URL}/blob/main/contracts/api.md`} className="ui-btn ui-btn--secondary">
                  Developer API
                </a>
              </div>
              <ul className="mk-path__list">
                <li><strong>Parts list (CSV)</strong><span>Store links only where Rivet checked them</span></li>
                <li><strong>Design file (build.json)</strong><span>The whole design, with a version number</span></li>
                <li><strong>Starter code (ZIP)</strong><span>Rivet can test-build it for you first</span></li>
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
                  The indoor rover works from start to finish. Other kinds of robot stay marked as planned until they
                  are built and tested.
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
              <p className="mk-proof__label">Real parts in Rivet&apos;s parts catalog</p>
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
              <article key={o.key} className="mk-note">
                <h3>{o.title}</h3>
                <p>{o.body}</p>
                <footer>
                  <span className={`mk-note__dot mk-note__dot--${o.key.replace(/\s+/g, '-')}`} aria-hidden="true" />
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
