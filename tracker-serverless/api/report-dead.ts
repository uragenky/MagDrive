import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../lib/turso';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { topic, folder_id } = req.body || {};

  if (!topic || typeof topic !== 'string' || !/^[a-f0-9]{64}$/i.test(topic)) {
    return res.status(400).json({ error: 'Invalid topic hash: must be 64-character hex string' });
  }

  if (!folder_id || typeof folder_id !== 'string' || !/^[a-zA-Z0-9_-]{10,100}$/.test(folder_id)) {
    return res.status(400).json({ error: 'Invalid folder_id format' });
  }

  try {
    const db = getTursoClient();
    const now = Math.floor(Date.now() / 1000);
    const staleThreshold = now - 3600; // 1 hour ago

    // Anti-griefing: Increment fail_count
    await db.execute({
      sql: `UPDATE swarm_peers 
            SET fail_count = fail_count + 1 
            WHERE topic_hash = ? AND folder_id = ?`,
      args: [topic, folder_id],
    });

    // Delete only if fail_count >= 5 AND it has not been seen in the last hour
    await db.execute({
      sql: `DELETE FROM swarm_peers 
            WHERE topic_hash = ? AND folder_id = ? AND fail_count >= 5 AND last_seen < ?`,
      args: [topic, folder_id, staleThreshold],
    });

    return res.status(200).json({ ok: true, topic, folder_id });
  } catch (err: any) {
    console.error('Tracker report-dead error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
