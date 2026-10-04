"use strict";
/* POST /api/login {username, hash} -> {token, userId}
   The browser already hashed the passcode with the salt from /api/salt, so this
   server only ever compares the two hashes. */
const store = require("../../lib/store.js");

function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

exports.handler = async (event) => {
  store.connect(event);
  if (event.httpMethod !== "POST") return store.reply(405, { error: "Use POST." });
  try {
    const body = store.readBody(event);
    const db = await store.loadDb();
    const user = store.findUser(db, body.username);

    if (!user || typeof body.hash !== "string" || !same(user.hash, body.hash)) {
      return store.reply(401, { error: "That username and passcode don't match." });
    }
    if (user.active === false) {
      return store.reply(403, { error: "Your account is switched off. Ask an admin to switch it on." });
    }

    const token = store.issueToken(db, user.id);
    await store.saveDb(db);
    return store.reply(200, { token: token, userId: user.id });
  } catch (e) {
    return store.errorReply(e);
  }
};
