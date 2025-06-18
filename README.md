# 🔐 Stripe-Telegram Access Manager

An automated access control system that integrates **Stripe** subscriptions with **Telegram group membership**, using **Node.js**, **PostgreSQL**, and **Docker**, built for creators and businesses offering paid communities.

---

## 🚀 Overview

This backend service automatically **removes Telegram users from a premium group** when:

- A payment **fails**
- A subscription is **canceled**
- A charge is **disputed**

The user onboarding is handled by a Telegram bot, which links the user's **Telegram ID** to their **Stripe subscription email**. This ensures only paying customers have group access — without manual admin work.

---

## 📦 Features

✅ Stripe webhook integration  
✅ Email-based Telegram user linking  
✅ PostgreSQL-backed user store  
✅ Webhook signature verification  
✅ Dockerized for easy deployment  
✅ Real-time HTML admin dashboard (auto-refreshing)  
✅ Render-compatible deployment with `render.yaml`  
✅ Secure, scalable, and production-ready

---

## 🛠️ Tech Stack

- **Backend**: Node.js + Express  
- **Database**: PostgreSQL (`pg` library)  
- **Bot Framework**: Telegraf (Telegram Bot API)  
- **Payments**: Stripe Webhooks  
- **Deployment**: Render.com  
- **Containerization**: Docker & Docker Compose  
- **Admin Panel**: HTML dashboard route with refresh  
- **Environment**: `.env`-based secure configs

---

## ⚙️ How It Works

1. **User joins Telegram** and interacts with the `/start` command.
2. Bot sends them a link to sign up or asks for their Stripe email.
3. Email is saved to a shared PostgreSQL database, linked to their Telegram ID.
4. A **Stripe webhook** listens for subscription events.
5. If a bad event occurs (e.g. failed payment), the system:
   - Looks up the email
   - Finds the Telegram ID
   - Kicks the user from the group automatically

---

## 📊 Live Dashboard

Access a secure HTML dashboard (`/dashboard?token=...`) that shows all registered users in a table format, refreshing every 10 seconds.

---

## 📁 Project Structure

├── telegram_bot.js # Telegraf bot logic (auth, onboarding, email linking)
├── webhook.js # Stripe + Telegram webhook endpoints
├── db.js # Shared PostgreSQL connection pool
├── Dockerfile # Container definition
├── docker-compose.yaml # Optional local setup
├── render.yaml # Render deploy config
├── package.json # Dependencies and scripts
└── .env.example # Example environment variables
