import { Redis } from "@upstash/redis";

const LEADERBOARD_KEY = "billy-bouncer:leaderboard";
const MAX_DISPLAY_ENTRIES = 3;
const MAX_SCAN_ENTRIES = 100;

const redis =
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN
      })
    : null;

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sanitizeName(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 .'-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12);
}

function parseEntry(entry) {
  try {
    const parsed = JSON.parse(entry.member);
    return {
      member: entry.member,
      name: sanitizeName(parsed.name || "OUTLAW") || "OUTLAW",
      score: Number(entry.score) || 0
    };
  } catch {
    return {
      member: entry.member,
      name: sanitizeName(entry.member || "OUTLAW") || "OUTLAW",
      score: Number(entry.score) || 0
    };
  }
}

async function readRawEntries() {
  if (!redis) {
    return [];
  }

  const raw = await redis.zrange(LEADERBOARD_KEY, 0, MAX_SCAN_ENTRIES - 1, {
    rev: true,
    withScores: true
  });

  return raw.map(parseEntry);
}

async function readEntries() {
  const rawEntries = await readRawEntries();
  const seen = new Set();
  const deduped = [];

  for (const entry of rawEntries) {
    if (seen.has(entry.name)) {
      continue;
    }
    seen.add(entry.name);
    deduped.push({
      name: entry.name,
      score: entry.score
    });
    if (deduped.length >= MAX_DISPLAY_ENTRIES) {
      break;
    }
  }

  return deduped;
}

export default async function handler(request, response) {
  setCors(response);

  if (request.method === "OPTIONS") {
    return response.status(204).end();
  }

  if (!redis) {
    return response.status(503).json({
      ok: false,
      error: "Leaderboard is not configured yet."
    });
  }

  if (request.method === "GET") {
    const entries = await readEntries();
    return response.status(200).json({ ok: true, entries });
  }

  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const name = sanitizeName(body.name);
  const score = Math.max(0, Math.floor(Number(body.score) || 0));

  if (!name || score <= 0) {
    return response.status(400).json({ ok: false, error: "Invalid score submission." });
  }

  const rawEntries = await readRawEntries();
  const matchingEntries = rawEntries.filter((entry) => entry.name === name);
  const bestScore = matchingEntries.reduce((best, entry) => Math.max(best, entry.score), 0);
  const nextScore = Math.max(bestScore, score);

  for (const entry of matchingEntries) {
    await redis.zrem(LEADERBOARD_KEY, entry.member);
  }

  await redis.zadd(LEADERBOARD_KEY, {
    score: nextScore,
    member: name
  });

  const total = await redis.zcard(LEADERBOARD_KEY);
  if (total > 200) {
    await redis.zremrangebyrank(LEADERBOARD_KEY, 0, total - 201);
  }

  const entries = await readEntries();
  return response.status(200).json({ ok: true, entries });
}
