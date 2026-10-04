"use strict";
/* POST /api/migrate - one-time move of an old browser's local data onto this
   server, allowed only while the server is still empty (otherwise 409, which the
   page reads as "no setup needed"). It is also the way to seed this deployment
   with a backup taken from another deployment. */
const store = require("../../lib/store.js");

exports.handler = async (event) => {
  store.connect(event);
  if (event.httpMethod !== "POST") return store.reply(405, { error: "Use POST." });
  try {
    const body = store.readBody(event);
    const db = await store.loadDb();

    if (store.asList(db.state.users).length > 0) {
      return store.reply(409, { error: "This server already has accounts on it." });
    }

    const users = store.asList(body.users);
    const entries = store.asList(body.entries);
    const requests = store.asList(body.requests);

    if (users.some((u) => typeof u.id !== "string" || typeof u.username !== "string")) {
      return store.reply(400, { error: "That backup wasn't in a format this server understands." });
    }

    const settings = (body.settings && typeof body.settings === "object" && !Array.isArray(body.settings))
      ? body.settings : { signup: true };
    if (Array.isArray(settings.audit) && settings.audit.length > 300) settings.audit = settings.audit.slice(-300);

    db.state = { users: users, entries: entries, requests: requests, settings: settings, sessions: {} };

    const sid = typeof body.sessionUserId === "string" ? body.sessionUserId : null;
    const me = sid ? users.filter((u) => u.id === sid)[0] : null;
    const token = me ? store.issueToken(db, me.id) : null;

    await store.saveDb(db);
    return store.reply(200, token ? { token: token, userId: me.id } : { ok: true });
  } catch (e) {
    return store.errorReply(e);
  }
};
