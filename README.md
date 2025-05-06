# bot-practice

# XMTP Farcon Bot

A bot that automatically adds users to a Farcon group chat when they message it. Built with XMTP.

## Setup

1. Install dependencies: `npm install`

2. Generate XMTP keys: `npm run gen:keys`

3. Start the bot: `npm start`

4. Set admin address in src/farcon.ts

## Environment Variables

- `WALLET_KEY`: Private key of the wallet
- `ENCRYPTION_KEY`: Encryption key for the local database
- `XMTP_ENV`: XMTP environment (dev/production)
