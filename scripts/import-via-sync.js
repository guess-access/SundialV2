/* Import restore-data.json into the live (but not empty) server through
   POST /api/sync as the existing admin. The /api/migrate path wanted an empty
   server, which is gone now that prime.kreatives signed up. */
const fs = require("fs");
const path = require("path");
const base = "https://sundialsolstice.netlify.app";
const { token } = JSON.parse(fs.readFileSync("scripts/out/admin-token.json", "utf8"));
const restore = JSON.parse(fs.readFileSync("scripts/out/restore-data.json", "utf8"));

(async () => {
  const r = await fetch(base + "/api/state", { headers: { authorization: "Bearer " + token } });
  const state = await r.json();
  if (!r.ok) { console.log("state read failed:", r.status, JSON.stringify(state).slice(0, 200)); return; }
  console.log("server now:", (state.users || []).map(u => u.username + "=" + u.role).join(", "));
  console.log("entries on file:", (state.entries || []).length);

  const patch = {
    users: { put: restore.users },
    entries: { put: restore.entries },
    settings: { signup: false, audit: [] }   // door closes once everyone is on file
  };
  const s = await fetch(base + "/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify(patch)
  });
  const body = await s.json();
  if (!s.ok) { console.log("sync failed:", s.status, JSON.stringify(body).slice(0, 300)); return; }
  console.log("sync ok — server now has", (body.users || []).length, "users,", (body.entries || []).length, "entries");
  body.users.forEach(u => console.log("  ", u.username, u.role, "active:", u.active !== false));
})();
