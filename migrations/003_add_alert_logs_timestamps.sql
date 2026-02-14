-- Migration: Add timestamp columns to alert_logs
-- Date: 2026-02-14
-- Description: Add created_at and sent_at columns to alert_logs table prevents errors in anti-spam check and API sort

ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- Index for anti-spam performance
CREATE INDEX IF NOT EXISTS idx_alert_logs_created_at ON alert_logs(created_at);
