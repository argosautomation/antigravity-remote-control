const TelegramBot = require('node-telegram-bot-api');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config ──
const BRIDGE_FILE = path.join(os.homedir(), '.antigravity', 'telegram_bridge.json');
const SETTINGS_PATH = path.join(os.homedir(), '.config', 'Antigravity', 'User', 'settings.json');

let botToken = '';
let chatId = '';

// Read from bridge config first
try {
    if (fs.existsSync(BRIDGE_FILE)) {
        const bridge = JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8'));
        botToken = bridge.bot_token || '';
        chatId = bridge.chat_id || '';
    }
} catch (e) {
    console.error("Error reading bridge config:", e.message);
}

// Override with Antigravity settings if available
try {
    if (fs.existsSync(SETTINGS_PATH)) {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
        botToken = settings['antigravityTelegram.botToken'] || botToken;
        chatId = settings['antigravityTelegram.chatId'] || chatId;
    }
} catch (e) {
    console.error("Error reading settings:", e.message);
}

if (!botToken) {
    console.error("No bot token found. Set it via the extension panel or telegram_bridge.json.");
    process.exit(1);
}

// ── Detect correct DISPLAY (handles Wayland/Xwayland where DISPLAY may not be :0) ──
let DISPLAY = process.env.DISPLAY || ':0';
try {
    const pid = execSync('pgrep -x gnome-shell', { encoding: 'utf8' }).trim().split('\n')[0];
    const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
    for (const entry of env.split('\0')) {
        if (entry.startsWith('DISPLAY=')) {
            DISPLAY = entry.split('=')[1];
            break;
        }
    }
} catch (e) {
    // Not on GNOME or can't read process env - fall back to env var or :0
}

console.log(`Standalone Telegram Bot started (DISPLAY=${DISPLAY}, chatId=${chatId || 'any'})`);

// ── Start Bot ──
const bot = new TelegramBot(botToken, { polling: true });

bot.on('message', async (msg) => {
    const text = msg.text;
    const fromChatId = msg.chat.id;

    if (chatId && fromChatId.toString() !== chatId.toString()) {
        console.log(`Unauthorized message from chat: ${fromChatId}`);
        return;
    }

    if (!text) return;

    if (text === '/stop') {
        // Force stop: simulate Escape to abort AI generation
        exec(`DISPLAY=${DISPLAY} xdotool key Escape Escape`, () => {
            bot.sendMessage(fromChatId, "🛑 Stop signal sent to IDE.");
        });
    } else if (text === '/screen' || text === '/screenshot') {
        takeScreenshot(fromChatId, text === '/screenshot');
    } else if (text === '/status') {
        bot.sendMessage(fromChatId, "✅ Bridge daemon is running.\n" +
            `🖥️ DISPLAY: ${DISPLAY}\n` +
            `📍 PID: ${process.pid}`);
    } else if (!text.startsWith('/')) {
        // Forward prompt to Antigravity via bridge file
        try {
            let existing = {};
            try { existing = JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8')); } catch (e) { }
            const payload = {
                ...existing,
                prompt: text,
                timestamp: Date.now()
            };
            fs.writeFileSync(BRIDGE_FILE, JSON.stringify(payload, null, 2));
            bot.sendMessage(fromChatId, "⏳ Prompt sent to Antigravity...");
        } catch (err) {
            bot.sendMessage(fromChatId, "❌ Error forwarding prompt: " + err.message);
        }
    }
});

function takeScreenshot(targetId, fullScreen = true) {
    const tmpPath = path.join(os.tmpdir(), `screen_${Date.now()}.png`);

    // Try scrot first (reliable with Xwayland), then gnome-screenshot as fallback
    const cmd = fullScreen
        ? `DISPLAY=${DISPLAY} scrot "${tmpPath}" 2>/dev/null || DISPLAY=${DISPLAY} DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus gnome-screenshot -f "${tmpPath}" 2>/dev/null`
        : `DISPLAY=${DISPLAY} scrot -u "${tmpPath}" 2>/dev/null || DISPLAY=${DISPLAY} DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus gnome-screenshot -w -f "${tmpPath}" 2>/dev/null`;

    bot.sendMessage(targetId, fullScreen ? "🖥️ Capturing full screen..." : "📸 Capturing active window...");

    exec(cmd, { timeout: 15000 }, async (error) => {
        if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size < 1000) {
            bot.sendMessage(targetId, "❌ Screenshot failed. Make sure scrot or gnome-screenshot is installed.");
            return;
        }

        try {
            await bot.sendPhoto(targetId, tmpPath, { caption: fullScreen ? "💻 Full Desktop" : "🖼️ Active Window" });
            setTimeout(() => { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); }, 2000);
        } catch (err) {
            bot.sendMessage(targetId, `❌ Error sending photo: ${err.message}`);
        }
    });
}

bot.on('polling_error', (err) => {
    console.error('Polling error:', err.message);
});
