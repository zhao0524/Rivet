import { DesignStart } from '../../../components/studio/generation/DesignStart';

type Params = Record<string, string | string[] | undefined>;

function first(params: Params | undefined, key: string): string | undefined {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] : value;
}

export default function DesignPage({ searchParams }: { searchParams?: Params }) {
  return (
    <DesignStart
      initialText={first(searchParams, 'prompt')?.slice(0, 2000) ?? ''}
      initialImageAssetId={first(searchParams, 'ref') ?? null}
      initialMode={first(searchParams, 'mode') === 'engineered' ? 'engineered' : 'concept_only'}
      autoStart={first(searchParams, 'auto') === '1'}
    />
  );
}
