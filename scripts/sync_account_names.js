require("dotenv").config();
const supabase = require("../config/supabaseClient");
const { fetchAccountName } = require("../services/metaService");

async function syncAccountNames() {
    console.log("🔄 Starting Account Name Sync...");

    try {
        // 1. Get all accounts
        const { data: accounts, error } = await supabase.from("ad_accounts").select("*");

        if (error) {
            console.error("❌ Failed to fetch accounts from DB:", error.message);
            return;
        }

        if (!accounts || accounts.length === 0) {
            console.log("ℹ️ No accounts found in DB.");
            return;
        }

        console.log(`📊 Found ${accounts.length} accounts. Checking names...`);

        for (const account of accounts) {
            console.log(`   👉 Processing: ${account.account_name} (${account.account_id})`);

            // Fetch real name
            const realName = await fetchAccountName(account.account_id);

            if (realName) {
                if (realName !== account.account_name) {
                    console.log(`      ✅ Found real name: "${realName}". Updating DB...`);

                    const { error: updateError } = await supabase
                        .from("ad_accounts")
                        .update({ account_name: realName })
                        .eq("id", account.id);

                    if (updateError) {
                        console.error(`      ❌ Update failed: ${updateError.message}`);
                    } else {
                        console.log(`      ✨ Updated successfully!`);
                    }
                } else {
                    console.log(`      ok Name matches.`);
                }
            } else {
                console.warn(`      ⚠️ Could not fetch name for ${account.account_id}`);
            }
        }

        console.log("\n✅ Sync Complete.");

    } catch (err) {
        console.error("❌ Unexpected error:", err);
    }
}

syncAccountNames();
