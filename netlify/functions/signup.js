"use strict";
/* POST /api/signup {username, name, salt, hash} -> {token, userId}
   The very first account becomes the admin; after that sign-ups follow the
   "anyone can create an account" setting the admin controls. */
const store = require("../../lib/store.js");

const USER_RE = /^[a-z0-9._-]{3,20}$/;

exports.handler = async (event) => {
  store.connect(event);
  if (event.httpMethod !== "POST") return store.reply(405, { error: "Use POST." });
  try {
    const body = store.readBody(event);
    const db = await store.loadDb();

    const username = String(body.username || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const salt = typeof body.salt === "string" ? body.salt : "";
    const hash = typeof body.hash === "string" ? body.hash : "";

    if (!USER_RE.test(username)) {
      return store.reply(400, { error: "Usernames are 3-20 characters: letters, numbers, dot, dash or underscore." });
    }
    if (name.length < 2) {
      return store.reply(400, { error: "Enter the name that should appear on the timesheet." });
    }
    if (!salt || salt.length > 200 || !hash || hash.length > 200) {
      return store.reply(400, { error: "That sign-up wasn't complete - try it again." });
    }
    if (!store.signupOpen(db)) {
      return store.reply(403, { error: "Signups are turned off - ask your admin to add you." });
    }
    if (store.findUser(db, username)) {
      return store.reply(409, { error: "That username is taken." });
    }

    const first = store.needsSetup(db);
    const user = {
      id: "u" + Date.now().toString(36) + store.randomHex(3),
      username: username,
      name: name,
      salt: salt,
      hash: hash,
      role: first ? "admin" : "staff",
      createdAt: new Date().toISOString(),
      active: true,
      sched: null
    };
    db.state.users.push(user);
    const token = store.issueToken(db, user.id);
    await store.saveDb(db);
    return store.reply(200, { token: token, userId: user.id });
  } catch (e) {
    return store.errorReply(e);
  }
};
