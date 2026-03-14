const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// Your token here
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8591157732:AAGFyJdDG-mRcokzXXA-08xikiC24y2RK28';

const app = express();
const bot = new TelegramBot(TOKEN, { polling: true });

console.log('🤖 ‎ᶻᵉⁿᶦⁿ☯︎ ₲₳₦₲₴₮ɆⱤ☠︎ Bot is running!');

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, '👋 Bot is live 24/7!');
});

bot.on('message', (msg) => {
    if (!msg.text?.startsWith('/')) {
        bot.sendMessage(msg.chat.id, `Echo: ${msg.text}`);
    }
});

// Health check endpoint (required for Render)
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        bot: '‎ᶻᵉⁿᶦⁿ☯︎ ₲₳₦₲₴₮ɆⱤ☠︎',
        timestamp: new Date()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
});
