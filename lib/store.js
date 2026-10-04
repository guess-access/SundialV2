"use strict";

/* Shared storage and request helpers for the Prestige Dealer Alliance timelogs.
 *
 * Storage is Netlify Blobs at site scope, the same service the original backend
 * used (its /api/health payload reported "read / write / conditional", which are
 * Blobs capabilities: read a key, write a key, read only if the ETag changed).
 *
 * The store name and key the original code used are not known from the outside,
 * so on first use we list every store on this site and read the keys inside until
 * we find data shaped like the app state (users / entries / requests / settings).
 * That location is remembered for the life of the function container, and the
 * state is written back to the same place, so existing accounts and timesheets
 * carry on untouched. If nothing is found we start from a blank state on a store
 * named after this repository, and /api/migrate can then be used to move data in.
 */

var COLLECTIONS = ["users", "entries", "requests"];
var DEFAULT_STORE = "sundial-timelogs";
var DEFAULT_KEY = "state";

/* Keys we look for first when scanning for the existing state. */
var CANDIDATE_KEYS = ["state", "data", "db", "app", "root", "main", "store",
  "current", "latest", "shiftclock", "sundial", "timelogs", "state.json", "data.json"];
/* Store names tried if listing the stores on this site is refused. */
var CANDIDATE_STORES = ["state", "data", "db", "app", "main", "store", "shiftclock",
  "shift-clock", "sundial", "sundial-timelogs", "timelogs", "timeclock", "timesheet"];

var MAX_BODY = 5000000;      /* one request never carries more than this */
var MAX_SESSIONS = 100;      /* signed-in devices kept per site */
var MAX_AUDIT = 300;         /* change history kept on the settings record */
var MAX_ENTRY_AUDIT = 20;    /* change history kept on a single shift */

var blobsLib = null;
var where = null;            /* { store, key } once the data has been located */

function lib() {
  if (blobsLib) return blobsLib;
  try {
    blobsLib = require("@netlify/blobs");
  } catch (e) {
    var err = new Error(
      "Storage is not installed on this deploy: build from the git repository so package.json installs @netlify/blobs.");
    err.status = 500;
    err.internal = e;
    throw err;
  }
  return blobsLib;
}

/* Netlify's Lambda runtime hands a v1-style function its Blobs credentials
 * inside the event payload (event.blobs). Until they are passed to the library
 * every store call fails with "The environment has not been configured to use
 * Netlify Blobs", so each handler starts by calling this. Functions that never
 * see such a payload (the local test harness) simply skip it. */
function connect(event) {
  if (!event || event.blobs === undefined || event.blobs === null || event.blobs === "") return;
  try {
    var b = lib();
    if (typeof b.connectLambda === "function") b.connectLambda(event);
  } catch (e) {
    console.error("timelogs: accepting the storage credentials failed:", e && e.message ? e.message : e);
  }
}

function httpError(status, message) {
  var e = new Error(message);
  e.status = status;
  return e;
}

function reply(statusCode, body, extra) {
  var headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (extra) Object.keys(extra).forEach(function (k) { headers[k] = extra[k]; });
  var text = typeof body === "string" ? body : JSON.stringify(body === undefined ? null : body);
  return { statusCode: statusCode, headers: headers, body: text };
}

function errorReply(e) {
  if (e && e.status) return reply(e.status, { error: e.message || "The server refused that change." });
  console.error("timelogs:", e && e.stack ? e.stack : e);
  return reply(500, { error: "The server had a problem just then. Nothing was lost - try again." });
}

function readBody(event) {
  if (!event || !event.body) return {};
  var raw = event.body;
  if (event.isBase64Encoded) {
    try {
      raw = typeof Buffer !== "undefined"
        ? Buffer.from(raw, "base64").toString("utf8")
        : decodeURIComponent(escape(atob(raw)));
    } catch (e) { raw = ""; }
  }
  if (raw.length > MAX_BODY) throw httpError(413, "That save is too big for one request. Reload the page and try again.");
  try {
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    return parsed;
  } catch (e) {
    throw httpError(400, "That request body wasn't valid JSON.");
  }
}

function asList(v) {
  return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === "object"; }) : [];
}

function blankState() {
  return { users: [], entries: [], requests: [], settings: { signup: true }, sessions: {} };
}

/* Accept the state however it was written: arrays, id maps, or wrapped. */
function normalizeState(raw) {
  var x = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (x.state && typeof x.state === "object" && !Array.isArray(x.state) && !Array.isArray(x.users)) x = x.state;
  var out = {};
  COLLECTIONS.forEach(function (c) {
    if (Array.isArray(x[c])) out[c] = x[c].filter(function (i) { return i && typeof i === "object"; });
    else if (x[c] && typeof x[c] === "object") out[c] = Object.keys(x[c]).map(function (k) { return x[c][k]; })
      .filter(function (i) { return i && typeof i === "object"; });
    else out[c] = [];
  });
  out.settings = (x.settings && typeof x.settings === "object" && !Array.isArray(x.settings))
    ? x.settings : { signup: true };
  out.sessions = (x.sessions && typeof x.sessions === "object" && !Array.isArray(x.sessions)) ? x.sessions : {};
  if (Array.isArray(out.settings.audit) && out.settings.audit.length > MAX_AUDIT) {
    out.settings.audit = out.settings.audit.slice(-MAX_AUDIT);
  }
  return out;
}

function looksLikeState(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  if (x.state && typeof x.state === "object" && !Array.isArray(x.users)) return looksLikeState(x.state);
  var users = x.users;
  if (!users || typeof users !== "object") return false;
  var vals = Array.isArray(users) ? users : Object.keys(users).map(function (k) { return users[k]; });
  return vals.some(function (u) {
    return u && typeof u === "object" && typeof u.username === "string" && typeof u.id === "string";
  });
}

function rankKey(k) {
  var i = CANDIDATE_KEYS.indexOf(k);
  return i < 0 ? 999 : i;
}

/* Find whatever the previous backend stored, so its data keeps working. */
async function discover() {
  var b = lib();
  var names = [];
  function add(n) { if (typeof n === "string" && n && names.indexOf(n) === -1) names.push(n); }

  try {
    var listed = await b.listStores();
    (listed.stores || []).forEach(add);
  } catch (e) {
    console.error("timelogs: listing stores failed:", e && e.message ? e.message : e);
  }
  CANDIDATE_STORES.forEach(add);
  if (!names.length) return null;

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var store;
    try { store = b.getStore(name); } catch (e) { continue; }

    var keys = [];
    try {
      var l = await store.list();
      keys = (l.blobs || []).map(function (x) { return x.key; });
    } catch (e) { continue; }
    if (!keys.length) continue;

    keys.sort(function (a, c) { return rankKey(a) - rankKey(c); });

    /* one key holding the whole state */
    for (var k = 0; k < keys.length; k++) {
      var raw = null;
      try { raw = await store.get(keys[k], { type: "json" }); } catch (e) { continue; }
      if (looksLikeState(raw)) return { store: name, key: keys[k] };
    }

    /* or the collections stored one key each */
    var has = function (key) { return keys.indexOf(key) > -1; };
    if (has("users") || has("entries")) {
      var assembled = {};
      var any = false;
      var order = ["users", "entries", "requests", "settings"];
      for (var j = 0; j < order.length; j++) {
        var c = order[j];
        if (!has(c)) continue;
        try { assembled[c] = await store.get(c, { type: "json" }); any = true; } catch (e) {}
      }
      if (any && looksLikeState(assembled)) return { store: name, key: DEFAULT_KEY, split: true, raw: assembled };
    }
  }
  return null;
}

async function loadDb() {
  var b = lib();

  if (where) {
    var existing = await b.getStore(where.store).get(where.key, { type: "json" });
    if (existing && typeof existing === "object") return { state: normalizeState(existing), store: where.store, key: where.key };
    return { state: blankState(), store: where.store, key: where.key };
  }

  var found = await discover();
  if (found) {
    where = { store: found.store, key: found.key };
    if (found.split) {
      /* the collections were stored one key each: fold them into a single key
         right away so the next read finds them there */
      var folded = { state: normalizeState(found.raw), store: found.store, key: found.key };
      await saveDb(folded);
      return folded;
    }
    var raw = await b.getStore(found.store).get(found.key, { type: "json" });
    return { state: normalizeState(raw), store: found.store, key: found.key };
  }

  where = { store: DEFAULT_STORE, key: DEFAULT_KEY };
  return { state: blankState(), store: DEFAULT_STORE, key: DEFAULT_KEY };
}

async function saveDb(db) {
  await lib().getStore(db.store).setJSON(db.key, db.state);
}

/* Storage self-test behind /api/health: can we read, write, and read again
   only when the value changed (the ETag check)? */
async function probe() {
  var out = { node: (typeof process !== "undefined" && process.version) ? process.version : "unknown",
    read: false, write: false, conditional: false, ok: false };
  try {
    var db = await loadDb();
    var store = lib().getStore(db.store);
    var key = "__health";
    await store.set(key, String(Date.now()));
    out.write = true;
    var first = await store.getWithMetadata(key);
    out.read = !!(first && first.etag);
    if (first && first.etag) {
      var again = await store.getWithMetadata(key, { etag: first.etag });
      out.conditional = !!(again && again.etag === first.etag &&
        (again.data === null || again.data === undefined));
    }
    out.ok = out.read && out.write;
  } catch (e) {
    out.reason = e && e.message ? e.message : String(e);
  }
  return out;
}

function tokenFrom(event) {
  var h = (event && event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  var m = /^bearer\s+(.+)$/i.exec(String(h).trim());
  return m ? m[1].trim() : null;
}

/* Sessions are stored as token -> userId, which is also the shape a previous
   backend may have used, so old sign-ins keep working when the data was found. */
function sessionUserId(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return v.userId || v.id || null;
  return null;
}

async function authUser(event, db) {
  var token = tokenFrom(event);
  if (!token) throw httpError(401, "Please sign in.");
  var sessions = db.state.sessions || {};
  var uid = sessionUserId(sessions[token]);
  if (!uid) throw httpError(401, "Please sign in again.");
  var user = asList(db.state.users).filter(function (u) { return u.id === uid; })[0];
  if (!user) throw httpError(401, "Please sign in again.");
  return user;
}

function issueToken(db, userId) {
  var token = randomHex(24);
  db.state.sessions = db.state.sessions || {};
  db.state.sessions[token] = userId;
  var keys = Object.keys(db.state.sessions);
  if (keys.length > MAX_SESSIONS) keys.slice(0, keys.length - MAX_SESSIONS).forEach(function (k) { delete db.state.sessions[k]; });
  return token;
}

function randomHex(bytes) {
  try {
    return require("crypto").randomBytes(bytes).toString("hex");
  } catch (e) {
    var chars = "0123456789abcdef", out = "";
    for (var i = 0; i < bytes * 2; i++) out += chars[Math.floor(Math.random() * 16)];
    return out;
  }
}

function hasOtherActiveAdmin(db, exceptId) {
  return asList(db.state.users).some(function (u) {
    return u.id !== exceptId && u.role === "admin" && u.active !== false;
  });
}

function needsSetup(db) {
  return !asList(db.state.users).some(function (u) { return u.role === "admin" && u.active !== false; });
}

function signupOpen(db) {
  return needsSetup(db) || !(db.state.settings && db.state.settings.signup === false);
}

function findUser(db, username) {
  var wanted = String(username || "").trim().toLowerCase();
  if (!wanted) return null;
  return asList(db.state.users).filter(function (u) {
    return String(u.username || "").toLowerCase() === wanted;
  })[0] || null;
}

/* What a signed-in person is allowed to see: their own passcode hash stays
   private, everyone else's is left out of the response. */
function view(db, selfId) {
  var users = asList(db.state.users).map(function (u) {
    if (!u || u.id === selfId || typeof u.hash !== "string") return u;
    var copy = {};
    Object.keys(u).forEach(function (k) { copy[k] = u[k]; });
    delete copy.hash;
    return copy;
  });
  return {
    users: users,
    entries: asList(db.state.entries),
    requests: asList(db.state.requests),
    settings: (db.state.settings && typeof db.state.settings === "object") ? db.state.settings : { signup: true }
  };
}

/* ---------------- writing changes ---------------- */

function asMapList(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.keys(v).map(function (k) { return v[k]; });
  return [];
}

/* A person's own punches only ever grow: new breaks are added at the end, a
   running break is closed, an open shift is clocked out. Nothing already
   written is moved or removed. */
function pausesOnlyGrew(existing, item) {
  var before = Array.isArray(existing.pauses) ? existing.pauses : [];
  var after = Array.isArray(item.pauses) ? item.pauses : [];
  if (after.length < before.length) return false;
  for (var i = 0; i < before.length; i++) {
    var a = before[i], b = after[i];
    if (!b) return false;
    if (a.type !== b.type || a.start !== b.start) return false;
    if (a.end && a.end !== b.end) return false;
  }
  return true;
}

function putItem(db, coll, item, me, isAdmin) {
  if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id) {
    throw httpError(400, "That change was missing an id.");
  }
  var list = db.state[coll];
  var idx = -1;
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === item.id) { idx = i; break; }
  var existing = idx >= 0 ? list[idx] : null;
  var stored;

  if (coll === "users") {
    if (!isAdmin) {
      /* Accounts and passcodes are an admin's job. Nobody writes their own
         record here, so a person can never change a passcode, a role or a
         schedule without an admin doing it for them. */
      throw httpError(403, "Only an admin can change accounts or passcodes.");
    }
    stored = {};
    /* Start from what is already on file, then lay this save on top: fields the
       page never receives (another person's passcode hash, the sign-up date)
       survive instead of being wiped out by a schedule or role change. */
    if (existing) Object.keys(existing).forEach(function (k) { stored[k] = existing[k]; });
    Object.keys(item).forEach(function (k) { stored[k] = item[k]; });
    if (typeof stored.username === "string") stored.username = stored.username.trim().toLowerCase();
    stored.role = stored.role === "admin" ? "admin" : "staff";
    stored.active = stored.active !== false;
    if (existing && existing.role === "admin" && existing.active !== false) {
      var stillAdmin = (stored.role === "admin") && (stored.active !== false);
      if (!stillAdmin && !hasOtherActiveAdmin(db, existing.id)) {
        throw httpError(403, "Add another admin before switching this one off.");
      }
    }
  } else if (coll === "entries") {
    if (typeof item.userId !== "string" || typeof item.inAt !== "string") {
      throw httpError(400, "That shift wasn't in a format this server understands.");
    }
    if (!isAdmin && item.userId !== me.id) throw httpError(403, "You can only change your own shifts.");
    if (!isAdmin) {
      /* Clocking in, starting a break and clocking out only ever add to a
         shift. Anything that rewrites what is already written - the times, or
         the change history itself - has to come from an admin, so a correction
         is always sent as a request for an admin to approve. */
      var onFile = function (msg) { throw httpError(403, msg); };
      var editMsg = "That shift is already recorded. Send a correction request for an admin to approve.";
      if (existing) {
        if (String(item.inAt) !== String(existing.inAt)) onFile(editMsg);
        if (existing.outAt && String(item.outAt || "") !== String(existing.outAt)) onFile(editMsg);
        if (!pausesOnlyGrew(existing, item)) onFile(editMsg);
      }
      if (Array.isArray(item.audit) && item.audit.length) {
        onFile("Only an admin writes the change history.");
      }
    }
    stored = {};
    Object.keys(item).forEach(function (k) { stored[k] = item[k]; });
    if (Array.isArray(stored.audit) && stored.audit.length > MAX_ENTRY_AUDIT) stored.audit = stored.audit.slice(-MAX_ENTRY_AUDIT);
  } else {
    if (typeof item.userId !== "string") {
      throw httpError(400, "That request wasn't in a format this server understands.");
    }
    if (!isAdmin) {
      if (item.userId !== me.id) throw httpError(403, "You can only change your own requests.");
      /* asking is free and marking one as read is harmless; approving or
         declining - or rewriting who did it - is the admin's call */
      var sameOutcome = existing &&
        String(item.status || "") === String(existing.status || "") &&
        String(item.resolvedBy || "") === String(existing.resolvedBy || "") &&
        String(item.resolvedAt || "") === String(existing.resolvedAt || "");
      if (existing) {
        if (!sameOutcome) throw httpError(403, "Only an admin can approve or decline a request.");
      } else if ((item.status && item.status !== "pending") || item.resolvedBy) {
        throw httpError(403, "Only an admin can approve or decline a request.");
      }
    }
    stored = {};
    Object.keys(item).forEach(function (k) { stored[k] = item[k]; });
  }

  if (idx >= 0) list[idx] = stored; else list.push(stored);
}

function delItem(db, coll, id, me, isAdmin) {
  if (typeof id !== "string" || !id) return;
  var list = db.state[coll];
  var idx = -1;
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) { idx = i; break; }
  if (idx < 0) return;
  var existing = list[idx];

  if (coll === "users") {
    if (!isAdmin) throw httpError(403, "Only an admin can remove people.");
    if (existing.role === "admin" && existing.active !== false && !hasOtherActiveAdmin(db, existing.id)) {
      throw httpError(403, "Add another admin before removing this one.");
    }
  } else if (coll === "entries" && !isAdmin) {
    /* a shift on the record is only ever taken off by an admin */
    throw httpError(403, "Only an admin can delete a shift.");
  } else if (!isAdmin && existing.userId !== me.id) {
    throw httpError(403, "You can only change your own records.");
  }
  list.splice(idx, 1);
}

function applyPatch(db, patch, me, isAdmin) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw httpError(400, "That save wasn't in a format this server understands.");
  }

  COLLECTIONS.forEach(function (coll) {
    var c = patch[coll];
    if (c === undefined || c === null) return;
    if (typeof c !== "object" || Array.isArray(c)) throw httpError(400, "That save wasn't in a format this server understands.");
    asMapList(c.put).forEach(function (item) { putItem(db, coll, item, me, isAdmin); });
    asMapList(c.del).forEach(function (d) { delItem(db, coll, d && d.id, me, isAdmin); });
  });

  if (patch.settings !== undefined && patch.settings !== null) {
    if (!isAdmin) throw httpError(403, "Only an admin can change settings.");
    if (typeof patch.settings !== "object" || Array.isArray(patch.settings)) {
      throw httpError(400, "That save wasn't in a format this server understands.");
    }
    var next = {};
    Object.keys(patch.settings).forEach(function (k) { next[k] = patch.settings[k]; });
    if (Array.isArray(next.audit) && next.audit.length > MAX_AUDIT) next.audit = next.audit.slice(-MAX_AUDIT);
    db.state.settings = next;
  }
}

module.exports = {
  COLLECTIONS: COLLECTIONS,
  DEFAULT_STORE: DEFAULT_STORE,
  DEFAULT_KEY: DEFAULT_KEY,
  connect: connect,
  httpError: httpError,
  reply: reply,
  errorReply: errorReply,
  readBody: readBody,
  asList: asList,
  blankState: blankState,
  normalizeState: normalizeState,
  looksLikeState: looksLikeState,
  loadDb: loadDb,
  saveDb: saveDb,
  probe: probe,
  tokenFrom: tokenFrom,
  authUser: authUser,
  issueToken: issueToken,
  randomHex: randomHex,
  hasOtherActiveAdmin: hasOtherActiveAdmin,
  needsSetup: needsSetup,
  signupOpen: signupOpen,
  findUser: findUser,
  view: view,
  applyPatch: applyPatch
};
