import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

// POST /api/create-share  body: { data: string } returns { id }
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const { data, preferId } = body || {};
  if (typeof data !== 'string' || !data.trim()) {
    return new Response('Missing data', { status: 400 });
  }
  // Validate encoded share format roughly (starts with r1|)
  if (!data.startsWith('r1|')) {
    return new Response('Invalid share payload', { status: 400 });
  }
  const store = getStore('shares');
  // ID strategy: optional client-supplied (sanitized) or random short.
  let id = typeof preferId === 'string' ? preferId.slice(0, 16).replace(/[^A-Za-z0-9_-]/g, '') : '';
  if (!id) {
    // Derive from UUID first 8 chars base62
    id = randomUUID().replace(/-/g, '').slice(0, 10);
  }
  // Only write if new; if collision generate another.
  for (let attempts = 0; attempts < 3; attempts++) {
    const { modified } = await store.set(id, data, { onlyIfNew: true });
    if (modified) {
      return Response.json({ id });
    }
    id = randomUUID().replace(/-/g, '').slice(0, 10);
  }
  return new Response('Could not allocate id', { status: 500 });
};
