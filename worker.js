const TEAM_DOMAIN = "https://ancient-flower-1bd3.cloudflareaccess.com";
const CERTS_URL = `${TEAM_DOMAIN}/cdn-cgi/access/certs`;
const ALLOWED_EMAIL = "martin@incisive.vc";
const KEY_TTL_MS = 60 * 60 * 1000;

let keyCache = { keys: null, expires: 0 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      const row = await env.DB.prepare("SELECT 1 AS ok").first();
      return Response.json({ ok: row?.ok === 1 });
    }
    if (url.pathname === "/api/join" && request.method === "POST") return join(request, env);
    if (url.pathname === "/admin") return admin(request, env);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Missing assets binding.", { status: 500 });
  },
};

async function join(request, env) {
  if (!env.DB) return Response.json({ error: "Database is not connected." }, { status: 503 });
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send an email." }, { status: 400 });
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a real email." }, { status: 400 });
  }
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, joined_at TEXT NOT NULL)",
  ).run();
  await env.DB.prepare(
    "INSERT INTO subscribers (email, joined_at) VALUES (?1, ?2) ON CONFLICT(email) DO NOTHING",
  )
    .bind(email, new Date().toISOString())
    .run();
  return Response.json({ email }, { status: 201 });
}

async function admin(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  let allowed = false;
  try {
    allowed = await accessAllows(token);
  } catch {
    allowed = false;
  }
  if (!allowed) return new Response("Forbidden", { status: 403 });
  if (!env.DB) return new Response("Database is not connected.", { status: 503 });
  return new Response(await list(env), { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function list(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, joined_at TEXT NOT NULL)",
  ).run();
  const { results } = await env.DB.prepare(
    "SELECT email, joined_at FROM subscribers ORDER BY joined_at DESC",
  ).all();
  const rows = (results || [])
    .map((row) => `<tr><td>${escapeHtml(row.email)}</td><td>${escapeHtml(row.joined_at)}</td></tr>`)
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>List · Open Investor Pitch</title>
    <style>body{font:16px/1.4 ui-sans-serif,system-ui;margin:2rem;color:#121212}table{border-collapse:collapse;width:min(40rem,100%)}td,th{text-align:left;border-bottom:1px solid #ece7e2;padding:0.5rem}h1{font-size:1.4rem}</style>
    <h1>Join list</h1><p>${results?.length || 0} people</p>
    <table><tr><th>Email</th><th>Joined</th></tr>${rows || ""}</table>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function accessAllows(token) {
  if (!token || token.length > 8192) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodePart(headerPart);
  const payload = decodePart(payloadPart);
  if (!header || !payload || header.alg !== "RS256" || !header.kid) return false;
  if (payload.iss !== TEAM_DOMAIN) return false;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) return false;
  if (typeof payload.nbf === "number" && payload.nbf > now) return false;
  if (String(payload.email || "").trim().toLowerCase() !== ALLOWED_EMAIL) return false;
  const jwk = (await accessKeys()).find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256" },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlBytes(signaturePart), signed);
}

function decodePart(part) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlBytes(part)));
  } catch {
    return null;
  }
}

function base64UrlBytes(part) {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function accessKeys() {
  const now = Date.now();
  if (keyCache.keys && now < keyCache.expires) return keyCache.keys;
  const cache = caches.default;
  const cacheRequest = new Request(CERTS_URL);
  let response = await cache.match(cacheRequest);
  if (!response) {
    const fresh = await fetch(CERTS_URL);
    if (!fresh.ok) return keyCache.keys || [];
    response = new Response(await fresh.arrayBuffer(), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=3600",
      },
    });
    await cache.put(cacheRequest, response.clone());
  }
  const body = await response.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  keyCache = { keys, expires: now + KEY_TTL_MS };
  return keys;
}
