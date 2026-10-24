import { Studio } from '../../components/studio/Studio';
import { isDevModeEnabled, readIntakeStart } from '../../lib/dev-mode';

export default function StudioPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const start = readIntakeStart(searchParams);
  return (
    <Studio
      devMode={isDevModeEnabled(searchParams)}
      initialIntakeOpen={start !== null}
      initialIntakeFocus={start === 'describe' ? 'prompt' : 'image'}
    />
  );
}
