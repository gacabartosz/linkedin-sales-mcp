import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.DATA_DIR || join(process.env.HOME || "/tmp", ".linkedin-mcp");

export const config = {
  dataDir: DATA_DIR,
  authFile: join(DATA_DIR, "scraper-auth.json"),
  dbFile: join(DATA_DIR, "prospects.db"),
  oauthDbFile: join(DATA_DIR, "oauth.db"),

  // Gemini for AI classification
  geminiApiKey: process.env.GEMINI_API_KEY || "",

  // OAuth
  oauthSecret: process.env.OAUTH_SECRET || "change-me-in-production",
  oauthApproveSecret: process.env.OAUTH_APPROVE_SECRET || "",
  oauthClientId: process.env.OAUTH_CLIENT_ID || "",
  oauthClientSecret: process.env.OAUTH_CLIENT_SECRET || "",

  // Server
  serverPort: parseInt(process.env.PORT || "3100", 10),
  serverHost: process.env.HOST || "0.0.0.0",
  publicUrl: process.env.PUBLIC_URL || "https://mcp-linkedin.bartoszgaca.pl",

  // LinkedIn Voyager (not used — kept for compatibility with copied scraper code)
  linkedinClientId: "",
  linkedinClientSecret: "",
  linkedinAccessToken: "",
  linkedinPersonUrn: "",
  callbackPort: 8585,
  apiVersion: "202503",

  // Directories
  userTemplatesDir: join(DATA_DIR, "templates"),
  imagesDir: join(DATA_DIR, "images"),
  brandVoiceFile: join(DATA_DIR, "brand-voice.json"),
  guidelinesDir: "",
};

export function ensureDataDirs(): void {
  for (const dir of [config.dataDir]) {
    mkdirSync(dir, { recursive: true });
  }
}
