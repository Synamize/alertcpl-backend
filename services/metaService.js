const axios = require("axios");

/**
 * Fetch active campaign IDs for an ad account
 * @param {string} accountId - Ad account ID
 * @returns {Promise<Array>} - Array of active campaign IDs
 */
async function getActiveCampaignIds(accountId) {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const apiUrl = `https://graph.facebook.com/v24.0/act_${accountId}/campaigns`;

    const response = await axios.get(apiUrl, {
      params: {
        fields: "id,name,effective_status",
        effective_status: '["ACTIVE"]',
        access_token: accessToken,
        limit: 1000 // Ensure we get all campaigns
      },
    });

    const campaigns = response.data.data;

    if (!campaigns || campaigns.length === 0) {
      console.log(`   ℹ️  Found 0 active campaigns`);
      return [];
    }

    const activeIds = campaigns.map(c => c.id);
    console.log(`   ✅ Found ${activeIds.length} active campaigns`);
    if (process.env.NODE_ENV !== "production") {
      campaigns.forEach(c => console.log(`      - ${c.name} (${c.id})`));
    }
    return activeIds;

  } catch (error) {
    console.error(`   ❌ Error fetching campaigns for account ${accountId}:`, error.message);
    return [];
  }
}

/**
 * Fetch ad-level insights from Meta (Facebook) for a specific ad account
 * @param {string} accountId - Ad account ID (without act_ prefix)
 * @param {string} datePreset - Meta API date_preset (e.g., "maximum", "today", "last_7d")
 * @returns {Promise<Array>} - Array of ad insights with campaign, adset, ad details and metrics
 */
async function fetchAdInsights(accountId, datePreset = "maximum") {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!accessToken) {
      console.error("❌ META_ACCESS_TOKEN is not set in .env");
      return null;
    }

    // Step 1: Get Active Campaign IDs first
    const activeCampaignIds = await getActiveCampaignIds(accountId);

    if (activeCampaignIds.length === 0) {
      console.log(`   ⚠️  Skipping account ${accountId} (No active campaigns)`);
      return [];
    }

    // Step 2: Fetch Ad Insights with filtering
    console.log(`   🔄 Fetching insights for ${accountId} (Preset: ${datePreset})`);

    const apiUrl = `https://graph.facebook.com/v24.0/act_${accountId}/insights`;

    // Construct filtering parameter
    const filtering = [
      { field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] },
      { field: "campaign.id", operator: "IN", value: activeCampaignIds }
    ];

    const response = await axios.get(apiUrl, {
      params: {
        level: "ad",
        date_preset: datePreset,
        fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,actions",
        filtering: JSON.stringify(filtering),
        access_token: accessToken,
        limit: 500
      },
    });

    const data = response.data.data;

    if (!data || data.length === 0) {
      console.warn(`   ⚠️  No active ads found in active campaigns`);
      return [];
    }

    // STRICT FILTERING: Ensure ads actually belong to active campaigns
    // (API filtering might under-fetch or behave unexpectedly with mixed statuses)
    const activeCampaignIdsSet = new Set(activeCampaignIds.map(id => String(id)));

    console.log(`   🔍 Debug: Active Campaign IDs:`, activeCampaignIds);

    const validData = data.filter(item => {
      const campaignId = String(item.campaign_id);
      const keeping = activeCampaignIdsSet.has(campaignId);
      if (!keeping) {
        // console.log(`      🗑️ Filtering out ad: ${item.ad_name} (Campaign ID: ${campaignId})`);
      } else {
        // console.log(`      ✅ Keeping ad: ${item.ad_name} (Campaign: ${item.campaign_name})`);
      }
      return keeping;
    });

    const filteredCount = data.length - validData.length;
    if (filteredCount > 0) {
      console.log(`   🧹 Filtered out ${filteredCount} ads from inactive campaigns`);
    }

    if (validData.length === 0) {
      console.warn(`   ⚠️  No ads left after strict campaign filtering`);
      return [];
    }

    console.log(`   📊 Found ${validData.length} ads under active campaigns`);
    if (process.env.NODE_ENV !== "production") {
      validData.forEach(ad => console.log(`      - ${ad.ad_name} (${ad.campaign_name})`));
    }

    // Parse each ad and extract relevant metrics
    const ads = validData.map((item) => {
      let leads = 0;

      // Extract leads from actions
      if (item.actions && Array.isArray(item.actions)) {
        const leadAction = item.actions.find(
          (action) => action.action_type === "lead"
        );
        if (leadAction) {
          leads = parseInt(leadAction.value) || 0;
        }
      }

      return {
        campaign_name: item.campaign_name || "N/A",
        adset_name: item.adset_name || "N/A",
        ad_name: item.ad_name || "N/A",
        ad_id: item.ad_id || null, // Note: Insights API returns ad_id, not id for the ad object
        spend: parseFloat(item.spend) || 0,
        leads: leads,
      };
    });

    return ads;
  } catch (error) {
    if (error.response && error.response.status === 400) {
      console.warn(
        `⚠️  Invalid account ID or API error for account: ${accountId}`,
        JSON.stringify(error.response.data, null, 2)
      );
    } else {
      console.error(
        `❌ Error fetching ad insights for account ${accountId}:`,
        error.message
      );
    }
    return [];
  }
}

/**
 * Fetch generic generic Account Name from Meta
 * @param {string} accountId - Ad account ID
 * @returns {Promise<string|null>} - Account Name or null
 */
async function fetchAccountName(accountId) {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const apiUrl = `https://graph.facebook.com/v24.0/act_${accountId}`;

    const response = await axios.get(apiUrl, {
      params: {
        fields: "name",
        access_token: accessToken,
      },
    });

    return response.data.name || null;
  } catch (error) {
    console.error(`❌ Error fetching name for account ${accountId}:`, error.message);
    return null;
  }
}

module.exports = { fetchAdInsights, fetchAccountName };
