import dotenv from "dotenv";
dotenv.config();

export function validateEnvironment(requiredEnvVars: string[]) {
  const missingEnvVars = requiredEnvVars.filter(
    (envVar) => !process.env[envVar]
  );
  if (missingEnvVars.length > 0) {
    throw new Error(
      `Missing environment variables: ${missingEnvVars.join(", ")}`
    );
  }
  return process.env as { [key: string]: string };
}

export function logAgentDetails(address: string, inboxId: string, env: string) {
  console.log("XMTP Agent Details:");
  console.log(`Address: ${address}`);
  console.log(`Inbox ID: ${inboxId}`);
  console.log(`Environment: ${env}`);
}

const timestamp = () =>
  new Date().toISOString().replace("T", " ").substring(0, 19);

export function log(message: string) {
  console.log(`[${timestamp()}] [INFO] ${message}`);
}

export function isSameString(a?: string, b?: string) {
  return a?.toLowerCase() === b?.toLowerCase();
}
