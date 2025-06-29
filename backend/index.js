// index.js
import express from "express";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import fs from "fs/promises";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// ── ESM __dirname shim ─────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Paths to your JSON files ───────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, "data.json");
const USERS_FILE = path.join(__dirname, "users.json");

let logArray = [];
let usersArray = [];

// ── Initialize & load any existing log file ────────────────────────────────────
async function initLogFile() {
  await fs.access(DATA_FILE).catch(() => fs.writeFile(DATA_FILE, "[]", "utf8"));
  const raw = await fs.readFile(DATA_FILE, "utf8");
  logArray = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
}

// ── Initialize & load any existing users file ──────────────────────────────────
async function initUsersFile() {
  await fs
    .access(USERS_FILE)
    .catch(() => fs.writeFile(USERS_FILE, "[]", "utf8"));
  const raw = await fs.readFile(USERS_FILE, "utf8");
  usersArray = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
}

// ── Your Firebase web‐SDK config ───────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDwILhkdXU4iqY3c6ju1QPsRctMGcn0sQs",
  authDomain: "power-module-trace-city.firebaseapp.com",
  databaseURL:
    "https://power-module-trace-city-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "power-module-trace-city",
  storageBucket: "power-module-trace-city.firebasestorage.app",
  messagingSenderId: "369893751494",
  appId: "1:369893751494:web:2adbfd98979833290c35c7",
  measurementId: "G-DGYXC5WB8H",
};

// ── Initialize Firebase & Auth ────────────────────────────────────────────────
initializeApp(firebaseConfig);
const auth = getAuth();
const db = getDatabase();
const dataRef = ref(db, "/"); // ← root of your RTDB

// ── State for detecting key-changes ────────────────────────────────────────────
let previousKey = null;
let deviceActive = false;

// ── Fetch from RTDB, detect activity, return data ─────────────────────────────
async function refreshStatus() {
  const snap = await get(dataRef);
  const d = snap.val() || {};
  const k = d.key;
  deviceActive = previousKey !== null && k !== previousKey;
  previousKey = k;
  return d;
}

// ── Get a Colombo-time ISO string (+05:30) ────────────────────────────────────
function getColomboTimeIso() {
  const now = new Date();
  const offsetMins = 5.5 * 60;
  const localTs = new Date(now.getTime() + offsetMins * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${localTs.getUTCFullYear()}-${pad(localTs.getUTCMonth() + 1)}-${pad(
      localTs.getUTCDate()
    )}` +
    `T${pad(localTs.getUTCHours())}:${pad(localTs.getUTCMinutes())}:${pad(
      localTs.getUTCSeconds()
    )}+05:30`
  );
}

// ── Periodic task: every 2s, refresh & log, then append to data.json ─────────
async function periodicLog() {
  try {
    const data = await refreshStatus();
    const record = {
      time: getColomboTimeIso(),
      data,
      deviceStatus: deviceActive,
    };

    console.log(
      `[${new Date().toISOString()}] Device is ${
        deviceActive ? "ACTIVE" : "INACTIVE"
      }`
    );

    // Append & cap to last 1000
    logArray.push(record);
    if (logArray.length > 1000) logArray = logArray.slice(-1000);

    // Persist
    await fs.writeFile(DATA_FILE, JSON.stringify(logArray, null, 2), "utf8");
  } catch (err) {
    console.error("❌ periodicLog error:", err);
  }
}

// ── Boot up everything ─────────────────────────────────────────────────────────
async function start() {
  // 1) Init files
  await initLogFile();
  await initUsersFile();

  // 2) Anonymous sign-in to RTDB (ensure your rules allow auth != null)
  await signInAnonymously(auth);
  console.log("✅ Signed in anonymously to RTDB");

  // 3) Kick off periodic device logging
  await periodicLog();
  setInterval(periodicLog, 2000);

  // 4) Express setup
  const app = express();
  app.use(cors());
  app.use(express.json());

  // • GET latest device data
  app.get("/deviceLivedata", async (_, res) => {
    try {
      const data = await refreshStatus();
      return res.json({
        time: getColomboTimeIso(),
        data,
        deviceStatus: deviceActive,
      });
    } catch (err) {
      console.error("❌ /deviceLivedata error:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // • GET all logged device records
  app.get("/alldata", (_, res) => {
    res.json(logArray);
  });

  // • POST add a new user
  //   Expects JSON body: { userName, accountNumber, device, address, tp, userId }
  app.post("/addUser", async (req, res) => {
    try {
      const { userName, accountNumber, device, address, tp, userId } = req.body;
      // Basic validation
      if (
        ![userName, accountNumber, device, address, tp, userId].every(
          (v) => v != null
        )
      ) {
        return res
          .status(400)
          .json({ error: "Missing one or more required fields." });
      }

      const user = { userName, accountNumber, device, address, tp, userId };
      usersArray.push(user);
      await fs.writeFile(
        USERS_FILE,
        JSON.stringify(usersArray, null, 2),
        "utf8"
      );
      return res.json({ success: true, user });
    } catch (err) {
      console.error("❌ /addUser error:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // • GET view all users
  app.get("/viewUsers", (_, res) => {
    res.json(usersArray);
  });

  app.listen(3300, () => {
    console.log("🚀 API listening on http://localhost:3300");
    console.log("   • GET  /deviceLivedata");
    console.log("   • GET  /alldata");
    console.log("   • POST /addUser");
    console.log("   • GET  /viewUsers");
  });
}

start().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
