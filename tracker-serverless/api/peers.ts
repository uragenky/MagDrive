import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../lib/turso';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { topic } = req.query;

  if (!topic || typeof topic !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid topic query parameter' });
  }

  try {
    const db = getTursoClient();

    // Cache responses at the edge for 30s to mitigate DDoS / high traffic spikes
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

    // Retrieve peers with fail_count < 3, ordered by origin first then most recently seen
    const result = await db.execute({
      sql: `SELECT folder_id, is_origin, last_seen 
            FROM swarm_peers 
            WHERE topic_hash = ? AND fail_count < 3
            ORDER BY is_origin DESC, last_seen DESC
            LIMIT 50`,
      args: [topic],
    });

    const peers = result.rows.map((row) => ({
      folder_id: String(row.folder_id),
      is_origin: Boolean(row.is_origin),
      last_seen: Number(row.last_seen),
    }));

    return res.status(200).json({
      topic,
      peers,
    });
  } catch (err: any) {
    console.error('Tracker peers error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
