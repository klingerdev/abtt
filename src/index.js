const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const allowedTables = new Set(["athletes", "news", "events", "affiliates", "media"]);
const tableConfig = {
  athletes: { fields: ["name", "age", "belt", "degree", "country"], fileField: "photo", keyField: "photo_key" },
  news: { fields: ["title", "text"], fileField: "image", keyField: "image_key" },
  events: { fields: ["title", "event_date"], fileField: "image", keyField: "image_key" },
  affiliates: { fields: ["name", "country", "city", "coach"], fileField: "image", keyField: "image_key" },
  media: { fields: ["title", "type"], fileField: "file", keyField: "file_key" }
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS athletes (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,age INTEGER,belt TEXT,degree TEXT,country TEXT,photo_key TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,text TEXT NOT NULL,image_key TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,event_date TEXT NOT NULL,image_key TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS affiliates (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,country TEXT NOT NULL,city TEXT NOT NULL,coach TEXT,image_key TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,type TEXT NOT NULL CHECK (type IN ('image','video')),file_key TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_athletes_name ON athletes(name)`, `CREATE INDEX IF NOT EXISTS idx_news_created ON news(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date)`, `CREATE INDEX IF NOT EXISTS idx_affiliates_name ON affiliates(name)`,
  `CREATE INDEX IF NOT EXISTS idx_media_created ON media(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS translation_cache (cache_key TEXT PRIMARY KEY,source_text TEXT NOT NULL,target_lang TEXT NOT NULL,translated_text TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')))`
];
let schemaReady = false;
async function ensureServices(env) {
  if (!env.DB) throw new Error("Banco D1 não conectado. Configure o binding DB no Cloudflare.");
  if (!schemaReady) { await env.DB.batch(schemaStatements.map(sql => env.DB.prepare(sql))); schemaReady = true; }
}

function b64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decodeB64url(input) {
  const value = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = value + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}
async function makeToken(secret) {
  const payload = b64url(encoder.encode(JSON.stringify({ exp: Date.now() + 8 * 60 * 60 * 1000 })));
  return `${payload}.${await sign(payload, secret)}`;
}
async function validToken(request, secret) {
  if (!secret) return false;
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.split(";").map(v => v.trim()).find(v => v.startsWith("abtt_session="))?.split("=")[1];
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || await sign(payload, secret) !== signature) return false;
  try {
    const parsed = JSON.parse(decoder.decode(decodeB64url(payload)));
    return parsed.exp > Date.now();
  } catch { return false; }
}
function safeKey(name = "arquivo") {
  const clean = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-90);
  return `${Date.now()}-${crypto.randomUUID()}-${clean}`;
}
function mediaUrl(key) { return key ? `/media/${encodeURIComponent(key)}` : null; }
function decorate(table, row) {
  if (!row) return row;
  const cfg = tableConfig[table];
  if (cfg?.keyField && row[cfg.keyField]) row.url = mediaUrl(row[cfg.keyField]);
  return row;
}
async function translateText(env, text, lang) {
  if (!text || lang === "pt-BR") return text;
  const target = ({ en: "en", es: "es", fr: "fr", ar: "ar" })[lang]; if (!target) return text;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${target}:${text}`)); const key = b64url(new Uint8Array(digest));
  const cached = await env.DB.prepare("SELECT translated_text FROM translation_cache WHERE cache_key=?").bind(key).first();
  if (cached?.translated_text) return cached.translated_text;
  try {
    const chunks = text.match(/[\s\S]{1,450}(?:\s|$)/g) || [text], translated = [];
    for (const chunk of chunks) { const endpoint = new URL("https://api.mymemory.translated.net/get"); endpoint.searchParams.set("q",chunk.trim()); endpoint.searchParams.set("langpair",`pt-BR|${target}`); const response=await fetch(endpoint,{headers:{accept:"application/json"}}); if(!response.ok) throw new Error(); const data=await response.json(); translated.push(data?.responseData?.translatedText||chunk.trim()); }
    const result=translated.join(" "); await env.DB.prepare("INSERT OR REPLACE INTO translation_cache (cache_key,source_text,target_lang,translated_text) VALUES (?,?,?,?)").bind(key,text,target,result).run(); return result;
  } catch { return text; }
}
async function translateContent(env,data,lang){if(!lang||lang==="pt-BR")return data;const fields={athletes:["belt","degree","country"],news:["title","text"],events:["title"],affiliates:["country","city","coach"],media:["title"]};for(const [table,names] of Object.entries(fields))for(const row of data[table])for(const name of names)if(row[name])row[name]=await translateText(env,row[name],lang);return data}
async function listContent(env, lang = "pt-BR") {
  await ensureServices(env);
  const [a, n, e, af, m] = await Promise.all([
    env.DB.prepare("SELECT * FROM athletes ORDER BY name COLLATE NOCASE").all(),
    env.DB.prepare("SELECT * FROM news ORDER BY created_at DESC").all(),
    env.DB.prepare("SELECT * FROM events ORDER BY event_date ASC").all(),
    env.DB.prepare("SELECT * FROM affiliates ORDER BY name COLLATE NOCASE").all(),
    env.DB.prepare("SELECT * FROM media ORDER BY created_at DESC").all()
  ]);
  return translateContent(env, {
    athletes: a.results.map(r => decorate("athletes", r)),
    news: n.results.map(r => decorate("news", r)),
    events: e.results.map(r => decorate("events", r)),
    affiliates: af.results.map(r => decorate("affiliates", r)),
    media: m.results.map(r => decorate("media", r))
  }, lang);
}
async function parsePayload(request, table, env, existing = null) {
  const cfg = tableConfig[table];
  const form = await request.formData();
  const payload = {};
  for (const field of cfg.fields) {
    const val = form.get(field);
    payload[field] = typeof val === "string" ? val.trim() : "";
  }
  if (table === "athletes") payload.age = payload.age ? Number(payload.age) : null;
  const file = form.get(cfg.fileField);
  payload[cfg.keyField] = existing?.[cfg.keyField] || null;
  if (file instanceof File && file.size > 0) {
    if (file.size > 25 * 1024 * 1024) throw new Error("Arquivo maior que 25 MB.");
    if (!env.MEDIA) throw new Error("Armazenamento R2 não conectado. Configure o binding MEDIA e o bucket abtt-media.");
    const wantedType = table === "media" && payload.type === "video" ? "video/" : "image/";
    if (!(file.type || "").startsWith(wantedType)) throw new Error(wantedType === "video/" ? "Selecione um vídeo válido." : "Selecione uma imagem válida.");
    const key = `${table}/${safeKey(file.name)}`;
    await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
    payload[cfg.keyField] = key;
  }
  return payload;
}
function validate(table, p) {
  if (table === "athletes" && !p.name) return "Informe o nome do atleta.";
  if (table === "news" && (!p.title || !p.text)) return "Informe título e texto da notícia.";
  if (table === "events" && (!p.title || !p.event_date)) return "Informe nome e data do evento.";
  if (table === "affiliates" && (!p.name || !p.country || !p.city)) return "Informe nome, país e cidade da afiliada.";
  if (table === "media" && (!p.title || !["image", "video"].includes(p.type) || !p.file_key)) return "Informe título, tipo e arquivo.";
  return null;
}
async function adminCrud(request, env, table, id, method) {
  if (!allowedTables.has(table)) return json({ error: "Recurso inválido." }, 404);
  if (!await validToken(request, env.ADMIN_PASSWORD)) return json({ error: "Não autorizado." }, 401);
  await ensureServices(env);
  const cfg = tableConfig[table];
  if (method === "POST") {
    const p = await parsePayload(request, table, env);
    const error = validate(table, p); if (error) return json({ error }, 400);
    const cols = [...cfg.fields, cfg.keyField];
    const vals = cols.map(c => p[c] ?? null);
    const placeholders = cols.map(() => "?").join(",");
    const res = await env.DB.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`).bind(...vals).run();
    return json({ ok: true, id: res.meta.last_row_id }, 201);
  }
  const existing = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();
  if (!existing) return json({ error: "Registro não encontrado." }, 404);
  if (method === "PUT") {
    const p = await parsePayload(request, table, env, existing);
    const error = validate(table, p); if (error) return json({ error }, 400);
    const cols = [...cfg.fields, cfg.keyField];
    const set = cols.map(c => `${c}=?`).join(",");
    await env.DB.prepare(`UPDATE ${table} SET ${set}, updated_at=datetime('now') WHERE id=?`).bind(...cols.map(c => p[c] ?? null), id).run();
    if (p[cfg.keyField] !== existing[cfg.keyField] && existing[cfg.keyField] && env.MEDIA) await env.MEDIA.delete(existing[cfg.keyField]).catch(() => {});
    return json({ ok: true });
  }
  if (method === "DELETE") {
    await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
    if (existing[cfg.keyField] && env.MEDIA) await env.MEDIA.delete(existing[cfg.keyField]).catch(() => {});
    return json({ ok: true });
  }
  return json({ error: "Método não permitido." }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/content" && request.method === "GET") { const lang=url.searchParams.get("lang")||"pt-BR"; return json(await listContent(env,lang),200,{"cache-control":"public, max-age=30"}); }
      if (url.pathname === "/api/admin/session" && request.method === "GET") return json({ authenticated: await validToken(request, env.ADMIN_PASSWORD) });
      if (url.pathname === "/api/admin/login" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD ainda não foi configurada no Cloudflare." }, 500);
        if (body.user !== (env.ADMIN_USER || "admin") || body.password !== env.ADMIN_PASSWORD) return json({ error: "Usuário ou senha inválidos." }, 401);
        const token = await makeToken(env.ADMIN_PASSWORD);
        return json({ ok: true }, 200, { "set-cookie": `abtt_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800` });
      }
      if (url.pathname === "/api/admin/logout" && request.method === "POST") return json({ ok: true }, 200, { "set-cookie": "abtt_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0" });
      const crud = url.pathname.match(/^\/api\/admin\/(athletes|news|events|affiliates|media)(?:\/(\d+))?$/);
      if (crud) return adminCrud(request, env, crud[1], Number(crud[2] || 0), request.method);
      if (url.pathname.startsWith("/media/") && request.method === "GET") {
        if (!env.MEDIA) return json({ error: "Armazenamento de mídia indisponível." }, 503);
        const key = decodeURIComponent(url.pathname.slice(7));
        const obj = await env.MEDIA.get(key);
        if (!obj) return new Response("Arquivo não encontrado", { status: 404 });
        const headers = new Headers();
        obj.writeHttpMetadata(headers); headers.set("etag", obj.httpEtag); headers.set("cache-control", "public, max-age=86400");
        return new Response(obj.body, { headers });
      }
      if (!env.ASSETS) return new Response("Site não configurado.", { status: 503 });
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      const message = error?.message || "Erro interno.";
      return json({ error: /no such table/i.test(message) ? "As tabelas do banco ainda não foram criadas. Execute as migrações do D1." : message }, 500);
    }
  }
};
