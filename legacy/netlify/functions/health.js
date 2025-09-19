// Simple health check to verify functions deployment.
// Phase 2: expose shadow read metrics (process lifetime, non-persistent) when env flag enabled.
export async function handler() {
  let body = { status: 'ok' };
  const shadowFlag = (process.env.CF_SHADOW_READ_ENABLE || '').toLowerCase() === 'true';
  if(shadowFlag){
    try {
      // Dynamic import to avoid cost if unused.
      const { getShadowMetrics } = await import('./_store.js');
      body.shadow = getShadowMetrics();
    } catch {/* ignore */}
  }
  return { statusCode: 200, body: JSON.stringify(body) };
}

// Redeploy trigger comment: verifying Blobs env vars are now active.

