import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { serviceWorkerSource } from "./swSource.mjs";

const mode = process.argv[2] || "development";

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

loadEnv(".env");
loadEnv(`.env.${mode}`);
loadEnv(".env.local");

let version = "11.9.1";
if (existsSync("node_modules/firebase/package.json")) {
  version = JSON.parse(readFileSync("node_modules/firebase/package.json", "utf8")).version;
}

const config = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.VITE_FIREBASE_APP_ID || "",
};

const source = serviceWorkerSource(config, version);

writeFileSync("public/sw.js", source);
console.log(`Wrote public/sw.js for ${mode}`);
