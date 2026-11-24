"use strict";
/* POST /api/logout - drops this device's sign-in token. */
const store = require("../../lib/store.js");

exports.handler = async (event) => {
  store.connect(event);
  if (event.httpMethod !== "POST") return store.reply(405, { error: "Use POST." });
  try {
    const token = store.tokenFrom(event);
    await store.update(event, async (db) => {
      if (token && db.state.sessions && db.state.sessions[token]) delete db.state.sessions[token];
      else db.dirty = false;
    });
    return store.reply(200, { ok: true });
  } catch (e) {
    return store.errorReply(e);
  }
};
