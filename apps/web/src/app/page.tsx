import Link from 'next/link';
import { Logo } from '../components/flow/AppHeader';
import { AssemblyScroll } from '../components/home/AssemblyScroll';
import { ExplodedWorkspace } from '../components/home/ExplodedWorkspace';
import { BlueprintTitle } from '../components/home/BlueprintTitle';
import { Decor } from '../components/home/Decor';
import { HeroParallax } from '../components/home/HeroParallax';
import { PartsTicker } from '../components/home/PartsTicker';
import { CommunityGallery } from '../components/home/CommunityGallery';
import { ShowcaseSamples } from '../components/home/ShowcaseSamples';
import { TeamAvatars } from '../components/home/TeamAvatars';
import { ExampleButton, HeroFlow } from '../components/home/HeroFlow';
import { Icon } from '../components/system/Icon';
import { ThemeToggle } from '../components/system/ThemeToggle';
import '../components/home/marketing.css';

const REPO_URL = 'https://github.com/zhao0524/Rivet';

const HERO_DECOR = [
  { name: 'gear', spot: 'hero-gear' },
  { name: 'washer', spot: 'hero-washer' },
  { name: 'spring', spot: 'hero-spring' },
  { name: 'nut-hex', spot: 'hero-hexnut' },
  { name: 'crystal', spot: 'hero-crystal' },
] as const;

const FOOTER = [
  { title: 'Product', links: [['Start building', '/new'], ['Your projects', '/projects'], ['See an example', 'example']] },
  { title: 'Builds', links: [['Indoor rover', '/new'], ['Mini RC car (planned)', null], ['Drones and arms (later)', null]] },
  { title: 'Docs', links: [['Read me first', `${REPO_URL}#readme`], ['Developer API', `${REPO_URL}/blob/main/contracts/api.md`], ['Project plan', `${REPO_URL}/blob/main/docs/project.md`]] },
  { title: 'Project', links: [['GitHub', REPO_URL], ['SOON Hackathon', null]] },
] as const;

export default function HomePage() {
  return (
    <div data-testid="home-page" className="mk">
      <header className="mk-nav">
        <Logo />
        <nav className="mk-nav__links" aria-label="Main">
          <a href="#how">How it works</a>
          <a href="#community">Community</a>
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
            <div className="mk-pill">
              <TeamAvatars />
              <span>Built at SOON</span>
            </div>
            <BlueprintTitle id="home-title" className="mk-hero__title">
              Anyone can build exceptional hardware anytime.
            </BlueprintTitle>
          </div>

          <HeroFlow />
        </section>

        <div id="how">
          <AssemblyScroll />
        </div>

        <section className="mk-section mk-paths" aria-labelledby="mk-paths-title">
          <div className="mk-paths__head">
            <div>
              <h2 id="mk-paths-title" className="mk-h2">
                We are removing the technical barriers to building hardware.
              </h2>
            </div>
            <p className="mk-muted">
              Tell Rivet what you want to make, in your own words. It picks real parts you can buy, puts them
              together in a 3D model, shows where every wire goes and writes the code that makes the robot move.
              You can check each piece, one step at a time, before you spend anything.
            </p>
          </div>

          <article className="mk-path">
            <div className="mk-path__copy">
              <span className="mk-eyebrow">Review</span>
              <h3 className="mk-h3">See every part, wire and step before you buy.</h3>
              <p className="mk-muted">
                Turn the robot around in 3D and click any part to see what it does and why Rivet picked it. Rivet
                makes sure the battery is strong enough, every wire goes to the right place and all the pieces fit,
                then lets you watch the robot drive around on screen. No hardware know-how needed.
              </p>
              <div className="mk-row">
                <Link href="/new" className="ui-btn ui-btn--primary">
                  Start building
                </Link>
                <ExampleButton className="ui-btn ui-btn--secondary" testId="home-see-example">Open the example</ExampleButton>
              </div>
            </div>
            <div className="mk-path__visual mk-path__visual--pink">
              <ExplodedWorkspace />
            </div>
          </article>

          <article className="mk-path mk-path--flip">
            <div className="mk-path__visual mk-path__visual--violet">
              <PartsTicker />
            </div>
            <div className="mk-path__copy">
              <span className="mk-eyebrow">Export</span>
              <h3 className="mk-h3">Take the build to your bench.</h3>
              <p className="mk-muted">
                When you are happy with it, download what you need to make it for real: a shopping list with stores
                and prices, the full plan, and ready-made code you copy onto the robot&apos;s tiny computer with a USB
                cable. The build steps walk you through putting it together.
              </p>
              <div className="mk-row">
                <ExampleButton className="ui-btn ui-btn--primary">Try an export</ExampleButton>
                <a href={`${REPO_URL}/blob/main/contracts/api.md`} className="ui-btn ui-btn--secondary">
                  Developer API
                </a>
              </div>
              <ul className="mk-path__list">
                <li><strong>Shopping list</strong><span>Real parts, with store links only where Rivet checked them</span></li>
                <li><strong>The full plan</strong><span>Save it to come back later or share it with a friend</span></li>
                <li><strong>Starter code</strong><span>Already matched to your wiring, so you don&apos;t write it from zero</span></li>
              </ul>
            </div>
          </article>
        </section>

        <section id="families" className="mk-section mk-families">
          <div className="mk-showcase mk-dark" aria-labelledby="home-families">
            <div className="mk-showcase__head">
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
            <ShowcaseSamples />
          </div>
        </section>

        <section id="community" className="mk-section mk-community" aria-labelledby="mk-community-title">
          <div className="mk-community__head">
            <div>
              <h2 id="mk-community-title" className="mk-community__title">
                Community
              </h2>
              <p className="mk-community__lede">
                Builds people made with Rivet and published to the gallery. Open one to start your own version.
              </p>
            </div>
            <Link href="/new" className="ui-btn ui-btn--dark" data-testid="home-community-publish">
              Build and publish yours
            </Link>
          </div>
          <CommunityGallery />
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
