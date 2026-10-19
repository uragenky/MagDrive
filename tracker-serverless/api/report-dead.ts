import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../lib/turso';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { topic, folder_id } = req.body || {};

  if (!topic || typeof topic !== 'string' || !folder_id || typeof folder_id !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid topic / folder_id' });
  }

  try {
    const db = getTursoClient();

    // Increment fail_count; if >= 3, purge peer
    await db.execute({
      sql: `UPDATE swarm_peers 
            SET fail_count = fail_count + 1 
            WHERE topic_hash = ? AND folder_id = ?`,
      args: [topic, folder_id],
    });

    await db.execute({
      sql: `DELETE FROM swarm_peers 
            WHERE topic_hash = ? AND folder_id = ? AND fail_count >= 3`,
      args: [topic, folder_id],
    });

    return res.status(200).json({ ok: true, topic, folder_id });
  } catch (err: any) {
    console.error('Tracker report-dead error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
