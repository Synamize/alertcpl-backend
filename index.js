require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const supabase = require("./config/supabaseClient");
const { sendTelegramMessage } = require("./utils/telegram");
const { fetchAdInsights, fetchAccountName } = require("./services/metaService");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "AdPulse Backend Running 🚀" });
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Track last sync time
let lastSyncTime = new Date();

app.get("/api/system/status", (req, res) => {
  const timeAgo = lastSyncTime ? Math.floor((new Date() - lastSyncTime) / 60000) : 0;
  const timeUnit = timeAgo === 1 ? "min" : "mins";

  res.json({
    last_sync: `${timeAgo} ${timeUnit} ago`,
    meta_status: process.env.META_ACCESS_TOKEN ? "Connected" : "Disconnected",
    telegram_status: process.env.TELEGRAM_BOT_TOKEN ? "Active" : "Inactive",
    frequency: "Every 15 mins" // Verify this matches cron
  });
});

// Get current user/agency profile (simulated auth)
app.get("/api/me", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("agencies")
      .select("name, id")
      .limit(1)
      .single();

    if (error) throw error;

    res.json(data || { name: "Guest Agency" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

// Helper to resolve generic ID (Meta ID) to UUID
async function resolveAccountUuid(idInput) {
  // If valid UUID (approximate check), return as is
  if (idInput.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return idInput;
  }

  // Otherwise, assume it's a Meta Account ID and lookup UUID
  const { data } = await supabase
    .from("ad_accounts")
    .select("id")
    .eq("account_id", idInput)
    .single();

  return data ? data.id : null;
}

// API Routes for Dashboard

// Get dashboard summary metrics
app.get("/api/dashboard/summary", async (req, res) => {
  try {
    // 1. Total Active Accounts
    const { count: totalAccounts, error: accountsError } = await supabase
      .from("ad_accounts")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    if (accountsError) throw accountsError;

    // 2. Critical Alerts & Accounts at Risk (Last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: recentAlerts, error: alertsError } = await supabase
      .from("alert_logs")
      // Inner join to ensure we only count alerts from ACTIVE accounts
      .select("alert_type, ad_account_id, ad_accounts!inner(is_active)")
      .eq("ad_accounts.is_active", true)
      .gte("created_at", oneDayAgo);

    if (alertsError) throw alertsError;

    // Count Critical Alerts (ZERO_LEADS)
    const criticalAlertsCount = recentAlerts.filter(a => a.alert_type === "ZERO_LEADS").length;

    // Count Accounts at Risk (Unique accounts with ANY alert)
    const uniqueAtRisk = new Set(recentAlerts.map(a => a.ad_account_id));
    const accountsAtRiskCount = uniqueAtRisk.size;

    res.json({
      total_accounts: totalAccounts || 0,
      critical_alerts: criticalAlertsCount || 0,
      accounts_at_risk: accountsAtRiskCount || 0
    });

  } catch (error) {
    console.error("❌ Error fetching summary:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get urgent alerts (Critical/Warning in last 6h)
app.get("/api/dashboard/urgent-alerts", async (req, res) => {
  try {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    const { data: alerts, error } = await supabase
      .from("alert_logs")
      .select(`
        id,
        alert_type,
        campaign_name,
        adset_name,
        ad_name,
        created_at,
        ad_accounts!inner(account_name, is_active)
      `)
      .eq("ad_accounts.is_active", true)
      .gte("created_at", sixHoursAgo)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Filter duplicates: Keep only the latest alert per ad + alert_type
    const uniqueAlertsMap = new Map();

    alerts.forEach(alert => {
      // Create a unique key for the "issue"
      // Use ad_name or campaign_name depending on granularity. 
      // Using ad_name + alert_type ensures we see distinct issues but not repeated logs of the same one.
      const key = `${alert.ad_name}-${alert.alert_type}`;

      if (!uniqueAlertsMap.has(key)) {
        uniqueAlertsMap.set(key, alert);
      }
    });

    const uniqueAlerts = Array.from(uniqueAlertsMap.values());

    const formattedAlerts = uniqueAlerts.map(alert => {
      let severity = "WARNING";
      let issueType = "High CPL";

      if (alert.alert_type === "ZERO_LEADS") {
        severity = "CRITICAL";
        issueType = "Zero Leads (High Spend)";
      } else if (alert.alert_type === "HIGH_CPL") {
        severity = "WARNING";
        issueType = "CPL Spike";
      }

      return {
        id: alert.id,
        severity,
        account_name: alert.ad_accounts.account_name,
        campaign_name: alert.campaign_name,
        issue_type: issueType,
        created_at: alert.created_at
      };
    });

    res.json(formattedAlerts);

  } catch (error) {
    console.error("❌ Error fetching urgent alerts:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get account health overview
app.get("/api/dashboard/account-health", async (req, res) => {
  try {
    // 1. Get Active Accounts
    const { data: accounts, error: accError } = await supabase
      .from("ad_accounts")
      .select("*")
      .eq("is_active", true);

    if (accError) throw accError;

    // 2. Get Alerts count per account (Last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: alerts, error: alertError } = await supabase
      .from("alert_logs")
      .select("ad_account_id, alert_type")
      .gte("created_at", oneDayAgo);

    if (alertError) throw alertError;

    const alertCounts = {};
    alerts.forEach(a => {
      if (!alertCounts[a.ad_account_id]) alertCounts[a.ad_account_id] = 0;
      alertCounts[a.ad_account_id]++;
    });

    // 3. Fetch Insights from Meta for each account (Today & 7d)
    const { fetchAdInsights } = require("./services/metaService");

    // We process sequentially or in limited parallel to avoid rate limits
    const healthData = [];

    for (const acc of accounts) {
      try {
        // Parallel fetch for Today and 7d
        const [todayInsights, sevenDayInsights] = await Promise.all([
          fetchAdInsights(acc.ad_account_id, "today"),
          fetchAdInsights(acc.ad_account_id, "last_7d")
        ]);

        // Aggregation Helper
        const aggregate = (insights) => {
          if (!insights) return { spend: 0, leads: 0, cpl: 0 };
          const spend = insights.reduce((sum, item) => sum + item.spend, 0);
          const leads = insights.reduce((sum, item) => sum + item.leads, 0);
          const cpl = leads > 0 ? spend / leads : 0;
          return { spend, leads, cpl };
        };

        const today = aggregate(todayInsights);
        const sevenDay = aggregate(sevenDayInsights);
        const activeAlerts = alertCounts[acc.id] || 0;

        // Health Score Logic (Simple heuristic)
        // Base: 100
        // -10 per active alert
        // -20 if Today CPL > Account CPL Threshold (if leads > 0)
        let healthScore = 100;
        healthScore -= (activeAlerts * 10);

        let status = "HEALTHY"; // Green

        if (acc.cpl_threshold && today.leads > 0 && today.cpl > acc.cpl_threshold) {
          healthScore -= 20;
          // If CPL is double the threshold, it's critical
          if (today.cpl > acc.cpl_threshold * 1.5) {
            status = "CRITICAL";
          } else {
            status = "WATCH";
          }
        }

        if (activeAlerts > 0) status = "WATCH";
        if (activeAlerts >= 3) status = "CRITICAL";

        // Clamp score
        healthScore = Math.max(0, Math.min(100, healthScore));

        if (status === "CRITICAL") healthScore = Math.min(healthScore, 60);

        healthData.push({
          id: acc.id,
          account_name: acc.account_name,
          health_score: healthScore,
          active_alerts: activeAlerts,
          spend_today: parseFloat(today.spend.toFixed(2)),
          leads_today: today.leads,
          avg_cpl_today: parseFloat(today.cpl.toFixed(2)),
          avg_cpl_7d: parseFloat(sevenDay.cpl.toFixed(2)),
          status
        });

      } catch (err) {
        console.error(`Error processing health for account ${acc.account_name}:`, err.message);
        // Push error state or skip
        healthData.push({
          id: acc.id,
          account_name: acc.account_name,
          health_score: 0,
          active_alerts: 0,
          spend_today: 0,
          leads_today: 0,
          avg_cpl_today: 0,
          avg_cpl_7d: 0,
          status: "UNKNOWN"
        });
      }
    }

    // Sort: Critical first, then by score asc
    healthData.sort((a, b) => {
      const statusOrder = { "CRITICAL": 0, "WATCH": 1, "HEALTHY": 2, "UNKNOWN": 3 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return a.health_score - b.health_score;
    });

    res.json(healthData);

  } catch (error) {
    console.error("❌ Error fetching account health:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get all ad accounts
app.get("/api/accounts", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("ad_accounts")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new ad account
app.post("/api/accounts", async (req, res) => {
  try {
    const { name, ad_account_id, cpl_threshold } = req.body;
    const platform = "meta";

    // Validation
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Invalid or missing 'name'" });
    }
    if (!ad_account_id || typeof ad_account_id !== "string") {
      return res.status(400).json({ error: "Invalid or missing 'ad_account_id'" });
    }
    if (!cpl_threshold || typeof cpl_threshold !== "number" || cpl_threshold <= 0) {
      return res.status(400).json({ error: "Invalid 'cpl_threshold'. Must be > 0." });
    }

    // 🔹 Validate with Meta Graph API
    console.log(`🔍 Validating access for account: ${ad_account_id}...`);
    const metaAccountName = await fetchAccountName(ad_account_id);

    if (!metaAccountName) {
      console.warn(`⚠️ Validation failed for account ${ad_account_id}: Not found or no access.`);
      return res.status(400).json({
        error: "Account not linked to your Meta account. Please check the ID and your permissions."
      });
    }
    console.log(`✅ Meta validation successful. Account Name: ${metaAccountName}`);

    // 🔹 Fetch first agency
    const { data: agency, error: agencyError } = await supabase
      .from("agencies")
      .select("id")
      .limit(1)
      .single();

    if (agencyError || !agency) {
      console.warn("⚠️ No agency found when creating account.");
      return res.status(400).json({
        error: "No agency found. Please create an agency first."
      });
    }

    // Insert into DB
    const { data, error } = await supabase
      .from("ad_accounts")
      .insert([
        {
          account_name: name,
          account_id: ad_account_id,
          cpl_threshold: cpl_threshold,
          is_active: true,
          platform,
          agency_id: agency.id
        }
      ])
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Created new account: ${name} (${ad_account_id}) linked to Agency ${agency.id}`);

    res.status(201).json({
      success: true,
      account: data,
      message: "Ad account created successfully"
    });

  } catch (error) {
    // Unique constraint violation (e.g. account_id already exists)
    if (error.code === '23505') {
      return res.status(409).json({ error: "Account ID already exists." });
    }
    console.error("❌ Error creating account:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get latest CPL logs
app.get("/api/cpl-logs", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    let accountId = req.query.account_id || req.query.accountId; // Support both

    let finalUuid = null;
    if (accountId) {
      finalUuid = await resolveAccountUuid(accountId);
      if (!finalUuid) {
        return res.json([]);
      }
    }

    let query = supabase
      .from("cpl_logs")
      .select("*, ad_accounts!inner(is_active)")
      .eq("ad_accounts.is_active", true)
      .order("checked_at", { ascending: false })
      .limit(limit);

    if (finalUuid) {
      query = query.eq("ad_account_id", finalUuid);
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
    let accountId = req.query.account_id || req.query.accountId;

    let finalUuid = null;
    if (accountId) {
      finalUuid = await resolveAccountUuid(accountId);
      if (!finalUuid) return res.json([]);
    }

    let query = supabase
      .from("alert_logs")
      .select("*, ad_accounts!inner(is_active)")
      .eq("ad_accounts.is_active", true)
      .order("sent_at", { ascending: false })
      .limit(limit);

    if (finalUuid) {
      query = query.eq("ad_account_id", finalUuid);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update CPL Threshold for an account
app.patch("/api/accounts/:id/threshold", async (req, res) => {
  try {
    const accountId = req.params.id; // Expecting ad_account_id (Meta ID)
    const { newThreshold } = req.body;

    if (!newThreshold || typeof newThreshold !== "number" || newThreshold <= 0) {
      return res.status(400).json({
        error: "Invalid threshold. Must be a positive number."
      });
    }

    // Update in Supabase
    // Use 'account_id' (Meta ID) which matches the route param for external IDs
    const { data, error } = await supabase
      .from("ad_accounts")
      .update({ cpl_threshold: newThreshold })
      .eq("account_id", accountId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      // Trying fallback: maybe the ID passed is the internal UUID?
      // Let's try updating by 'id' if 'ad_account_id' failed to find rows
      // actually, let's just return 404 for now to keep it simple.
      return res.status(404).json({ error: "Account not found" });
    }

    console.log(`✅ Threshold updated for account ${accountId} → ${newThreshold}`);

    res.json({
      success: true,
      newThreshold,
      message: "Threshold updated successfully"
    });

  } catch (error) {
    console.error("❌ Error updating threshold:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update Account Name and Threshold
app.patch("/api/accounts/:id", async (req, res) => {
  try {
    const accountId = req.params.id; // Expecting ad_account_id (Meta ID)
    const { name, cpl_threshold } = req.body;

    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "Invalid name." });
    }

    if (!cpl_threshold || typeof cpl_threshold !== "number" || cpl_threshold <= 0) {
      return res.status(400).json({
        error: "Invalid threshold. Must be a positive number."
      });
    }

    // Update in Supabase
    const { data, error } = await supabase
      .from("ad_accounts")
      .update({
        account_name: name,
        cpl_threshold: cpl_threshold
      })
      .eq("account_id", accountId)
      .select()
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: "Account not found" });
    }

    console.log(`✅ Account updated: ${name} (Threshold: ${cpl_threshold})`);

    res.json({
      success: true,
      updatedAccount: data,
      message: "Account updated successfully"
    });

  } catch (error) {
    console.error("❌ Error updating account:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Soft Delete Account
app.delete("/api/accounts/:id", async (req, res) => {
  try {
    const accountId = req.params.id; // Expecting ad_account_id (Meta ID)

    // Soft delete: is_active = false
    const { error } = await supabase
      .from("ad_accounts")
      .update({ is_active: false })
      .eq("account_id", accountId);

    if (error) throw error;

    console.log(`🗑️ Account soft deleted: ${accountId}`);

    res.json({
      success: true,
      message: "Account deleted successfully"
    });

  } catch (error) {
    console.error("❌ Error deleting account:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cron job running every 15 minutes
let isJobRunning = false;

// Core Alert Engine Logic
async function runAlertEngine() {
  if (isJobRunning) {
    console.log("⚠️ CPL Alert Engine skipped (Previous job still running)");
    return { success: false, message: "Job already running" };
  }

  isJobRunning = true;
  lastSyncTime = new Date();

  // Log based on trigger method (Cron or Manual) - simplified for shared logic
  console.log(`\n🔥 CPL Alert Engine started: ${new Date().toISOString()}`);

  try {
    // Fetch all active ad accounts
    const { data: accounts, error: accountsError } = await supabase
      .from("ad_accounts")
      .select("*")
      .eq("is_active", true);

    if (accountsError) throw accountsError;

    if (!accounts || accounts.length === 0) {
      isJobRunning = false;
      return { success: true, message: "No active accounts found" };
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

        // Skip ads with no spend
        if (spend === 0) {
          continue;
        }

        let alertType = null;
        let calculatedCpl = 0;

        // CHECK 1: Zero Leads Logic
        if (leads === 0) {
          if (spend >= account.cpl_threshold) {
            alertType = "ZERO_LEADS";
            console.log(`\n     🔹 Campaign: ${campaign_name}`);
            console.log(`     🔸 Ad Set: ${adset_name}`);
            console.log(
              `     📄 Ad: ${ad_name} | Spend: $${spend.toFixed(2)} | Leads: 0`
            );
            console.log(`     🚨 Zero Leads Alert Triggered! Spend > Threshold ($${account.cpl_threshold})`);
          }
        }
        // CHECK 2: High CPL Logic
        else {
          calculatedCpl = spend / leads;

          console.log(`\n     🔹 Campaign: ${campaign_name}`);
          console.log(`     🔸 Ad Set: ${adset_name}`);
          console.log(
            `     📄 Ad: ${ad_name} | CPL: $${calculatedCpl.toFixed(
              2
            )} | Spend: $${spend.toFixed(2)} | Leads: ${leads}`
          );

          // Insert into cpl_logs (only if leads > 0 to have valid CPL)
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
          }

          if (calculatedCpl > account.cpl_threshold) {
            alertType = "HIGH_CPL";
            console.log(
              `     🚨 High CPL Alert Triggered! CPL ($${calculatedCpl.toFixed(2)}) > Threshold ($${account.cpl_threshold
              })`
            );
          }
        }

        // Logic for sending alert (Common for both types)
        if (alertType) {
          // Anti-spam check: Look for alerts for this specific ad AND alert_type in last 2 hours
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

          const { data: recentAlerts, error: recentAlertsError } =
            await supabase
              .from("alert_logs")
              .select("id")
              .eq("ad_meta_id", ad_id)
              .eq("alert_type", alertType)
              .eq("ad_account_id", account.id)
              .gte("created_at", twoHoursAgo.toISOString())
              .limit(1);

          if (recentAlertsError) {
            console.error("❌ Error checking recent alerts:", recentAlertsError.message);
            continue;
          }

          if (recentAlerts && recentAlerts.length > 0) {
            console.log("     ⏸️ Alert skipped (duplicate within 2h)");
            continue;
          }

          // Insert into alert_logs FIRST to prevent duplicates/spam if Telegram fails
          const { error: alertError } = await supabase
            .from("alert_logs")
            .insert([
              {
                ad_account_id: account.id,
                agency_id: account.agency_id,
                alert_type: alertType,
                ad_meta_id: ad_id,
                campaign_name,
                adset_name,
                ad_name,
                spend,
                leads,
                calculated_cpl: calculatedCpl || 0, // Fallback to 0 for Zero Leads
                cpl_threshold: account.cpl_threshold,
                message: "", // Will update with actual message later if needed, or constructed below
              },
            ]);

          if (alertError) {
            console.error("❌ Error inserting alert log:", alertError.message);
            continue; // Skip sending telegram if we can't log it
          }

          console.log("     ✅ Alert logged to database (locking)");

          // Fetch agency details
          const { data: agency, error: agencyError } = await supabase
            .from("agencies")
            .select("name, telegram_chat_id")
            .eq("id", account.agency_id)
            .single();

          if (agencyError || !agency || !agency.telegram_chat_id) {
            console.log("     ⚠️  Agency not found or missing Telegram ID");
            continue;
          }

          // HTML Escape Helper
          const escapeHtml = (str) => String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

          const escCampaign = escapeHtml(campaign_name);
          const escAdSet = escapeHtml(adset_name);
          const escAd = escapeHtml(ad_name);
          const escAccount = escapeHtml(account.account_name);

          // Construct Message based on Alert Type
          let alertMessage = "";

          // Common Header
          const header = `🚨 <b>AlertCPL Warning!</b> 🚨\n\n` +
            `🏢 <b>Ad Account:</b> ${escAccount}\n\n`;

          const body = `📂 <b>Campaign:</b> ${escCampaign}\n` +
            `📑 <b>Ad Set:</b> ${escAdSet}\n` +
            `📄 <b>Ad:</b> ${escAd}\n\n`;

          if (alertType === "ZERO_LEADS") {
            alertMessage = header + body +
              `💰 <b>CPL:</b> N/A (Zero Leads)\n` +
              `⚠️ <b>Threshold:</b> $${account.cpl_threshold}\n` +
              `💸 <b>Spend:</b> $${spend.toFixed(2)}\n` +
              `🎯 <b>Leads:</b> 0\n\n` +
              `Critical: Ad spend > threshold with 0 leads.`;
          } else {
            // High CPL
            alertMessage = header + body +
              `💰 <b>CPL:</b> $${calculatedCpl.toFixed(2)}\n` +
              `⚠️ <b>Threshold:</b> $${account.cpl_threshold}\n` +
              `💸 <b>Spend:</b> $${spend.toFixed(2)}\n` +
              `🎯 <b>Leads:</b> ${leads}`;
          }

          // Update the log with the actual message (optional but good for history)
          // We don't await this to speed up, or we can.
          await supabase.from("alert_logs")
            .update({ message: alertMessage })
            .eq("ad_meta_id", ad_id)
            .eq("alert_type", alertType)
            .eq("ad_account_id", account.id)
            .order("created_at", { ascending: false })
            .limit(1);


          try {
            await sendTelegramMessage(agency.telegram_chat_id, alertMessage);
            console.log(`     📱 Telegram alert sent (${alertType})`);
          } catch (teleError) {
            console.error(`     ❌ Failed to send Telegram: ${teleError.message}`);
            // check if it's 400 Bad Request (formatting), we might want to know.
          }
        }
      }
    }

    console.log(`\n✨ CPL Alert Engine completed: ${new Date().toISOString()}`);
    return { success: true, message: "Alert engine cycle completed" };

  } catch (error) {
    console.error("❌ Error in CPL Alert Engine:", error.message);
    return { success: false, message: error.message };
  } finally {
    isJobRunning = false;
  }
}

// Secure Manual Trigger Endpoint (Production External Cron)
app.post("/run-alert-engine", async (req, res) => {
  const authHeader = req.headers["x-cron-secret"];
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("❌ CRON_SECRET not defined in environment");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  if (authHeader !== secret) {
    console.warn("⚠️ Unauthorized attempt to trigger alert engine");
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log("🚀 Manual/External trigger for Alert Engine received");

  // Run logic
  const result = await runAlertEngine();

  res.status(200).send("OK");
});

// Internal Cron Job (Disable in Production)
if (process.env.NODE_ENV !== "production") {
  cron.schedule("0 * * * *", async () => {
    console.log("⏰ Internal cron triggered (Non-Production)", new Date().toISOString());
    await runAlertEngine();
  });
  console.log("🕒 Internal cron enabled (Non-Production)");
} else {
  console.log("🚫 Internal cron disabled (Production Mode)");
}

app.listen(PORT, () => {
  console.log("🚀 AlertCPL Production Mode Enabled");
  console.log(`🚀 AlertCPL Production Server running on port ${PORT}`);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});
