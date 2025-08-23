// Simple health check to verify functions deployment.
export async function handler() {
  return { statusCode: 200, body: 'ok' };
}

