-- Migration: Add Ad-Level Monitoring Columns
-- Date: 2026-02-12
-- Description: Extend cpl_logs and alert_logs tables to support ad-level monitoring

-- Add columns to cpl_logs table for ad-level details
ALTER TABLE cpl_logs ADD COLUMN IF NOT EXISTS campaign_name TEXT;
ALTER TABLE cpl_logs ADD COLUMN IF NOT EXISTS adset_name TEXT;
ALTER TABLE cpl_logs ADD COLUMN IF NOT EXISTS ad_name TEXT;
ALTER TABLE cpl_logs ADD COLUMN IF NOT EXISTS ad_meta_id TEXT;

-- Add columns to alert_logs table for ad-level details
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS campaign_name TEXT;
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS adset_name TEXT;
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS ad_name TEXT;
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS ad_meta_id TEXT;

-- Create index on ad_meta_id for faster anti-spam lookups
CREATE INDEX IF NOT EXISTS idx_alert_logs_ad_meta_id ON alert_logs(ad_meta_id);
CREATE INDEX IF NOT EXISTS idx_alert_logs_ad_meta_id_sent_at ON alert_logs(ad_meta_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_cpl_logs_ad_meta_id ON cpl_logs(ad_meta_id);

-- Notes:
-- - Existing columns remain unchanged
-- - New columns are optional (nullable) for backward compatibility
-- - Indexes added for anti-spam checks and ad-level filtering
