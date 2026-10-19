import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../lib/turso';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { topic, folder_id, is_origin } = req.body || {};

  if (!topic || typeof topic !== 'string' || !folder_id || typeof folder_id !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid topic / folder_id' });
  }

  try {
    const db = getTursoClient();
    const now = Math.floor(Date.now() / 1000);
    const origin = is_origin ? 1 : 0;

    await db.execute({
      sql: `INSERT INTO swarm_peers (topic_hash, folder_id, is_origin, fail_count, created_at, last_seen)
            VALUES (?, ?, ?, 0, ?, ?)
            ON CONFLICT(topic_hash, folder_id) DO UPDATE SET
              last_seen = ?,
              fail_count = 0`,
      args: [topic, folder_id, origin, now, now, now],
    });

    return res.status(200).json({ ok: true, topic, folder_id });
  } catch (err: any) {
    console.error('Tracker announce error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
