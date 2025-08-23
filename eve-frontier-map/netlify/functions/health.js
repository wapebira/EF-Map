// Simple health check to verify functions deployment.
export async function handler() {
  return { statusCode: 200, body: 'ok' };
}

// Redeploy trigger comment: verifying Blobs env vars are now active.

