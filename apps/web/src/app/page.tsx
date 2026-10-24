import Link from 'next/link';
import { HeroRover } from '../components/home/HeroRover';

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

export default function HomePage() {
  return (
    <div data-testid="home-page" className="rv-home">
      <header className="rv-home__nav">
        <span className="rv-home__wordmark">RIVET</span>
        <Link href="/studio" data-testid="open-studio-link" className="rv-btn">
          Open studio
        </Link>
      </header>

      <main>
        <section className="rv-home__hero" aria-labelledby="home-title">
          <div className="rv-home__copy">
            <h1 id="home-title" className="rv-home__title">
              Turn a picture or an idea into a robot you can actually build.
            </h1>
            <p className="rv-home__lede">
              Rivet designs a rover from real catalog parts and shows you the 3D assembly, parts list,
              wiring and starter firmware.
            </p>
            <div className="rv-home__actions">
              <Link
                href="/studio?start=upload"
                className="rv-btn rv-btn--primary rv-home__action"
                data-testid="home-start-upload"
              >
                Upload an image
              </Link>
              <Link href="/studio?start=describe" className="rv-btn rv-home__action" data-testid="home-start-describe">
                Describe a build
              </Link>
            </div>
            <p className="rv-hint">
              Images are interpreted into a supported build, not reverse-engineered with certainty.
            </p>
          </div>
          <HeroRover />
        </section>

        <section className="rv-home__families" aria-labelledby="home-families">
          <h2 id="home-families" className="rv-label">
            What Rivet can build today
          </h2>
          <ul className="rv-card-grid">
            {PROJECT_FAMILIES.map((f) => (
              <li key={f.family} className="rv-card" data-testid={`family-card-${f.status}`}>
                <span
                  className={`rv-badge rv-badge--${f.tone}`}
                  data-testid={`family-badge-${f.status}`}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {f.label}
                </span>
                <h3 className="rv-card__title">{f.family}</h3>
                <p className="rv-hint">{f.note}</p>
                {'href' in f ? (
                  <Link href={f.href} className="rv-btn" style={{ alignSelf: 'flex-start' }}>
                    {f.cta}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
