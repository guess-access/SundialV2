"use strict";
/* POST /api/sync - fold this device's changes into the shared timesheet and
   send back the full state afterwards.

   Patch shape from the page:
     { users|entries|requests: { put:[...], del:[{id,userId}] }, settings:{...} }

   Who may change what: an admin may change anything; anyone else may only
   touch their own shifts and requests, and their own passcode. */
const store = require("../../lib/store.js");

exports.handler = async (event) => {
  store.connect(event);
  if (event.httpMethod !== "POST") return store.reply(405, { error: "Use POST." });
  try {
    const patch = store.readBody(event);
    const db = await store.loadDb();
    const me = await store.authUser(event, db);

    store.applyPatch(db, patch, me, me.role === "admin");
    await store.saveDb(db);

    return store.reply(200, store.view(db, me.id));
  } catch (e) {
    return store.errorReply(e);
  }
};
