require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const supabase = require('./config/supabaseClient');
const { sendTelegramMessage } = require('./utils/telegram');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ message: "AdPulse Backend Running 🚀" });
});

app.get('/test-db', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('agencies')
            .insert([
                { name: "Test Agency", telegram_chat_id: "123456789" }
            ])
            .select();

        if (error) throw error;

        res.json({ message: "Agency inserted successfully", data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/test-telegram', async (req, res) => {
    try {
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (!chatId || chatId === 'your_chat_id') {
            return res.status(400).json({ error: "TELEGRAM_CHAT_ID is missing in .env" });
        }

        await sendTelegramMessage(chatId, "AlertCPL test alert 🚨");
        res.json({ message: "Telegram alert sent successfully!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/update-chat-id', async (req, res) => {
    try {
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (!chatId || chatId === 'your_chat_id') {
            return res.status(400).json({ error: "TELEGRAM_CHAT_ID is missing in .env" });
        }

        // 1. Get the first agency
        const { data: agencies, error: fetchError } = await supabase
            .from('agencies')
            .select('id')
            .limit(1);

        if (fetchError) throw fetchError;
        if (!agencies || !agencies.length) {
            return res.status(404).json({ error: "No agencies found to update." });
        }

        const agencyId = agencies[0].id;

        // 2. Update the agency
        const { data, error: updateError } = await supabase
            .from('agencies')
            .update({ telegram_chat_id: chatId })
            .eq('id', agencyId)
            .select();

        if (updateError) throw updateError;

        res.json({ message: "Agency chat ID updated successfully", data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cron job running every 2 hours: "0 */2 * * *"
cron.schedule('0 */2 * * *', () => {
    console.log(`Running 2-hour AdPulse check: ${new Date().toISOString()}`);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
