require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectLogs() {
    console.log("🔍 Inspetcing latest CPL Logs...");

    const { data, error } = await supabase
        .from("cpl_logs")
        .select("campaign_name, ad_name, checked_at")
        .order("checked_at", { ascending: false })
        .limit(50);

    if (error) {
        console.error("❌ Error:", error.message);
        return;
    }

    console.table(data);

    if (data.length > 0) {
        const latestRaw = data[0].checked_at;
        const latestTime = new Date(latestRaw).getTime();
        console.log("\nLatest Timestamp:", latestRaw, `(${latestTime})`);

        const cutoff = latestTime - (5 * 60 * 1000);
        console.log("Cutoff Time (5m ago):", new Date(cutoff).toISOString(), `(${cutoff})`);

        console.log("\n--- Analysis ---");
        data.forEach(log => {
            const logTime = new Date(log.checked_at).getTime();
            const isFresh = logTime > cutoff;
            const status = isFresh ? "✅ FRESH" : "❌ STALE";
            console.log(`[${status}] ${log.checked_at} - ${log.campaign_name}`);
        });
    }
}

inspectLogs();
