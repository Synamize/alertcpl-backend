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

// API Routes for Dashboard

// Get all ad accounts
app.get("/api/accounts", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("ad_accounts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get latest CPL logs
app.get("/api/cpl-logs", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const accountId = req.query.account_id;

    let query = supabase
      .from("cpl_logs")
      .select("*")
      .order("checked_at", { ascending: false })
      .limit(limit);

    if (accountId) {
      query = query.eq("ad_account_id", accountId);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get alert logs
app.get("/api/alerts", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const accountId = req.query.account_id;

    let query = supabase
      .from("alert_logs")
      .select("*")
      .order("sent_at", { ascending: false })
      .limit(limit);

    if (accountId) {
      query = query.eq("ad_account_id", accountId);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data || []);
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

      // Fetch ad-level data from Meta API
      const ads = await fetchAdInsights(account.account_id);

      if (!ads || ads.length === 0) {
        console.log(`   ⚠️  No ads found for account`);
        continue;
      }

      console.log(`   📊 Found ${ads.length} active ad(s)`);

      // Process each ad
      for (const ad of ads) {
        const { campaign_name, adset_name, ad_name, ad_id, spend, leads } = ad;

        // Skip ads with no spend or leads
        if (spend === 0 || leads === 0) {
          continue;
        }

        // Calculate CPL per ad
        const calculatedCpl = spend / leads;

        console.log(
          `     💰 Ad: ${ad_name} | CPL: $${calculatedCpl.toFixed(
            2
          )} | Spend: $${spend.toFixed(2)} | Leads: ${leads}`
        );

        // Insert into cpl_logs with ad details
        const { error: logError } = await supabase.from("cpl_logs").insert([
          {
            ad_account_id: account.id,
            campaign_name,
            adset_name,
            ad_name,
            ad_meta_id: ad_id,
            spend,
            leads,
            calculated_cpl: calculatedCpl,
          },
        ]);

        if (logError) {
          console.error("❌ Error inserting CPL log:", logError.message);
          continue;
        }

        // Check if CPL exceeds threshold
        if (calculatedCpl > account.cpl_threshold) {
          console.log(
            `     🚨 Alert! CPL ($${calculatedCpl.toFixed(2)}) > Threshold ($${
              account.cpl_threshold
            })`
          );

          // Anti-spam check: Look for alerts for this specific ad in last 2 hours
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
          const { data: recentAlerts, error: recentAlertsError } =
            await supabase
              .from("alert_logs")
              .select("id")
              .eq("ad_meta_id", ad_id)
              .eq("alert_type", "CPL_THRESHOLD_EXCEEDED")
              .gte("created_at", twoHoursAgo.toISOString())
              .limit(1);

          if (recentAlertsError) {
            console.error(
              "❌ Error checking recent alerts:",
              recentAlertsError.message
            );
            continue;
          }

          if (recentAlerts && recentAlerts.length > 0) {
            console.log(
              "     ⏸️  Alert skipped (already sent in last 2 hours)"
            );
            continue;
          }

          // Fetch agency details
          const { data: agency, error: agencyError } = await supabase
            .from("agencies")
            .select("name, telegram_chat_id")
            .eq("id", account.agency_id)
            .single();

          if (agencyError) {
            console.error("❌ Error fetching agency:", agencyError.message);
            continue;
          }

          if (!agency || !agency.telegram_chat_id) {
            console.log("     ⚠️  Agency not found or missing Telegram ID");
            continue;
          }

          // Send Telegram alert with ad details
          const alertMessage = `🚨 AlertCPL Warning!\n\nCampaign: ${campaign_name}\nAd Set: ${adset_name}\nAd: ${ad_name}\n\nCPL: $${calculatedCpl.toFixed(
            2
          )}\nThreshold: $${account.cpl_threshold}\nSpend: $${spend.toFixed(
            2
          )}\nLeads: ${leads}`;

          await sendTelegramMessage(agency.telegram_chat_id, alertMessage);
          console.log("     📱 Telegram alert sent");

          // Insert into alert_logs with ad details
          const { error: alertError } = await supabase
            .from("alert_logs")
            .insert([
              {
                ad_account_id: account.id,
                agency_id: account.agency_id,
                alert_type: "CPL_THRESHOLD_EXCEEDED",
                ad_meta_id: ad_id,
                campaign_name,
                adset_name,
                ad_name,
                spend,
                leads,
                calculated_cpl: calculatedCpl,
                cpl_threshold: account.cpl_threshold,
              },
            ]);

          if (alertError) {
            console.error("❌ Error inserting alert log:", alertError.message);
            continue;
          }

          console.log("     ✅ Alert logged to database");
        }
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
