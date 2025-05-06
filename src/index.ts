
import dotenv from "dotenv";
dotenv.config();

import { Client, type XmtpEnv } from "@xmtp/node-sdk";
import { createSigner, getEncryptionKeyFromHex, getDbPath} from "./helpers/client.js";
import { logAgentDetails, validateEnvironment, log } from "./helpers/utils.js";
import { findOrCreateBaseSummitGroups } from "./offsite.js";
import { listenForMessages } from "./stream.js";

const { WALLET_KEY, ENCRYPTION_KEY, XMTP_ENV } = validateEnvironment([
  "WALLET_KEY",
  "ENCRYPTION_KEY",
  "XMTP_ENV",
]);

async function main() {
  const signer = createSigner(WALLET_KEY as `0x${string}`);
  const encryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);
  const dbPath = getDbPath(XMTP_ENV);
  log(`[INFO] Using database path: ${dbPath}`);


  const client = await Client.create(signer, {
    env: XMTP_ENV as XmtpEnv,
    dbEncryptionKey: encryptionKey,
    dbPath: dbPath,
  });
  const identifier = await signer.getIdentifier();
  const address = identifier.identifier;

  logAgentDetails(address, client.inboxId, XMTP_ENV);

  // Get or create the Base Summit groups
  const baseSummitGroups = await findOrCreateBaseSummitGroups(client);

  log("Syncing conversations...");
  await client.conversations.sync();

  log("Listening for messages...");
  await listenForMessages(client, baseSummitGroups);
}

main().catch((error) => {
  log(`Fatal error: ${error}`);
  process.exit(1);
}); 
