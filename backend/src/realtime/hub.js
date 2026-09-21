'use strict';

/** In-memory SSE hub (single Node process). */
const byUser = new Map();

function subscribe(userId, res) {
  const uid = String(userId || '');
  if (!uid) return () => {};
  let set = byUser.get(uid);
  if (!set) {
    set = new Set();
    byUser.set(uid, set);
  }
  set.add(res);
  return () => {
    set.delete(res);
    if (!set.size) byUser.delete(uid);
  };
}

function publish(userId, eventName, data) {
  const set = byUser.get(String(userId || ''));
  if (!set || !set.size) return 0;
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data || {})}\n\n`;
  let n = 0;
  for (const res of [...set]) {
    try {
      res.write(payload);
      n += 1;
    } catch {
      set.delete(res);
    }
  }
  if (!set.size) byUser.delete(String(userId));
  return n;
}

function publishMany(userIds, eventName, data) {
  const seen = new Set();
  let n = 0;
  for (const uid of userIds || []) {
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    n += publish(uid, eventName, data);
  }
  return n;
}

function connectedCount(userId) {
  const set = byUser.get(String(userId || ''));
  return set ? set.size : 0;
}

module.exports = { subscribe, publish, publishMany, connectedCount };
