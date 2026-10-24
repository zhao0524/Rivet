import { Studio } from '../../components/studio/Studio';
import { isDevModeEnabled, readIntakePrompt, readIntakeStart } from '../../lib/dev-mode';
import { isResolveOutcome } from '../../lib/resolve/fixtures';

export default function StudioPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const start = readIntakeStart(searchParams);
  const resolve = searchParams?.resolve;
  const resolveOutcome = typeof resolve === 'string' && isResolveOutcome(resolve) ? resolve : null;
  return (
    <Studio
      devMode={isDevModeEnabled(searchParams)}
      initialIntakeOpen={start !== null}
      initialIntakeFocus={start === 'describe' ? 'prompt' : 'image'}
      initialIntakePrompt={readIntakePrompt(searchParams)}
      initialResolveOutcome={resolveOutcome}
    />
  );
}
