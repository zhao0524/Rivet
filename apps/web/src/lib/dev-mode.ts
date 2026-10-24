/**
 * Developer UI gate (#54). Developer controls (data source switch, render stats, raw build ids)
 * are hidden unless the page is opened with `?dev=1` or `NEXT_PUBLIC_RIVET_DEV_UI=true` is set.
 */

export type SearchParamsLike =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

export const DEV_QUERY_PARAM = 'dev';

function readParam(params: SearchParamsLike, key: string): string | undefined {
  if (!params) return undefined;
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function isDevModeEnabled(params?: SearchParamsLike): boolean {
  if (process.env.NEXT_PUBLIC_RIVET_DEV_UI === 'true') return true;
  const value = readParam(params, DEV_QUERY_PARAM);
  return value === '1' || value === 'true';
}

export type IntakeStart = 'upload' | 'describe';

/** `/studio?start=upload|describe` opens the intake with that input focused (landing page links). */
export function readIntakeStart(params?: SearchParamsLike): IntakeStart | null {
  const value = readParam(params, 'start');
  return value === 'upload' || value === 'describe' ? value : null;
}
