import { getStore } from '@netlify/blobs';

// GET /.netlify/functions/get-share?id=ID  returns { data }
export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response('Missing id', { status: 400 });
  const store = getStore('shares');
  const value = await store.get(id);
  if (value === null) return new Response('Not found', { status: 404 });
  return Response.json({ data: value });
};
