// Candy IPTV server helper (Netlify Edge Function)
// /xapi   -> talks to your provider's Xtream Codes API
// /stream -> streams video, images and playlists through your HTTPS site
//            so phones and browsers don't block them.

const UA = { "user-agent": "VLC/3.0.20 LibVLC/3.0.20" };
const ACTIONS = new Set([
  "", "get_live_categories", "get_vod_categories", "get_series_categories",
  "get_live_streams", "get_vod_streams", "get_series", "get_series_info",
  "get_vod_info", "get_short_epg", "get_simple_data_table",
]);
const PARAMS = ["category_id", "series_id", "vod_id", "stream_id", "limit"];

function isPrivateHost(host) {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
         (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

const jerr = (status, error) => new Response(JSON.stringify({ error }), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});
const prox = (abs) => "/stream?url=" + encodeURIComponent(abs);

async function handleApi(req) {
  if (req.method !== "POST") return jerr(405, "Use POST.");
  let b;
  try { b = await req.json(); } catch { return jerr(400, "Invalid request."); }
  const { server = "", username = "", password = "", action = "" } = b || {};
  if (!server || !username || !password) return jerr(400, "Server, username and password are required.");
  if (!ACTIONS.has(action)) return jerr(400, "That action isn't supported.");
  let base;
  try { base = new URL(/^https?:\/\//i.test(server) ? server : `http://${server}`); }
  catch { return jerr(400, "Server URL isn't valid."); }
  if (isPrivateHost(base.hostname)) return jerr(400, "Private network addresses aren't allowed.");

  const url = new URL("/player_api.php", base.origin);
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);
  if (action) url.searchParams.set("action", action);
  for (const p of PARAMS) {
    const v = b[p];
    if (v !== undefined && v !== null && /^\d+$/.test(String(v))) url.searchParams.set(p, String(v));
  }
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
    if (!r.ok) return jerr(502, `The server answered with an error (HTTP ${r.status}).`);
    return new Response(r.body, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (e) {
    return jerr(504, e && e.name === "TimeoutError"
      ? "The server took too long to answer. Try again."
      : "Couldn't reach the server. Check the URL and port.");
  }
}

async function handleStream(req, u) {
  const target = u.searchParams.get("url");
  const raw = u.searchParams.get("raw") === "1";
  if (!target) return new Response("Missing url", { status: 400 });
  let t;
  try { t = new URL(target); } catch { return new Response("Bad url", { status: 400 }); }
  if (!/^https?:$/.test(t.protocol) || isPrivateHost(t.hostname)) return new Response("Not allowed", { status: 400 });

  const headers = { ...UA };
  const range = req.headers.get("range");
  if (range) headers.range = range;

  let r;
  try { r = await fetch(t, { headers, redirect: "follow" }); }
  catch { return new Response("Couldn't reach the stream", { status: 502 }); }

  const ct = r.headers.get("content-type") || "";
  const finalPath = new URL(r.url).pathname.toLowerCase();
  const isPlaylist = !raw && (/mpegurl/i.test(ct) || finalPath.endsWith(".m3u8"));

  if (isPlaylist && r.ok) {
    const base = r.url;
    const text = await r.text();
    const out = text.split("\n").map((line) => {
      const l = line.trim();
      if (!l) return line;
      if (l.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_, p) => `URI="${prox(new URL(p, base).href)}"`);
      }
      return prox(new URL(l, base).href);
    }).join("\n");
    return new Response(out, {
      status: 200,
      headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" },
    });
  }

  const h = new Headers();
  for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = r.headers.get(k);
    if (v) h.set(k, v);
  }
  if (!ct || /octet-stream/i.test(ct)) {
    if (finalPath.endsWith(".mp4") || finalPath.endsWith(".m4v")) h.set("content-type", "video/mp4");
    else if (finalPath.endsWith(".ts")) h.set("content-type", "video/mp2t");
  }
  h.set("cache-control", raw ? "no-store" : "public, max-age=60");
  return new Response(r.body, { status: r.status, headers: h });
}

export default async (req) => {
  const u = new URL(req.url);
  if (u.pathname === "/xapi") return handleApi(req);
  return handleStream(req, u);
};

export const config = { path: ["/xapi", "/stream"] };
