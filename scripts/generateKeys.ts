import { Wallet } from "ethers";
import { writeFileSync } from "fs";
import { randomBytes } from "crypto";

// Generate a new random wallet
const wallet = Wallet.createRandom();
const privateKey = wallet.privateKey;

// Generate encryption key
const encryptionKey = Buffer.from(randomBytes(32)).toString("hex");

// Create or update .env file
const envContent = `
# XMTP Configuration
WALLET_KEY=${privateKey}
ENCRYPTION_KEY=${encryptionKey}
XMTP_ENV=dev
# public key is ${wallet.address}
`;

writeFileSync(".env", envContent.trim());

console.log("Generated and saved to .env:");
console.log(`Public address: ${wallet.address}`);
console.log("Check .env file for private key and encryption key"); 