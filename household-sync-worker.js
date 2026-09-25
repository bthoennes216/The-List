/**
 * The List household sync (separate Cloudflare Worker).
 * Bind a D1 database as DB and run household-sync.sql first.
 * The Worker stores only encrypted snapshots. A 256-bit invite code stays on devices.
 */
const ALLOWED_ORIGIN = "https://bthoennes216.github.io";
const MAX_CHUNKS = 20;
const MAX_CHUNK_LENGTH = 700000;

function reply(value, status = 200, origin = "") {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(origin === ALLOWED_ORIGIN ? {
        "Access-Control-Allow-Origin": origin,
        "Vary": "Origin",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type"
      } : {})
    }
  });
}
async function householdId(request) {
  const auth = request.headers.get("Authorization") || "";
  const match = /^Bearer ([0-9a-f]{64})$/.exec(auth);
  if (!match) return null;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(match[1]));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
function validSnapshot(body) {
  return body && typeof body.iv === "string" &&
    /^[A-Za-z0-9_-]{16}$/.test(body.iv) &&
    Array.isArray(body.chunks) &&
    body.chunks.length > 0 && body.chunks.length <= MAX_CHUNKS &&
    body.chunks.every(chunk => typeof chunk === "string" &&
      chunk.length > 0 && chunk.length <= MAX_CHUNK_LENGTH &&
      /^[A-Za-z0-9_-]+$/.test(chunk));
}
function chunkInserts(env, id, chunks, writeToken) {
  return chunks.map((chunk, index) => env.DB.prepare(
    "INSERT INTO snapshot_chunks (household_id,seq,data) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM households WHERE id=? AND write_token=?)"
  ).bind(id, index, chunk, id, writeToken));
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (origin && origin !== ALLOWED_ORIGIN) return reply({ok:false,error:"Origin not allowed."}, 403);
    if (request.method === "OPTIONS") return reply({ok:true}, 200, origin);
    if (new URL(request.url).pathname === "/") return reply({ok:true,service:"The List household sync",configured:!!env.DB},200,origin);
    if (!env.DB) return reply({ok:false,error:"Sync database is not configured."},503,origin);
    const path = new URL(request.url).pathname;
    if (!["/sync","/sync/create"].includes(path)) return reply({ok:false,error:"Not found."},404,origin);
    const id = await householdId(request);
    if (!id) return reply({ok:false,error:"Invalid household code."},401,origin);
    try {
      if (path === "/sync" && request.method === "GET") {
        const [head,body] = await env.DB.batch([
          env.DB.prepare("SELECT version,iv,chunk_count FROM households WHERE id=?").bind(id),
          env.DB.prepare("SELECT seq,data FROM snapshot_chunks WHERE household_id=? ORDER BY seq").bind(id)
        ]);
        const household = head.results[0];
        if (!household) return reply({ok:false,error:"Household not found."},404,origin);
        if (body.results.length !== household.chunk_count) return reply({ok:false,error:"Incomplete snapshot."},503,origin);
        return reply({ok:true,version:household.version,iv:household.iv,
          chunks:body.results.map(row => row.data)},200,origin);
      }
      if (request.method !== "POST") return reply({ok:false,error:"Method not allowed."},405,origin);
      const raw = await request.text();
      if (raw.length > MAX_CHUNKS * MAX_CHUNK_LENGTH + 2000) return reply({ok:false,error:"Snapshot too large."},413,origin);
      let body;
      try { body = JSON.parse(raw); } catch { return reply({ok:false,error:"Invalid JSON."},400,origin); }
      if (!validSnapshot(body)) return reply({ok:false,error:"Invalid encrypted snapshot."},400,origin);
      const writeToken = crypto.randomUUID();
      const now = new Date().toISOString();
      if (path === "/sync/create") {
        const results = await env.DB.batch([
          env.DB.prepare("INSERT INTO households(id,version,iv,chunk_count,write_token,updated_at) VALUES(?,1,?,?,?,?) ON CONFLICT(id) DO NOTHING")
            .bind(id,body.iv,body.chunks.length,writeToken,now),
          ...chunkInserts(env,id,body.chunks,writeToken)
        ]);
        if (results[0].meta.changes !== 1) return reply({ok:false,error:"Household already exists."},409,origin);
        return reply({ok:true,version:1},201,origin);
      }
      if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1)
        return reply({ok:false,error:"Invalid version."},400,origin);
      const results = await env.DB.batch([
        env.DB.prepare("UPDATE households SET version=version+1,iv=?,chunk_count=?,write_token=?,updated_at=? WHERE id=? AND version=?")
          .bind(body.iv,body.chunks.length,writeToken,now,id,body.expectedVersion),
        env.DB.prepare("DELETE FROM snapshot_chunks WHERE household_id=? AND EXISTS (SELECT 1 FROM households WHERE id=? AND write_token=?)")
          .bind(id,id,writeToken),
        ...chunkInserts(env,id,body.chunks,writeToken)
      ]);
      if (results[0].meta.changes !== 1) return reply({ok:false,error:"Another device updated this household. Review its changes before saving again."},409,origin);
      return reply({ok:true,version:body.expectedVersion+1},200,origin);
    } catch (error) {
      return reply({ok:false,error:"Sync is temporarily unavailable."},503,origin);
    }
  }
};
