import { Studio } from '../../components/studio/Studio';
import { isDevModeEnabled, readIntakeStart } from '../../lib/dev-mode';
import { isOfferFixtureName } from '../../lib/offers/fixtures';
import { isResolveOutcome } from '../../lib/resolve/fixtures';

export default function StudioPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const start = readIntakeStart(searchParams);
  const resolve = searchParams?.resolve;
  const resolveOutcome = typeof resolve === 'string' && isResolveOutcome(resolve) ? resolve : null;
  const offers = searchParams?.offers;
  const offersFixture = typeof offers === 'string' && isOfferFixtureName(offers) ? offers : null;
  return (
    <Studio
      devMode={isDevModeEnabled(searchParams)}
      initialIntakeOpen={start !== null}
      initialIntakeFocus={start === 'describe' ? 'prompt' : 'image'}
      initialResolveOutcome={resolveOutcome}
      initialOffersFixture={offersFixture}
    />
  );
}
