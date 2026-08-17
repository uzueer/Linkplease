CREATE TABLE IF NOT EXISTS duplicate_blocks (
    id BIGSERIAL PRIMARY KEY,
    delivery_id BIGINT,
    rule_id UUID,
    user_id VARCHAR(255),
    event_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- index to speed up counts
CREATE INDEX IF NOT EXISTS idx_duplicate_blocks_created_at ON duplicate_blocks(created_at);
