const TEAM_DOMAIN = "https://ancient-flower-1bd3.cloudflareaccess.com";
const CERTS_URL = `${TEAM_DOMAIN}/cdn-cgi/access/certs`;
const ALLOWED_EMAIL = "martin@incisive.vc";
const CATEGORIES = ["Investor", "Founder", "Partner"];
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
    if (url.pathname === "/admin" || url.pathname === "/admin/export.csv") return admin(request, env);
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
  const category = String(body.category || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a real email." }, { status: 400 });
  }
  if (!CATEGORIES.includes(category)) {
    return Response.json({ error: "Choose Investor, Founder, or Partner." }, { status: 400 });
  }
  await ensureSubscribers(env);
  await env.DB.prepare(
    `INSERT INTO subscribers (email, joined_at, category) VALUES (?1, ?2, ?3)
     ON CONFLICT(email) DO UPDATE SET category = excluded.category`,
  )
    .bind(email, new Date().toISOString(), category)
    .run();
  return Response.json({ email, category }, { status: 201 });
}

async function admin(request, env) {
  let allowed = false;
  try {
    allowed = await accessAllows(request.headers.get("Cf-Access-Jwt-Assertion"));
  } catch {
    allowed = false;
  }
  if (!allowed) return new Response("Forbidden", { status: 403 });
  if (!env.DB) return new Response("Database is not connected.", { status: 503 });
  await ensureSubscribers(env);
  const url = new URL(request.url);
  const filter = categoryFilter(url.searchParams.get("category"));
  const rows = await loadSubscribers(env, filter);
  if (url.pathname === "/admin/export.csv") return csvResponse(rows);
  const counts = await categoryCounts(env);
  return new Response(renderAdmin(rows, counts, filter), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
  });
}

async function ensureSubscribers(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, joined_at TEXT NOT NULL)",
  ).run();
  const info = await env.DB.prepare("PRAGMA table_info(subscribers)").all();
  const names = new Set((info.results || []).map((row) => row.name));
  if (names.has("category")) return;
  try {
    await env.DB.prepare("ALTER TABLE subscribers ADD COLUMN category TEXT").run();
  } catch (error) {
    if (!/duplicate column/i.test(String(error))) throw error;
  }
}

function categoryFilter(value) {
  if (value === "Unknown" || CATEGORIES.includes(value)) return value;
  return "";
}

function categoryLabel(value) {
  return value ? String(value) : "Unknown";
}

async function loadSubscribers(env, filter) {
  let sql = "SELECT email, category, joined_at FROM subscribers";
  const statement = filter
    ? env.DB.prepare(
        filter === "Unknown"
          ? `${sql} WHERE category IS NULL OR category = '' ORDER BY joined_at DESC`
          : `${sql} WHERE category = ?1 ORDER BY joined_at DESC`,
      )
    : env.DB.prepare(`${sql} ORDER BY joined_at DESC`);
  const { results } = filter && filter !== "Unknown" ? await statement.bind(filter).all() : await statement.all();
  return results || [];
}

async function categoryCounts(env) {
  const { results } = await env.DB.prepare(
    "SELECT COALESCE(NULLIF(category, ''), 'Unknown') AS category, COUNT(*) AS n FROM subscribers GROUP BY 1",
  ).all();
  const counts = { Investor: 0, Founder: 0, Partner: 0, Unknown: 0 };
  for (const row of results || []) counts[row.category] = Number(row.n) || 0;
  return counts;
}

function renderAdmin(rows, counts, filter) {
  const filters = ["", "Investor", "Founder", "Partner", "Unknown"];
  const links = filters
    .map((value) => {
      const label = value || "All";
      const href = value ? `/admin?category=${encodeURIComponent(value)}` : "/admin";
      const current = value === filter ? " aria-current=\"page\"" : "";
      return `<a href="${href}"${current}>${label}</a>`;
    })
    .join("");
  const exportHref = filter ? `/admin/export.csv?category=${encodeURIComponent(filter)}` : "/admin/export.csv";
  const body = rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.email)}</td><td>${escapeHtml(categoryLabel(row.category))}</td><td>${escapeHtml(formatPacific(row.joined_at))}</td></tr>`,
    )
    .join("");
  const summary = ["Investor", "Founder", "Partner", "Unknown"]
    .map((name) => `${escapeHtml(name)} ${counts[name] || 0}`)
    .join(" · ");
  return `<!doctype html><meta charset="utf-8"><title>List · Open Investor Pitch</title>
    <style>
      body{font:16px/1.4 ui-sans-serif,system-ui;margin:2rem;color:#121212}
      table{border-collapse:collapse;width:min(48rem,100%)}
      td,th{text-align:left;border-bottom:1px solid #ece7e2;padding:0.5rem}
      h1{font-size:1.4rem}
      a{color:#121212}
      nav a{margin-right:0.8rem}
      nav a[aria-current="page"]{font-weight:700}
      .download{display:inline-block;margin:0.8rem 0 1rem;background:#121212;color:#fff;text-decoration:none;border-radius:0.5rem;padding:0.45rem 0.8rem;font-weight:650}
    </style>
    <h1>Join list</h1>
    <p>${summary}</p>
    <nav>${links}</nav>
    <a class="download" href="${exportHref}">Download CSV</a>
    <table><tr><th>Email</th><th>Category</th><th>Joined</th></tr>${body}</table>`;
}

function csvResponse(rows) {
  const lines = ["email,category,joined_at"];
  for (const row of rows) {
    lines.push([csvCell(row.email), csvCell(categoryLabel(row.category)), csvCell(row.joined_at)].join(","));
  }
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="openinvestorpitch-waitlist-${day}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function formatPacific(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
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
