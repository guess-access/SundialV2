/* Inspect the duplicated state: which user copies do the extra 21 entries point at? */
const fs = require("fs");
const base = "https://sundialsolstice.netlify.app";
const { token } = JSON.parse(fs.readFileSync("scripts/out/admin-token.json", "utf8"));
(async () => {
  const r = await fetch(base + "/api/state", { headers: { authorization: "Bearer " + token } });
  const s = await r.json();
  const users = s.users || [], entries = s.entries || [];
  console.log("users:", users.length, "entries:", entries.length, "requests:", (s.requests || []).length);
  // group users by username
  const byName = {};
  users.forEach(u => (byName[u.username] = byName[u.username] || []).push(u));
  const dupNames = Object.keys(byName).filter(k => byName[k].length > 1);
  console.log("duplicated usernames:", dupNames.join(", "));
  // count entries per userId
  const perUser = {};
  entries.forEach(e => (perUser[e.userId] = (perUser[e.userId] || 0) + 1));
  console.log("\nuser detail:");
  dupNames.forEach(n => byName[n].forEach(u => {
    console.log("  " + u.username, "id=" + u.id, "created=" + (u.createdAt || "?"), "hash=" + String(u.hash || "").slice(0, 8), "entries=" + (perUser[u.id] || 0));
  }));
  console.log("\nentry id + userId overview:");
  const seen = {};
  entries.forEach(e => { seen[e.userId] = (seen[e.userId] || 0) + 1; });
  Object.keys(seen).sort().forEach((k, i) => console.log("  userId " + k + " -> " + seen[k] + " shifts"));
  fs.writeFileSync("scripts/out/server-state.json", JSON.stringify(s, null, 2));
  console.log("state saved to scripts/out/server-state.json");
})();
