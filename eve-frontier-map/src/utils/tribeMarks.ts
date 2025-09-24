// Tribe Shared Marks API client (ETag + optimistic concurrency)
// Server endpoints:
//  - GET /api/tribe-marks?tribe=<slug|name|id>[&allowPreview=1]
//  - POST /api/tribe-marks/mutate?tribe=...  body { ops:[ ... ] }  headers: { 'If-Match': <etag> }

export interface TribeFolder { id: string; name: string }
export interface TribeItem {
  id: string;
  systemId: number;
  title: string;
  note: string;
  folderId: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  authorHash?: string; // short hash (server-stamped)
  color?: string; // normalized #rrggbb or ''
  verifiedAt?: string | null; // ISO when verified
}

export interface TribeDoc {
  version: number;
  tribe: string; // normalized input
  updatedAt: string; // ISO
  folders: TribeFolder[];
  items: TribeItem[];
}

export type TribeOp =
  | { type: 'add_folder'; id: string; name: string }
  | { type: 'rename_folder'; id: string; name: string }
  | { type: 'delete_folder'; id: string }
  | { type: 'add_item'; id: string; systemId: number; title: string; note: string; folderId?: string | null; color?: string }
  | { type: 'update_item'; id: string; title?: string; note?: string; folderId?: string | null; color?: string }
  | { type: 'remove_item'; id: string }
  | { type: 'move_item'; id: string; folderId: string | null }
  | { type: 'verify_item'; id: string };

export interface TribeFetchOptions { allowPreview?: boolean }

export interface TribeFetchResult { doc: TribeDoc; etag: string }

export class EtagConflictError extends Error {
  latestEtag: string | null;
  constructor(message = 'etag_mismatch', latestEtag: string | null = null) {
    super(message);
    this.name = 'EtagConflictError';
    this.latestEtag = latestEtag;
  }
}

function isPreviewHost() {
  try { return window.location.hostname.endsWith('.pages.dev'); } catch { return false; }
}

function qp(tribe: string, opts?: TribeFetchOptions) {
  const u = new URLSearchParams();
  u.set('tribe', tribe);
  if (opts?.allowPreview && isPreviewHost()) u.set('allowPreview', '1');
  return u.toString();
}

export async function fetchTribeMarks(tribe: string, opts?: TribeFetchOptions): Promise<TribeFetchResult> {
  const resp = await fetch(`/api/tribe-marks?${qp(tribe, opts)}`, { cache: 'no-store' });
  if (!resp.ok) {
    let err: any = null; try { err = await resp.json(); } catch {}
    const msg = err?.error || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  const etag = resp.headers.get('ETag') || '';
  const doc = (await resp.json()) as TribeDoc;
  return { doc, etag };
}

export async function mutateTribeMarks(
  tribe: string,
  ops: TribeOp[],
  etag: string,
  opts?: TribeFetchOptions
): Promise<TribeFetchResult> {
  const resp = await fetch(`/api/tribe-marks/mutate?${qp(tribe, opts)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify({ ops })
  });
  if (resp.status === 409) {
    // ETag mismatch; surface with latest etag if present on response
    const latest = resp.headers.get('ETag');
    throw new EtagConflictError('etag_mismatch', latest);
  }
  if (!resp.ok) {
    let err: any = null; try { err = await resp.json(); } catch {}
    const msg = err?.error || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  const newEtag = resp.headers.get('ETag') || '';
  const doc = (await resp.json()) as TribeDoc;
  return { doc, etag: newEtag };
}

// Helper: retry-once on 409 by refetching latest, then re-attempting the same ops
export async function mutateWithRetry(
  tribe: string,
  ops: TribeOp[],
  etag: string,
  opts?: TribeFetchOptions
): Promise<TribeFetchResult> {
  try {
    return await mutateTribeMarks(tribe, ops, etag, opts);
  } catch (e: any) {
    if (e instanceof EtagConflictError) {
      const fresh = await fetchTribeMarks(tribe, opts);
      // Attempt a single replay with the new etag
      return await mutateTribeMarks(tribe, ops, fresh.etag, opts);
    }
    throw e;
  }
}

// Client-side clamps mirroring server constraints (defensive UX)
export const TRIBE_LIMITS = { items: 300, folders: 100, title: 60, note: 160 } as const;
export function clampTitle(s: string) { return (s || '').trim().slice(0, TRIBE_LIMITS.title); }
export function clampNote(s: string) { return (s || '').trim().slice(0, TRIBE_LIMITS.note); }
