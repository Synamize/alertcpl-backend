const axios = require('axios');

async function testThresholdUpdate() {
    const accountId = "1431395567675793"; // Your main account ID
    const newThreshold = 45; // Test value

    try {
        console.log(`Testing PATCH /api/accounts/${accountId}/threshold...`);

        const response = await axios.patch(`http://localhost:5000/api/accounts/${accountId}/threshold`, {
            newThreshold: newThreshold
        });

        console.log("Response:", response.data);

        if (response.data.success && response.data.newThreshold === newThreshold) {
            console.log("✅ TEST PASSED: Threshold updated.");
        } else {
            console.error("❌ TEST FAILED: Unexpected response.");
        }

    } catch (error) {
        console.error("❌ TEST FAILED:", error.response ? error.response.data : error.message);
    }
}

testThresholdUpdate();
