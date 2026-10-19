import { createClient } from '@libsql/client';

export function getTursoClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error('Missing TURSO_DATABASE_URL in environment');
  }

  return createClient({
    url,
    authToken,
  });
}
