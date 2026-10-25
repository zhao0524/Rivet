import { DesignStart } from '../../../components/studio/generation/DesignStart';

export default function DesignPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const prompt = searchParams?.prompt;
  return <DesignStart initialText={(Array.isArray(prompt) ? prompt[0] : prompt)?.slice(0, 2000) ?? ''} />;
}
