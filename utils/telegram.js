
const axios = require('axios');

const sendTelegramMessage = async (chatId, message) => {
    try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
            throw new Error('TELEGRAM_BOT_TOKEN is not defined in environment variables.');
        }

        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

        const response = await axios.post(url, {
            chat_id: chatId,
            text: message
        });

        return response.data;
    } catch (error) {
        console.error('Error sending Telegram message:', error.message);
        throw error;
    }
};

module.exports = { sendTelegramMessage };
