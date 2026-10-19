const ALLOWED = new Set(["", "get_live_categories", "get_vod_categories", "get_series_categories"]);

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

function isPrivateHost(host) {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
         (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }
  const { server = "", username = "", password = "", action = "" } = body || {};
  if (!server || !username || !password) return json(400, { error: "Server, username and password are required." });
  if (!ALLOWED.has(action)) return json(400, { error: "That action isn't supported." });

  let base;
  try { base = new URL(/^https?:\/\//i.test(server) ? server : `http://${server}`); }
  catch { return json(400, { error: "Server URL isn't valid." }); }
  if (isPrivateHost(base.hostname)) return json(400, { error: "Private network addresses aren't allowed." });

  const url = new URL("/player_api.php", base.origin);
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);
  if (action) url.searchParams.set("action", action);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "CandyIPTV/1.0" } });
    const text = await r.text();
    try { return json(200, { data: JSON.parse(text) }); }
    catch { return json(502, { error: `Server answered but not with Xtream data (HTTP ${r.status}). Check the URL and port.` }); }
  } catch (e) {
    return json(504, { error: e.name === "AbortError"
      ? "The server took too long to answer. Check the URL and port."
      : "Couldn't reach the server. Check the URL and port." });
  } finally { clearTimeout(timer); }
};

export const config = { path: "/api/xtream" };
