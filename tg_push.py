#!/usr/bin/env python3
"""
Antigravity Telegram Bridge — Push messages to the user via Telegram.
Used by the AI agent to proactively send messages when the user is away.

Usage: python3 tg_push.py "Your message here"
"""
import sys
import json
import os
import urllib.request

BRIDGE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "telegram_bridge.json")
SETTINGS_PATH = os.path.join(os.path.expanduser("~"), ".config", "Antigravity", "User", "settings.json")


def load_credentials():
    """Load bot_token and chat_id from bridge config or Antigravity settings."""
    bot_token = ""
    chat_id = ""

    try:
        with open(BRIDGE_PATH, "r") as f:
            data = json.load(f)
            bot_token = data.get("bot_token", "")
            chat_id = data.get("chat_id", "")
    except Exception:
        pass

    if not bot_token:
        try:
            with open(SETTINGS_PATH, "r") as f:
                settings = json.load(f)
                bot_token = settings.get("antigravityTelegram.botToken", "")
                chat_id = settings.get("antigravityTelegram.chatId", chat_id)
        except Exception:
            pass

    return bot_token, chat_id


def send_message(text):
    bot_token, chat_id = load_credentials()
    if not bot_token or not chat_id:
        print("Error: No bot_token or chat_id found. Configure via the extension panel.")
        sys.exit(1)

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    data = json.dumps({"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            if result.get("ok"):
                print(f"Message sent to chat {chat_id}")
            else:
                print(f"Telegram API error: {result}")
    except Exception as e:
        print(f"Error sending message: {e}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 tg_push.py 'message text'")
        sys.exit(1)

    message = " ".join(sys.argv[1:])
    send_message(message)
