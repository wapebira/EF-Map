// Utilities to create and resolve short share URLs via Netlify Functions.
// create-share: POST -> { id }
// get-share: GET -> { data }

export async function createShortShare(encoded: string): Promise<string> {
  const res = await fetch('/.netlify/functions/create-share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: encoded })
  });
  if (!res.ok) throw new Error(`Create failed ${res.status}`);
  const json = await res.json();
  if (!json.id) throw new Error('No id returned');
  return json.id as string;
}

export async function fetchShortShare(id: string): Promise<string | null> {
  const res = await fetch(`/.netlify/functions/get-share?id=${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const json = await res.json();
  return json.data as string;
}
