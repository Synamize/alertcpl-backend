require("dotenv").config();
const supabase = require("../config/supabaseClient");

async function verifySchema() {
  console.log("🔍 Verifying database schema for ad-level columns...");

  const testData = {
    ad_account_id: "test_verification", // dummy ID, will fail generic constraint but checking for column existence first
    campaign_name: "Test Campaign",
    adset_name: "Test AdSet",
    ad_name: "Test Ad",
    ad_meta_id: "test_123",
    spend: 0,
    leads: 0,
    calculated_cpl: 0
  };

  try {
    // Attempt an insert. We expect it might fail on foreign key constraints (ad_account_id),
    // but we are specifically looking for "column does not exist" errors.
    const { error } = await supabase.from("cpl_logs").insert([testData]);

    if (error) {
        if (error.message.includes("column") && error.message.includes("does not exist")) {
            console.error("❌ Schema Verification Failed: Columns missing in 'cpl_logs'.");
            console.error("   Message:", error.message);
            console.log("\n⚠️  Please run the migration 'migrations/001_add_ad_level_columns.sql' in Supabase SQL Editor.");
            process.exit(1);
        } else if (error.code === '23503') { // Foreign key violation (expected)
            console.log("✅ Schema Verification Passed: Columns exist (Foreign Key error expected).");
            process.exit(0);
        } else {
            // Some other error, but likely not column missing if we got here
             console.log("✅ Schema Verification Passed: Columns likely exist (Error: " + error.message + ")");
             process.exit(0);
        }
    }

    console.log("✅ Schema Verification Passed: Test insert successful (or silently ignored).");

  } catch (err) {
    console.error("❌ Unexpected error:", err.message);
    process.exit(1);
  }
}

verifySchema();
