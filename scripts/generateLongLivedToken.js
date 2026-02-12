require("dotenv").config();
const axios = require("axios");

/**
 * Convert a short-lived Meta access token to a long-lived token
 * Requires: META_APP_ID, META_APP_SECRET, META_SHORT_LIVED_TOKEN in .env
 */
async function generateLongLivedToken() {
  try {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const shortLivedToken = process.env.META_SHORT_LIVED_TOKEN;

    // Validate that all required credentials are present
    if (!appId) {
      throw new Error("META_APP_ID is missing in .env");
    }
    if (!appSecret) {
      throw new Error("META_APP_SECRET is missing in .env");
    }
    if (!shortLivedToken) {
      throw new Error("META_SHORT_LIVED_TOKEN is missing in .env");
    }

    console.log("🔐 Exchanging short-lived token for long-lived token...\n");

    // Make API request to exchange token
    const response = await axios.get(
      "https://graph.facebook.com/v24.0/oauth/access_token",
      {
        params: {
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortLivedToken,
        },
      }
    );

    const { access_token, expires_in } = response.data;

    if (!access_token) {
      throw new Error("No access token returned from Meta API");
    }

    console.log("✅ SUCCESS! Long-Lived Token Generated\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`\n📌 Long Lived Token:\n${access_token}\n`);
    console.log(
      `⏰ Expires In: ${expires_in} seconds (${Math.floor(
        expires_in / 86400
      )} days)\n`
    );
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("📋 Next Steps:");
    console.log("1. Copy the token above");
    console.log("2. In .env, replace META_ACCESS_TOKEN with this new token");
    console.log("3. Remove META_SHORT_LIVED_TOKEN from .env");
    console.log(
      "4. Remove META_APP_ID and META_APP_SECRET from .env (optional for production)"
    );
    console.log("5. Restart the backend: npm start");
    console.log("6. Test: npm run test:meta-api\n");
  } catch (error) {
    console.error("\n❌ ERROR: Token generation failed\n");

    if (error.response && error.response.data) {
      const errorData = error.response.data;
      console.error(
        `Meta API Error: ${errorData.error?.message || errorData.message}`
      );
    } else {
      console.error(`Error: ${error.message}`);
    }

    console.error("\n💡 Troubleshooting:");
    console.error("   - Verify all .env variables are set correctly");
    console.error(
      "   - Check that META_APP_ID and META_APP_SECRET match your Meta app"
    );
    console.error("   - Ensure META_SHORT_LIVED_TOKEN is still valid");
    console.error("   - Verify your app has the 'ads_management' permission\n");

    process.exit(1);
  }
}

// Run the function
generateLongLivedToken();
