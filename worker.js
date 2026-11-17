const COOKIE = "oip_admin";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
  if (!env.ADMIN_PASSWORD) {
    return new Response("Admin password is not set on this Worker.", { status: 503 });
  }
  if (request.method === "POST") {
    const form = await request.formData();
    const password = String(form.get("password") || "");
    if (!(await same(password, env.ADMIN_PASSWORD))) return page("Wrong password.", false);
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    headers.append("set-cookie", `${COOKIE}=${await seal(env.ADMIN_PASSWORD)}; HttpOnly; Secure; SameSite=Lax; Path=/admin; Max-Age=604800`);
    return new Response(await list(env), { headers });
  }
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (token && (await same(token, await seal(env.ADMIN_PASSWORD)))) {
    return new Response(await list(env), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return page("", false);
}

async function list(env) {
  if (!env.DB) return page("Database is not connected.", true);
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

function page(message, authed) {
  if (authed) return `<!doctype html><meta charset="utf-8"><p>${escapeHtml(message)}</p>`;
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Admin · Open Investor Pitch</title>
      <form method="post" style="font:16px ui-sans-serif,system-ui;margin:2rem">
        <h1>List</h1>
        <p>${escapeHtml(message)}</p>
        <label>Password<br><input type="password" name="password" autofocus></label>
        <button type="submit">Open</button>
      </form>`,
    { status: message ? 401 : 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&", "<": "<", ">": ">", '"': """, "'": "&#39;" })[char]);
}

async function seal(secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("oip-admin"));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function same(a, b) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}
