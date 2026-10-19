-- Turso (libSQL) Schema for MagDrive Zero-Knowledge Swarm Tracker

CREATE TABLE IF NOT EXISTS swarm_peers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_hash TEXT NOT NULL,
    folder_id TEXT NOT NULL,
    is_origin INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    UNIQUE(topic_hash, folder_id)
);

CREATE INDEX IF NOT EXISTS idx_topic ON swarm_peers(topic_hash);
