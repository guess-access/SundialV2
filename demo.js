/* Demo backend for the Sundial site - used only when no /api server answers.
 *
 * On plain static hosting (GitHub Pages) the Netlify functions are absent, so
 * /api/status answers 404. Both pages then talk to this instead: the same nine
 * endpoints, the same validation, the same permission rules, the same admin /
 * staff views - but the data lives in this browser's localStorage and the
 * sign-in is demo-grade, not real security. Anyone with the device can read
 * it. It exists so the rota can be tried end to end; production stays on the
 * Netlify backend, which always wins when it answers.
 *
 * Demo accounts (documented in the README, shown as a hint on the sign-in):
 *   admin / admin1234  -> admin view (Team, payroll, schedules, exports)
 *   demo  / demo1234   -> staff view (Clock, My timesheet, requests)
 * Sign-ups stay open, so real accounts can be added beside them.
 */
var Demo = (function () {
  "use strict";

  var KEY = "sundial.demo.db";
  var MAX_SESSIONS = 100;
  var MAX_AUDIT = 300;
  var MAX_ENTRY_AUDIT = 20;
  var USER_RE = /^[a-z0-9._-]{3,20}$/;

  var seeded = null; /* promise: seed accounts exist */

  function blank() {
    return { users: [], entries: [], requests: [], settings: { signup: true }, sessions: {} };
  }
  function asList(v) {
    return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === "object"; }) : [];
  }
  function load() {
    var db = null;
    try { db = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { db = null; }
    if (!db || typeof db !== "object" || Array.isArray(db)) return { fresh: true, db: blank() };
    return {
      fresh: false,
      db: {
        users: asList(db.users),
        entries: asList(db.entries),
        requests: asList(db.requests),
        settings: (db.settings && typeof db.settings === "object" && !Array.isArray(db.settings)) ? db.settings : { signup: true },
        sessions: (db.sessions && typeof db.sessions === "object" && !Array.isArray(db.sessions)) ? db.sessions : {}
      }
    };
  }
  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
  }
  function randHex(n) {
    var a = new Uint8Array(n), i;
    if (self.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function weakHash(str) {
    var h1 = 0x811c9dc5, h2 = 0x1b873593;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = (h1 ^ c) * 16777619 >>> 0;
      h2 = ((h2 + c) * 2654435761 ^ (h2 >>> 5)) >>> 0;
    }
    return ("00000000" + h1.toString(16)).slice(-8) + ("00000000" + h2.toString(16)).slice(-8);
  }
  function sha(pin, salt) {
    var msg = salt + "|" + pin;
    if (self.crypto && crypto.subtle && crypto.subtle.digest && self.isSecureContext) {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
      }).catch(function () { return "w:" + weakHash(msg); });
    }
    return Promise.resolve("w:" + weakHash(msg));
  }
  /* A name with no account still gets a stable salt, so the answer never
     reveals who has an account - same promise the server makes. */
  function stableSalt(name) {
    var s = "no-such-user:" + name;
    if (self.crypto && crypto.subtle && crypto.subtle.digest && self.isSecureContext) {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("").slice(0, 24);
      }).catch(function () { return weakHash(s).slice(0, 8); });
    }
    return Promise.resolve(weakHash(s).slice(0, 8));
  }
  function fail(status, message) {
    var e = new Error(message); e.status = status;
    return Promise.reject(e);
  }
  function same(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
  function findUser(db, username) {
    var wanted = String(username || "").trim().toLowerCase();
    if (!wanted) return null;
    return asList(db.users).filter(function (u) {
      return String(u.username || "").toLowerCase() === wanted;
    })[0] || null;
  }
  function needsSetup(db) {
    return !asList(db.users).some(function (u) { return u.role === "admin" && u.active !== false; });
  }
  function signupOpen(db) {
    return needsSetup(db) || !(db.settings && db.settings.signup === false);
  }
  function issueToken(db, userId) {
    var token = randHex(24);
    db.sessions = db.sessions || {};
    db.sessions[token] = userId;
    var keys = Object.keys(db.sessions);
    if (keys.length > MAX_SESSIONS) keys.slice(0, keys.length - MAX_SESSIONS).forEach(function (k) { delete db.sessions[k]; });
    return token;
  }
  function me(db, token) {
    var uid = token && db.sessions ? db.sessions[token] : null;
    if (typeof uid !== "string" || !uid) return null;
    return asList(db.users).filter(function (u) { return u.id === uid; })[0] || null;
  }
  /* What a signed-in person may see: everyone else's passcode hash is left out. */
  function view(db, selfId) {
    var users = asList(db.users).map(function (u) {
      if (!u || u.id === selfId || typeof u.hash !== "string") return u;
      var copy = {};
      Object.keys(u).forEach(function (k) { copy[k] = u[k]; });
      delete copy.hash;
      return copy;
    });
    return {
      users: users,
      entries: asList(db.entries),
      requests: asList(db.requests),
      settings: (db.settings && typeof db.settings === "object") ? db.settings : { signup: true }
    };
  }
  function hasOtherActiveAdmin(db, exceptId) {
    return asList(db.users).some(function (u) {
      return u.id !== exceptId && u.role === "admin" && u.active !== false;
    });
  }
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
  function putItem(db, coll, item, self, isAdmin) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id) {
      var e400 = new Error("That change was missing an id."); e400.status = 400; throw e400;
    }
    var list = db[coll], idx = -1, i;
    for (i = 0; i < list.length; i++) if (list[i] && list[i].id === item.id) { idx = i; break; }
    var existing = idx >= 0 ? list[idx] : null;
    var stored, k;
    function deny(status, msg) { var e = new Error(msg); e.status = status; throw e; }

    if (coll === "users") {
      if (!isAdmin) deny(403, "Only an admin can change accounts or passcodes.");
      stored = {};
      if (existing) Object.keys(existing).forEach(function (k) { stored[k] = existing[k]; });
      Object.keys(item).forEach(function (k) { stored[k] = item[k]; });
      if (typeof stored.username === "string") stored.username = stored.username.trim().toLowerCase();
      stored.role = stored.role === "admin" ? "admin" : "staff";
      stored.active = stored.active !== false;
      if (existing && existing.role === "admin" && existing.active !== false) {
        var stillAdmin = (stored.role === "admin") && (stored.active !== false);
        if (!stillAdmin && !hasOtherActiveAdmin(db, existing.id)) {
          deny(403, "Add another admin before switching this one off.");
        }
      }
    } else if (coll === "entries") {
      if (typeof item.userId !== "string" || typeof item.inAt !== "string") {
        deny(400, "That shift wasn't in a format this server understands.");
      }
      if (!isAdmin && item.userId !== self.id) deny(403, "You can only change your own shifts.");
      if (!isAdmin) {
        var editMsg = "That shift is already recorded. Send a correction request for an admin to approve.";
        if (existing) {
          if (String(item.inAt) !== String(existing.inAt)) deny(403, editMsg);
          if (existing.outAt && String(item.outAt || "") !== String(existing.outAt)) deny(403, editMsg);
          if (!pausesOnlyGrew(existing, item)) deny(403, editMsg);
        }
        if (Array.isArray(item.audit) && item.audit.length) deny(403, "Only an admin writes the change history.");
      }
      stored = {};
      Object.keys(item).forEach(function (k) { stored[k] = item[k]; });
      if (Array.isArray(stored.audit) && stored.audit.length > MAX_ENTRY_AUDIT) stored.audit = stored.audit.slice(-MAX_ENTRY_AUDIT);
    } else {
      if (typeof item.userId !== "string") deny(400, "That request wasn't in a format this server understands.");
      if (!isAdmin) {
        if (item.userId !== self.id) deny(403, "You can only change your own requests.");
        var sameOutcome = existing &&
          String(item.status || "") === String(existing.status || "") &&
          String(item.resolvedBy || "") === String(existing.resolvedBy || "") &&
          String(item.resolvedAt || "") === String(existing.resolvedAt || "");
        if (existing) {
          if (!sameOutcome) deny(403, "Only an admin can approve or decline a request.");
        } else if ((item.status && item.status !== "pending") || item.resolvedBy) {
          deny(403, "Only an admin can approve or decline a request.");
        }
      }
      stored = {};
      Object.keys(item).forEach(function (k) { stored[k] = item[k]; });
    }
    if (idx >= 0) list[idx] = stored; else list.push(stored);
  }
  function delItem(db, coll, id, self, isAdmin) {
    if (typeof id !== "string" || !id) return;
    var list = db[coll], idx = -1, i;
    for (i = 0; i < list.length; i++) if (list[i] && list[i].id === id) { idx = i; break; }
    if (idx < 0) return;
    var existing = list[idx];
    function deny(status, msg) { var e = new Error(msg); e.status = status; throw e; }
    if (coll === "users") {
      if (!isAdmin) deny(403, "Only an admin can remove people.");
      if (existing.role === "admin" && existing.active !== false && !hasOtherActiveAdmin(db, existing.id)) {
        deny(403, "Add another admin before removing this one.");
      }
    } else if (coll === "entries" && !isAdmin) {
      deny(403, "Only an admin can delete a shift.");
    } else if (!isAdmin && existing.userId !== self.id) {
      deny(403, "You can only change your own records.");
    }
    list.splice(idx, 1);
  }
  function applyPatch(db, patch, self, isAdmin) {
    function bad() { var e = new Error("That save wasn't in a format this server understands."); e.status = 400; throw e; }
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) bad();
    ["users", "entries", "requests"].forEach(function (coll) {
      var c = patch[coll];
      if (c === undefined || c === null) return;
      if (typeof c !== "object" || Array.isArray(c)) bad();
      asList(c.put).forEach(function (item) { putItem(db, coll, item, self, isAdmin); });
      asList(c.del).forEach(function (d) { delItem(db, coll, d && d.id, self, isAdmin); });
    });
    if (patch.settings !== undefined && patch.settings !== null) {
      if (!isAdmin) { var e = new Error("Only an admin can change settings."); e.status = 403; throw e; }
      if (typeof patch.settings !== "object" || Array.isArray(patch.settings)) bad();
      var next = {};
      Object.keys(patch.settings).forEach(function (k) { next[k] = patch.settings[k]; });
      if (Array.isArray(next.audit) && next.audit.length > MAX_AUDIT) next.audit = next.audit.slice(-MAX_AUDIT);
      db.settings = next;
    }
  }

  /* Seed accounts on a brand-new demo database. Salts are random per browser;
     hashes use the same scheme the app sends, so login compares like for like. */
  function seed(db) {
    function mk(username, name, role, pass) {
      var salt = randHex(12);
      return sha(pass, salt).then(function (h) {
        db.users.push({
          id: "u" + Date.now().toString(36) + randHex(3),
          username: username, name: name, salt: salt, hash: h,
          role: role, createdAt: new Date().toISOString(), active: true, sched: null
        });
      });
    }
    return mk("admin", "Site Admin", "admin", "admin1234").then(function () {
      return mk("demo", "Demo User", "staff", "demo1234");
    }).then(function () { save(db); });
  }
  function ensureSeed() {
    if (!seeded) {
      seeded = Promise.resolve().then(function () {
        var loaded = load();
        if (!loaded.fresh) return loaded.db;
        var db = loaded.db;
        return seed(db).then(function () { return db; });
      });
    }
    return seeded;
  }
  function withDb(fn) {
    return ensureSeed().then(function () {
      var loaded = load();
      var out = fn(loaded.db);
      save(loaded.db);
      return out;
    });
  }

  function call(method, path, body, token) {
    var q = String(path || "").split("?");
    var route = q[0];
    var params = {};
    (q[1] || "").split("&").forEach(function (pair) {
      var kv = pair.split("=");
      if (kv[0]) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
    });
    if (method === "GET" && route === "/status") {
      return withDb(function (db) {
        return { needsSetup: needsSetup(db), signup: signupOpen(db) };
      });
    }
    if (method === "GET" && route === "/salt") {
      return withDb(function (db) {
        var wanted = String(params.u || "").trim().toLowerCase();
        var user = findUser(db, wanted);
        var salt = (user && typeof user.salt === "string" && user.salt) ? user.salt : null;
        if (salt) return { salt: salt };
        return stableSalt(wanted).then(function (s) { return { salt: s }; });
      }).then(function (r) { return (r && typeof r.then === "function") ? r : r; });
    }
    if (method === "GET" && route === "/health") {
      return Promise.resolve({ node: "browser", read: true, write: true, conditional: false, ok: true, demo: true });
    }
    if (method === "POST" && route === "/signup") {
      return withDb(function (db) {
        var username = String((body && body.username) || "").trim().toLowerCase();
        var name = String((body && body.name) || "").trim();
        var salt = (body && typeof body.salt === "string") ? body.salt : "";
        var hash = (body && typeof body.hash === "string") ? body.hash : "";
        function deny(status, msg) { var e = new Error(msg); e.status = status; throw e; }
        if (!USER_RE.test(username)) deny(400, "Usernames are 3-20 characters: letters, numbers, dot, dash or underscore.");
        if (name.length < 2) deny(400, "Enter the name that should appear on the timesheet.");
        if (!salt || salt.length > 200 || !hash || hash.length > 200) deny(400, "That sign-up wasn't complete - try it again.");
        if (!signupOpen(db)) deny(403, "Signups are turned off - ask your admin to add you.");
        if (findUser(db, username)) deny(409, "That username is taken.");
        var first = needsSetup(db);
        var user = {
          id: "u" + Date.now().toString(36) + randHex(3),
          username: username, name: name, salt: salt, hash: hash,
          role: first ? "admin" : "staff",
          createdAt: new Date().toISOString(), active: true, sched: null
        };
        db.users.push(user);
        return { token: issueToken(db, user.id), userId: user.id };
      });
    }
    if (method === "POST" && route === "/login") {
      return withDb(function (db) {
        var user = findUser(db, body && body.username);
        if (!user || typeof (body && body.hash) !== "string" || !same(user.hash, body.hash)) {
          return fail(401, "That username and passcode don't match.");
        }
        if (user.active === false) {
          return fail(403, "Your account is switched off. Ask an admin to switch it on.");
        }
        return { token: issueToken(db, user.id), userId: user.id };
      }).then(function (r) { return (r && typeof r.then === "function") ? r : r; });
    }
    if (method === "POST" && route === "/logout") {
      return withDb(function (db) {
        if (token && db.sessions && db.sessions[token]) delete db.sessions[token];
        return { ok: true };
      });
    }
    if (method === "GET" && route === "/state") {
      return withDb(function (db) {
        var self = me(db, token);
        if (!self) return fail(401, "Please sign in again.");
        return view(db, self.id);
      }).then(function (r) { return (r && typeof r.then === "function") ? r : r; });
    }
    if (method === "POST" && route === "/sync") {
      return withDb(function (db) {
        var self = me(db, token);
        if (!self) return fail(401, "Please sign in again.");
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return fail(400, "That save wasn't in a format this server understands.");
        }
        try {
          applyPatch(db, body, self, self.role === "admin");
        } catch (e) {
          return fail(e.status || 500, e.message);
        }
        return view(db, self.id);
      }).then(function (r) { return (r && typeof r.then === "function") ? r : r; });
    }
    if (method === "POST" && route === "/migrate") {
      return withDb(function (db) {
        if (asList(db.users).length > 0) return fail(409, "This server already has accounts on it.");
        var users = asList(body && body.users);
        if (users.some(function (u) { return typeof u.id !== "string" || typeof u.username !== "string"; })) {
          return fail(400, "That backup wasn't in a format this server understands.");
        }
        var settings = (body && body.settings && typeof body.settings === "object" && !Array.isArray(body.settings))
          ? body.settings : { signup: true };
        if (Array.isArray(settings.audit) && settings.audit.length > MAX_AUDIT) settings.audit = settings.audit.slice(-MAX_AUDIT);
        db.users = users;
        db.entries = asList(body && body.entries);
        db.requests = asList(body && body.requests);
        db.settings = settings;
        db.sessions = {};
        var sid = body && typeof body.sessionUserId === "string" ? body.sessionUserId : null;
        var who = sid ? users.filter(function (u) { return u.id === sid; })[0] : null;
        if (!who) return { ok: true };
        return { token: issueToken(db, who.id), userId: who.id };
      }).then(function (r) { return (r && typeof r.then === "function") ? r : r; });
    }
    return fail(404, "Unknown demo endpoint.");
  }

  return {
    active: false, /* set by the page once /api is known missing */
    call: call,
    _db: function () { return load().db; } /* tests and debugging only */
  };
})();
