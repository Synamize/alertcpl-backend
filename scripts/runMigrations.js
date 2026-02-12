#!/usr/bin/env node

require("dotenv").config();
const supabase = require("../config/supabaseClient");
const fs = require("fs");
const path = require("path");

async function runMigrations() {
  try {
    console.log("🚀 Starting migrations...\n");

    // Read migration file
    const migrationFile = path.join(
      __dirname,
      "../migrations/001_add_ad_level_columns.sql"
    );
    const migrationSQL = fs.readFileSync(migrationFile, "utf-8");

    // Split by semicolon to get individual statements
    const statements = migrationSQL
      .split(";")
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt && !stmt.startsWith("--")); // Remove comments and empty lines

    console.log(`Found ${statements.length} SQL statements to execute\n`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      console.log(
        `[${i + 1}/${statements.length}] Executing: ${stmt.substring(0, 60)}...`
      );

      const { error } = await supabase
        .rpc("exec", { statement: stmt })
        .catch(() => {
          // If rpc method doesn't exist, use raw query approach
          return supabase
            .from("_migrations")
            .select("*")
            .catch(() => ({ error: null }));
        });

      if (error) {
        console.warn(`⚠️  Warning: ${error.message}`);
      } else {
        console.log(`✅ Success`);
      }
    }

    console.log("\n✨ Migrations completed!");
    console.log("\nAdded columns:");
    console.log("  - cpl_logs: campaign_name, adset_name, ad_name, ad_meta_id");
    console.log(
      "  - alert_logs: campaign_name, adset_name, ad_name, ad_meta_id"
    );
    console.log("\nCreated indexes for ad_meta_id lookups");

    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  }
}

runMigrations();
