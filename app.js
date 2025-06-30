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
  PORT = 8080,
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
    console.log(`✅ Attempted to remove Telegram user ${telegramId} from group`);
  } catch (err) {
    if (err.response?.description?.includes("USER_NOT_PARTICIPANT")) {
      console.warn(`⚠️ User ${telegramId} not in group, skipping removal.`);
    } else {
      console.error(`❌ Failed to remove Telegram user ${telegramId}:`, err);
    }
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
  try {
    let event;
    const sig = req.headers["stripe-signature"];

    if (verifySignature) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        console.error("❌ Stripe signature verification failed:", err);
        return res.status(400).send("Invalid signature");
      }
    } else {
      event = JSON.parse(req.body.toString());
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

    if (!email) {
      console.warn("⚠️ No email found in webhook event, ignoring.");
      return res.status(200).send("OK");
    }

    const telegramId = await getTelegramIdByEmail(email);

    if (!telegramId) {
      console.warn(`⚠️ No Telegram ID found for email ${email}, ignoring.`);
      return res.status(200).send("OK");
    }

    if (["invoice.payment_failed", "customer.subscription.deleted", "charge.failed", "charge.dispute.created"].includes(event.type)) {
      console.log(`🔁 Attempting to remove Telegram user ${telegramId} for email ${email}`);
      await removeUserFromGroup(telegramId);
    }

    res.status(200).send("OK");

  } catch (err) {
    console.error("❌ Webhook Handler Error:", err);
    res.status(500).send("Webhook error");
  }
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

app.get("/dashboard", async (req, res) => {
  const { token, order } = req.query;

  if (token !== process.env.DASHBOARD_ACCESS_TOKEN) {
    return res.status(403).send("❌ Forbidden - Invalid Token");
  }

  const sortOrder = order === "desc" ? "DESC" : "ASC";
  const sortLabel = sortOrder === "DESC" ? "Newest First" : "Oldest First";
  const oppositeOrder = sortOrder === "DESC" ? "asc" : "desc";

  try {
    const client = await pool.connect();
    const result = await client.query(`SELECT * FROM telegram_users ORDER BY joined_at ${sortOrder}`);
    client.release();

    const rows = result.rows
      .map(
        (row) =>
          `<tr>
            <td>${row.telegram_id}</td>
            <td>${row.email}</td>
            <td>${new Date(row.joined_at).toLocaleString()}</td>
          </tr>`
      )
      .join("");

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Telegram User Dashboard</title>
        <style>
          body { font-family: sans-serif; padding: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
        </style>
        <script>
          setTimeout(() => window.location.reload(), 10000);
        </script>
      </head>
      <body>
        <h1>📊 Telegram Users Dashboard</h1>
        <p>
          Sort by: 
          <a href="?token=${token}&order=${oppositeOrder}">
            ${sortOrder === "DESC" ? "Oldest First" : "Newest First"}
          </a>
        </p>
        <table>
          <thead>
            <tr>
              <th>Telegram ID</th>
              <th>Email</th>
              <th>Joined At</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ Error rendering dashboard:", err);
    res.status(500).send("Error loading dashboard");
  }
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
