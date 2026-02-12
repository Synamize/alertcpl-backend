const axios = require("axios");

/**
 * Fetch ad insights from Meta (Facebook) for a specific ad account
 * @param {string} accountId - Ad account ID (without act_ prefix)
 * @returns {Promise<{spend: number, leads: number} | null>} - Spend and leads or null if error
 */
async function fetchAdInsights(accountId) {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!accessToken) {
      console.error("❌ META_ACCESS_TOKEN is not set in .env");
      return null;
    }

    const apiUrl = `https://graph.facebook.com/v24.0/act_${accountId}/insights`;

    const response = await axios.get(apiUrl, {
      params: {
        fields: "spend,actions",
        date_preset: "today",
        access_token: accessToken,
      },
    });

    const data = response.data.data;

    if (!data || data.length === 0) {
      console.warn(`⚠️  No insights data found for account act_${accountId}`);
      return null;
    }

    let spend = 0;
    let leads = 0;

    // Extract spend
    const spendData = data.find((item) => item.spend);
    if (spendData) {
      spend = parseFloat(spendData.spend) || 0;
    }

    // Extract leads from actions
    const actionsData = data.find((item) => item.actions);
    if (actionsData && actionsData.actions) {
      const leadAction = actionsData.actions.find(
        (action) => action.action_type === "lead"
      );
      if (leadAction) {
        leads = parseInt(leadAction.value) || 0;
      }
    }

    return { spend, leads };
  } catch (error) {
    if (error.response && error.response.status === 400) {
      console.warn(
        `⚠️  Invalid account ID or API error for account: ${accountId}`
      );
    } else {
      console.error(
        `❌ Error fetching insights for account ${accountId}:`,
        error.message
      );
    }
    return null;
  }
}

module.exports = { fetchAdInsights };
