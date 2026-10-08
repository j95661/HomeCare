const FILE_NAME = /^[A-Za-z0-9._-]{1,80}$/;

/** Empty clears the picture. Any other path must be this person's own background file. */
export function isOwnBackgroundPath(uid: string, path: string): boolean {
  if (path === "") return true;
  const prefix = `backgrounds/${uid}/`;
  if (!path.startsWith(prefix)) return false;
  return FILE_NAME.test(path.slice(prefix.length));
}
