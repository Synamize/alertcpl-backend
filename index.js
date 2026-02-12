require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const supabase = require("./config/supabaseClient");
const { sendTelegramMessage } = require("./utils/telegram");
const { fetchAdInsights } = require("./services/metaService");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "AdPulse Backend Running 🚀" });
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "AlertCPL Running" });
});

app.get("/test-telegram", async (req, res) => {
  try {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId || chatId === "your_chat_id") {
      return res
        .status(400)
        .json({ error: "TELEGRAM_CHAT_ID is missing in .env" });
    }

    await sendTelegramMessage(chatId, "AlertCPL test alert 🚨");
    res.json({ message: "Telegram alert sent successfully!" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cron job running every minute for testing: "*/1 * * * *"
// Production: "0 */2 * * *" (every 2 hours)
cron.schedule("*/1 * * * *", async () => {
  console.log(`\n🔥 CPL Alert Engine started: ${new Date().toISOString()}`);

  try {
    // Fetch all active ad accounts
    const { data: accounts, error: accountsError } = await supabase
      .from("ad_accounts")
      .select("*")
      .eq("is_active", true);

    if (accountsError) throw accountsError;

    if (!accounts || accounts.length === 0) {
      return;
    }

    console.log(`✅ Found ${accounts.length} active account(s)`);

    // Process each account
    for (const account of accounts) {
      console.log(
        `\n📈 Checking account: ${account.account_name} (ID: ${account.account_id})`
      );

      // Fetch real spend and leads from Meta API
      const insights = await fetchAdInsights(account.account_id);

      if (!insights) {
        continue;
      }

      const { spend, leads } = insights;

      // Calculate CPL
      const calculatedCpl = spend / leads;

      console.log(
        `   💰 CPL: $${calculatedCpl.toFixed(2)} | Threshold: $${
          account.cpl_threshold
        } | Spend: $${spend.toFixed(2)} | Leads: ${leads}`
      );

      // Step 3: Insert into cpl_logs
      const { error: logError } = await supabase.from("cpl_logs").insert([
        {
          ad_account_id: account.id,
          spend,
          leads,
          calculated_cpl: calculatedCpl,
        },
      ]);

      if (logError) throw logError;

      // Check if CPL exceeds threshold
      if (calculatedCpl > account.cpl_threshold) {
        console.log(
          `   🚨 Alert Threshold Exceeded! CPL ($${calculatedCpl.toFixed(
            2
          )}) > Limit ($${account.cpl_threshold})`
        );

        // Anti-spam check: See if alert was sent in last 2 hours
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const { data: recentAlerts, error: recentAlertsError } = await supabase
          .from("alert_logs")
          .select("id")
          .eq("ad_account_id", account.account_id)
          .eq("alert_type", "CPL_THRESHOLD_EXCEEDED")
          .gte("created_at", twoHoursAgo.toISOString())
          .limit(1);

        if (recentAlertsError) throw recentAlertsError;

        if (recentAlerts && recentAlerts.length > 0) {
          console.log("   ⏸️  Alert skipped (already sent in last 2 hours)");
          continue;
        }

        // Fetch agency details
        const { data: agency, error: agencyError } = await supabase
          .from("agencies")
          .select("name, telegram_chat_id")
          .eq("id", account.agency_id)
          .single();

        if (agencyError) throw agencyError;

        if (!agency || !agency.telegram_chat_id) {
          continue;
        }

        // Send Telegram alert
        const alertMessage = `🚨 AlertCPL Warning!\n\nAccount: ${
          account.account_name
        }\nCPL: $${calculatedCpl.toFixed(2)}\nThreshold: $${
          account.cpl_threshold
        }\nSpend: $${spend}\nLeads: ${leads}`;

        await sendTelegramMessage(agency.telegram_chat_id, alertMessage);
        console.log("   📱 Telegram alert sent");

        // Insert into alert_logs
        const { error: alertError } = await supabase.from("alert_logs").insert([
          {
            ad_account_id: account.id,
            agency_id: account.agency_id,
            alert_type: "CPL_THRESHOLD_EXCEEDED",
            spend,
            leads,
            calculated_cpl: calculatedCpl,
            cpl_threshold: account.cpl_threshold,
          },
        ]);

        if (alertError) throw alertError;
        console.log("   ✅ Alert logged to database");
      }
    }

    console.log(`\n✨ CPL Alert Engine completed: ${new Date().toISOString()}`);
  } catch (error) {
    console.error("❌ Error in CPL Alert Engine:", error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
