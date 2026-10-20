import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../lib/turso';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { topic, folder_id, is_origin } = req.body || {};

  if (!topic || typeof topic !== 'string' || !/^[a-f0-9]{64}$/i.test(topic)) {
    return res.status(400).json({ error: 'Invalid topic hash: must be 64-character hex string' });
  }

  // Google Drive folder/drive IDs are alphanumeric with dashes/underscores (typically 15-60 chars)
  if (!folder_id || typeof folder_id !== 'string' || !/^[a-zA-Z0-9_-]{10,100}$/.test(folder_id)) {
    return res.status(400).json({ error: 'Invalid folder_id format' });
  }

  try {
    const db = getTursoClient();
    const now = Math.floor(Date.now() / 1000);
    const origin = is_origin ? 1 : 0;

    // Check existing count of peers for this topic to prevent DB bloat (cap at 50 peers per topic)
    const countCheck = await db.execute({
      sql: `SELECT count(*) as total FROM swarm_peers WHERE topic_hash = ?`,
      args: [topic],
    });
    const currentCount = Number(countCheck.rows[0]?.total || 0);

    // If cap reached, allow update only if folder_id is already registered
    if (currentCount >= 50) {
      const existing = await db.execute({
        sql: `SELECT id FROM swarm_peers WHERE topic_hash = ? AND folder_id = ?`,
        args: [topic, folder_id],
      });
      if (existing.rows.length === 0) {
        return res.status(429).json({ error: 'Peer capacity limit reached for this topic' });
      }
    }

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
