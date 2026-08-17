CREATE TABLE IF NOT EXISTS rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword VARCHAR(255) NOT NULL,
    dm_message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL UNIQUE,
    event_type VARCHAR(100) NOT NULL,
    comment_id VARCHAR(255),
    post_id VARCHAR(255),
    user_id VARCHAR(255),
    username VARCHAR(255),
    text TEXT,
    created_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS deliveries (
    id BIGSERIAL PRIMARY KEY,
    rule_id UUID NOT NULL REFERENCES rules(id),
    user_id VARCHAR(255) NOT NULL,
    comment_id VARCHAR(255),
    dm_id VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_rule_user UNIQUE (rule_id, user_id)
);