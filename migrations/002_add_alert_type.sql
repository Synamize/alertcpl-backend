-- Migration: Add alert_type column to alert_logs
-- Date: 2026-02-14
-- Description: Add alert_type column which was missing but used in the code

ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS alert_type TEXT;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_alert_logs_alert_type ON alert_logs(alert_type);
