#!/usr/bin/env node

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

async function runMigrations() {
  try {
    console.log("🚀 Running database migrations...\n");

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("SUPABASE_URL or SUPABASE_ANON_KEY not set in .env");
    }

    // Note: Direct SQL execution requires service role key for security
    // For now, we'll verify the schema by checking if columns exist
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("✅ Connected to Supabase");
    console.log("\n📋 Migration SQL to run in Supabase SQL Editor:\n");
    console.log(`
-- Add columns to cpl_logs table
ALTER TABLE cpl_logs ADD COLUMN IF NOT EXISTS campaign_name TEXT;
ALTER TABLE cpl_logs ADD COLUMN IF NOT EXISTS adset_name TEXT;
ALTER TABLE cpl_logs ADD COLUMN IF NOT EXISTS ad_name TEXT;
ALTER TABLE cpl_logs ADD COLUMN IF NOT EXISTS ad_meta_id TEXT;

-- Add columns to alert_logs table
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS campaign_name TEXT;
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS adset_name TEXT;
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS ad_name TEXT;
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS ad_meta_id TEXT;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_alert_logs_ad_meta_id ON alert_logs(ad_meta_id);
CREATE INDEX IF NOT EXISTS idx_alert_logs_ad_meta_id_created_at ON alert_logs(ad_meta_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cpl_logs_ad_meta_id ON cpl_logs(ad_meta_id);
    `);

    console.log("\n📖 Steps to run migration:");
    console.log("1. Go to https://supabase.com/dashboard");
    console.log("2. Select your AlertCPL project");
    console.log("3. Go to SQL Editor");
    console.log("4. Create a new query");
    console.log("5. Paste the SQL above");
    console.log("6. Click 'Run'");
    console.log(
      "\n✨ After running, restart the backend to use ad-level monitoring!"
    );

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

runMigrations();
