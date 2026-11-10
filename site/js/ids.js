/** Sequential ids such as A0001. Numbers are never reused while next_id only moves forward. */

export function formatId(prefix, n) {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid ${prefix} id number: ${n}`);
  }
  return `${prefix}${String(n).padStart(4, "0")}`;
}

export function parseId(id, prefix) {
  if (typeof id !== "string" || !id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  if (!/^[0-9]+$/.test(rest)) return null;
  const n = Number(rest);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * Assign the next id for a collection.
 * `next_id` wins when it is ahead of the rows still in the file, so a deleted
 * high id is not handed out again. Existing rows are scanned so a stale
 * next_id cannot collide with an id that is already there.
 */
export function allocateId(doc, prefix, collectionKey) {
  let highest = 0;
  const stored = Number(doc.next_id);
  if (Number.isInteger(stored) && stored > 1) highest = stored - 1;
  for (const item of doc[collectionKey] || []) {
    const n = parseId(item?.id, prefix);
    if (n != null && n > highest) highest = n;
  }
  const assigned = highest + 1;
  return { id: formatId(prefix, assigned), next_id: assigned + 1 };
}
