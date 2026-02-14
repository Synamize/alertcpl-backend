-- Migration: Fix alert_logs missing columns
-- Date: 2026-02-14
-- Description: Ensure all columns required by the backend exist in alert_logs

-- Add agency_id
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id);

-- Add metric columns if they don't exist (using numeric/float for money/counts)
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS spend NUMERIC;
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS leads INTEGER;
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS calculated_cpl NUMERIC;
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS cpl_threshold NUMERIC;
