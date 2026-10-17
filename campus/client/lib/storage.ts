const PREFIX = "campuslife:";
const LEGACY_PREFIX = "oaulife:";

export const STORAGE_KEYS = {
  session: `${PREFIX}session`,
  deviceKey: `${PREFIX}key`,
  username: `${PREFIX}username`,
  background: `${PREFIX}bg`,
  look: `${PREFIX}look`,
  school: `${PREFIX}school`,
  level: `${PREFIX}level`,
  department: `${PREFIX}department`,
  controls: `${PREFIX}controls`,
  sound: `${PREFIX}sound`,
  camera: `${PREFIX}camera`,
  resume: `${PREFIX}resume`,
  gist: `${PREFIX}gist`,
  delivery: `${PREFIX}delivery`,
} as const;

function migrate(storage: Storage) {
  const legacy: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(LEGACY_PREFIX)) legacy.push(key);
  }
  for (const key of legacy) {
    const next = PREFIX + key.slice(LEGACY_PREFIX.length);
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(next) === null) storage.setItem(next, value);
    storage.removeItem(key);
  }
}

if (typeof window !== "undefined") {
  try {
    migrate(window.localStorage);
    migrate(window.sessionStorage);
  } catch {
    /* storage unavailable */
  }
}
