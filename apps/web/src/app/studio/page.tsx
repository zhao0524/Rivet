import { redirect } from 'next/navigation';

/** The old single-screen studio is replaced by the step-by-step flow. Old links keep working. */
export default function StudioRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const prompt = searchParams?.prompt;
  const text = Array.isArray(prompt) ? prompt[0] : prompt;
  redirect(text ? `/new?prompt=${encodeURIComponent(text.slice(0, 2000))}` : '/projects');
}
