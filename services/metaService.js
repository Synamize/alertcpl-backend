const axios = require("axios");

/**
 * Fetch ad-level insights from Meta (Facebook) for a specific ad account
 * @param {string} accountId - Ad account ID (without act_ prefix)
 * @returns {Promise<Array>} - Array of ad insights with campaign, adset, ad details and metrics
 */
async function fetchAdInsights(accountId) {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!accessToken) {
      console.error("❌ META_ACCESS_TOKEN is not set in .env");
      return null;
    }

    const apiUrl = `https://graph.facebook.com/v24.0/act_${accountId}/ads`;

    const response = await axios.get(apiUrl, {
      params: {
        level: "ad",
        fields: "campaign_name,adset_name,ad_name,id,spend,actions",
        date_preset: "today",
        access_token: accessToken,
      },
    });

    const data = response.data.data;

    if (!data || data.length === 0) {
      console.warn(`⚠️  No ad data found for account act_${accountId}`);
      return [];
    }

    // Parse each ad and extract relevant metrics
    const ads = data.map((item) => {
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
        ad_id: item.id || null,
        spend: parseFloat(item.spend) || 0,
        leads: leads,
      };
    });

    return ads;
  } catch (error) {
    if (error.response && error.response.status === 400) {
      console.warn(
        `⚠️  Invalid account ID or API error for account: ${accountId}`
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

module.exports = { fetchAdInsights };
