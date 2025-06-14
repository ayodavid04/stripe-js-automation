import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { Pool } from "pg";
import Stripe from "stripe";
import { Telegraf } from "telegraf";

dotenv.config();

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_GROUP_ID,
  RENDER_URL,
  WEBHOOK_SECRET_PATH = "telegram",
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  VERIFY_STRIPE_SIGNATURE = "true",
  PORT = 10000,
  DATABASE_URL,
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !RENDER_URL || !STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !DATABASE_URL || !TELEGRAM_GROUP_ID) {
  throw new Error("❌ Missing required env vars");
}

const app = express(); // do not apply global bodyParser

const pool = new Pool({ connectionString: DATABASE_URL });

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS telegram_users (
        telegram_id BIGINT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL
      )
    `);
  } finally {
    client.release();
  }
}

async function insertOrUpdateUser(telegramId, email) {
  const client = await pool.connect();
  try {
    await client.query(
      `
      INSERT INTO telegram_users (telegram_id, email)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id) DO UPDATE SET email = EXCLUDED.email
      `,
      [telegramId, email]
    );
    return true;
  } finally {
    client.release();
  }
}

async function getEmailByUser(telegramId) {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT email FROM telegram_users WHERE telegram_id = $1", [telegramId]);
    return res.rows[0]?.email || null;
  } finally {
    client.release();
  }
}

async function getTelegramIdByEmail(email) {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT telegram_id FROM telegram_users WHERE LOWER(email) = LOWER($1)", [email]);
    return res.rows[0]?.telegram_id || null;
  } finally {
    client.release();
  }
}

// Telegram bot setup
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const WEBHOOK_URL = `${RENDER_URL.replace(/\/$/, "")}/${WEBHOOK_SECRET_PATH}`;

// Telegram handlers
bot.start(async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const email = await getEmailByUser(userId);
  if (email) {
    await ctx.reply(`✅ You're already linked to: ${email}`);
  } else {
    await ctx.reply(
      "👋 Hello! Please use this link to set up your StarTrader live account:\n" +
      "http://www.startrader.com/live-account/?affid=302615\n\n" +
      "Once done, reply here with your subscription email to get access to the channels."
    );
  }
});

bot.command("email", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const email = await getEmailByUser(userId);
  if (email) {
    await ctx.reply(`📧 Your linked email: ${email}`);
  } else {
    await ctx.reply("❌ No email linked. Please send your subscription email.");
  }
});

bot.on("text", async (ctx) => {
  const userId = ctx.from?.id;
  const text = ctx.message.text.trim();

  if (!userId) return ctx.reply("❌ Could not identify user.");

  // If it's a command, ignore this handler
  if (text.startsWith("/")) return;

  // Basic email format check
  const isEmail = text.includes("@") && text.includes(".");

  if (!isEmail) {
    return ctx.reply(
      "⚠️ Please use /start to begin or send your subscription email.\n" +
      "Or click this link to subscribe:\n" +
      "http://www.startrader.com/live-account/?affid=302615"
    );
  }

  // Email flow continues here
  const existing = await getEmailByUser(userId);
  if (existing) {
    return ctx.reply(
      `✅ Already linked to: ${existing}\n\n` +
      "🎉 Here's access to the channels again:\n" +
      "https://t.me/+BeFotamcYN1hZmY0\n" +
      "https://t.me/+A2jeD4HyJ_k2OGM8"
    );
  }

  await insertOrUpdateUser(userId, text);
  await ctx.reply(
    `✅ Linked '${text}' successfully.\n\n` +
    "🎉 You now have access to the channels:\n" +
    "https://t.me/+BeFotamcYN1hZmY0\n" +
    "https://t.me/+A2jeD4HyJ_k2OGM8"
  );
});


// Kick Telegram user from group
async function removeUserFromGroup(telegramId) {
  try {
    await bot.telegram.banChatMember(TELEGRAM_GROUP_ID, telegramId);
    await bot.telegram.unbanChatMember(TELEGRAM_GROUP_ID, telegramId);
    console.log(`✅ Removed Telegram user ${telegramId} from group`);
  } catch (err) {
    console.error(`❌ Failed to remove Telegram user ${telegramId}:`, err);
  }
}

// Telegram webhook setup
async function setTelegramWebhook() {
  try {
    await bot.telegram.setWebhook(WEBHOOK_URL);
  
    console.log(`✅ Telegram webhook set to ${WEBHOOK_URL}`);
  } catch (err) {
    console.error("❌ Failed to set Telegram webhook:", err);
  }
}

// ✅ Only apply JSON bodyParser to Telegram webhook
app.post(`/${WEBHOOK_SECRET_PATH}`, bodyParser.json(), (req, res) => {
  bot.handleUpdate(req.body)
    .then(() => res.status(200).send("OK"))
    .catch((err) => {
      console.error("❌ Telegram webhook error:", err);
      res.status(400).send("Bad Request");
    });
});

// Stripe raw webhook
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" });
const verifySignature = VERIFY_STRIPE_SIGNATURE === "true";

app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  const sig = req.headers["stripe-signature"];

  try {
    if (verifySignature) {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error("❌ Stripe webhook error:", err);
    return res.status(400).send("Invalid signature");
  }

  const dataObject = event.data?.object || {};
  let email = dataObject.customer_email;

  if (!email && dataObject.customer) {
    try {
      const customer = await stripe.customers.retrieve(dataObject.customer);
      email = customer.email;
    } catch (err) {
      console.error("❌ Failed to fetch customer email:", err);
    }
  }

  if (
    ["invoice.payment_failed", "customer.subscription.deleted", "charge.failed", "charge.dispute.created"].includes(event.type) &&
    email
  ) {
    const telegramId = await getTelegramIdByEmail(email);
    if (telegramId) {
      console.log(`🔁 Removing Telegram user ${telegramId} for email ${email}`);
      await removeUserFromGroup(telegramId);
    }
  }

  res.status(200).send("OK");
});

// Health check route
app.get("/", (req, res) => {
  res.send("✅ Bot is live");
});

// Ping route for UptimeRobot
app.get("/ping", (req, res) => {
  res.send("pong");
});

// Status check route
app.get("/status", (req, res) => {
  res.json({
    status: "Bot is live ✅",
    time: new Date(),
    env: process.env.NODE_ENV || "development",
    webhook: `${RENDER_URL}/${WEBHOOK_SECRET_PATH}`,
  });
});

// Start the server
(async () => {
  try {
    await initDb();
    await setTelegramWebhook();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
})();
