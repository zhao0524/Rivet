import Link from 'next/link';
import { AssemblyScroll } from '../components/home/AssemblyScroll';
import { HeroPrompt } from '../components/home/HeroPrompt';
import '../components/home/marketing.css';

const REPO_URL = 'https://github.com/RohanGottipati/Rivet';

const PROJECT_FAMILIES = [
  {
    family: 'Indoor rover',
    status: 'supported',
    label: 'Supported',
    tone: 'ok',
    note: 'Two-wheel ESP32 rover with a motor driver and range sensor: 3D assembly, parts list, wiring, simulation and starter firmware.',
    href: '/studio',
    cta: 'Open the example',
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

/** Floating part tiles around the hero, from the sourced seed catalog. */
const HERO_PARTS = [
  { side: 'left', name: 'ESP32-DevKitC V4', kind: 'Controller', tone: 'violet', cursor: 'Interpret' },
  { side: 'left', name: 'TB6612 motor driver', kind: 'Driver', tone: 'pink' },
  { side: 'left', name: 'SparkFun Shadow Chassis', kind: 'Chassis', tone: 'ink' },
  { side: 'right', name: 'TT gearbox motor 1:90', kind: 'Motor', tone: 'orange', cursor: 'Verify' },
  { side: 'right', name: 'VL53L0X ToF sensor', kind: 'Sensor', tone: 'cyan' },
  { side: 'right', name: '3 x AA holder, 2.1 mm', kind: 'Power', tone: 'lime' },
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
  { title: 'Product', links: [['Studio', '/studio'], ['New build', '/studio?start=describe'], ['Upload an image', '/studio?start=upload'], ['Product match', '/studio?resolve=exact_match']] },
  { title: 'Builds', links: [['Indoor rover', '/studio'], ['Mini RC car (planned)', null], ['Drones and arms (later)', null]] },
  { title: 'Docs', links: [['README', `${REPO_URL}#readme`], ['API contract', `${REPO_URL}/blob/main/contracts/api.md`], ['Project spec', `${REPO_URL}/blob/main/docs/project.md`]] },
  { title: 'Project', links: [['GitHub', REPO_URL], ['SOON Hackathon', null]] },
] as const;

export default function HomePage() {
  return (
    <div data-testid="home-page" className="mk">
      <header className="mk-nav">
        <Link href="/" className="mk-logo" aria-label="Rivet home">
          <span className="mk-logo__mark" aria-hidden="true" />
          Rivet
        </Link>
        <nav className="mk-nav__links" aria-label="Main">
          <a href="#how">How it works</a>
          <a href="#outputs">What you get</a>
          <a href="#families">Builds</a>
          <a href={REPO_URL}>Docs</a>
        </nav>
        <div className="mk-nav__actions">
          <Link href="/studio?start=describe" className="mk-btn mk-btn--dark">
            Start building
          </Link>
          <Link href="/studio" data-testid="open-studio-link" className="mk-btn mk-btn--accent">
            Open studio <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>

      <main>
        <section className="mk-hero" aria-labelledby="home-title">
          {(['left', 'right'] as const).map((side) => (
            <div key={side} className={`mk-hero__float mk-hero__float--${side}`} aria-hidden="true">
              {HERO_PARTS.filter((p) => p.side === side).map((p) => (
                <div key={p.name} className={`mk-part mk-part--${p.tone}`}>
                  <span className="mk-part__kind">{p.kind}</span>
                  <span className="mk-part__name">{p.name}</span>
                  {'cursor' in p ? <span className="mk-cursor">{p.cursor}</span> : null}
                </div>
              ))}
            </div>
          ))}

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
              Use AI as your build partner, not a guess. Describe a robot or upload a picture and Rivet
              turns it into real catalog parts, a 3D assembly, wiring and starter firmware.
            </p>
          </div>

          <HeroPrompt />
        </section>

        <div id="how">
          <AssemblyScroll />
        </div>

        <section className="mk-section mk-paths" aria-labelledby="mk-paths-title">
          <div className="mk-paths__head">
            <div>
              <span className="mk-eyebrow">Choose your path</span>
              <h2 id="mk-paths-title" className="mk-h2">
                Inspect it in the studio, or take it to your bench.
              </h2>
            </div>
            <p className="mk-muted">
              Everything starts from the same build plan. Explore the rover in 3D, or export the parts
              list, build file and firmware and start ordering.
            </p>
          </div>

          <article className="mk-path">
            <div className="mk-path__copy">
              <span className="mk-eyebrow mk-eyebrow--plain">Studio</span>
              <h3 className="mk-h3">See every part, wire and step before you buy.</h3>
              <p className="mk-muted">
                Click any part for its SKU, price and fit checks. Explode the assembly, trace the
                wiring and run the simulator, all in the browser.
              </p>
              <div className="mk-row">
                <Link href="/studio" className="mk-btn mk-btn--accent">
                  Open the studio
                </Link>
                <Link href="/studio?start=describe" className="mk-btn mk-btn--ghost">
                  New build
                </Link>
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
                  {['Design', 'Inspect', 'Wiring', 'Assemble', 'Simulate'].map((t, i) => (
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
            <div className="mk-path__visual mk-path__visual--cyan" aria-hidden="true">
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
              <span className="mk-eyebrow mk-eyebrow--plain">Export</span>
              <h3 className="mk-h3">Take the build to your bench.</h3>
              <p className="mk-muted">
                Download a parts list you can order from, the build file for your own tools, and ESP32
                starter firmware with the pin map already filled in.
              </p>
              <div className="mk-row">
                <Link href="/studio" className="mk-btn mk-btn--accent">
                  Try an export
                </Link>
                <a href={`${REPO_URL}/blob/main/contracts/api.md`} className="mk-btn mk-btn--ghost">
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
          <div className="mk-showcase" aria-labelledby="home-families">
            <ul className="mk-showcase__grid">
              {PROJECT_FAMILIES.map((f) => (
                <li key={f.family} className="mk-family" data-testid={`family-card-${f.status}`}>
                  <span className={`mk-badge mk-badge--${f.tone}`} data-testid={`family-badge-${f.status}`}>
                    {f.label}
                  </span>
                  <h3 className="mk-family__title">{f.family}</h3>
                  <p>{f.note}</p>
                  {'href' in f ? (
                    <Link href={f.href} className="mk-btn mk-btn--light">
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
                  The indoor rover works end to end. Other families stay labeled planned until they are
                  implemented and verified.
                </p>
                <div className="mk-row">
                  <Link href="/studio" className="mk-btn mk-btn--light">
                    Open the example
                  </Link>
                  <a href={REPO_URL} className="mk-btn mk-btn--outline-light">
                    View on GitHub
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="outputs" className="mk-section mk-proof" aria-labelledby="mk-proof-title">
          <div className="mk-proof__head">
            <div>
              <span className="mk-proof__icon" aria-hidden="true" />
              <p className="mk-proof__stat">19</p>
              <p className="mk-proof__label">Sourced parts behind every build</p>
            </div>
            <div>
              <h2 id="mk-proof-title" className="mk-proof__title">
                Every build comes with the files and checks you need to actually make it.
              </h2>
              <div className="mk-row">
                <Link href="/studio" className="mk-btn mk-btn--dark">
                  Open the studio
                </Link>
                <a href={`${REPO_URL}#readme`} className="mk-btn mk-btn--ghost">
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
                  <span className={`mk-note__dot mk-note__dot--${o.tag.toLowerCase()}`} aria-hidden="true" />
                  {o.tag}
                </footer>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="mk-footer">
        <div className="mk-footer__cta">
          <h2 className="mk-footer__title">
            Experience the power of our <span className="mk-grad">AI hardware studio</span> today
          </h2>
          <div className="mk-footer__go">
            <Link href="/studio?start=describe" className="mk-btn mk-btn--accent mk-btn--lg">
              <span aria-hidden="true">✦</span> Try the studio
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
          <span className="mk-logo">
            <span className="mk-logo__mark" aria-hidden="true" />
            Rivet
          </span>
          <span>© 2026 Rivet. Built for the SOON Hackathon.</span>
        </div>
      </footer>
    </div>
  );
}
