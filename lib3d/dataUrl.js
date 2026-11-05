// lib3d/dataUrl.js
// The URL of a static data file under /data. next.config.mjs puts a hash of the data files in NEXT_PUBLIC_DATA_V at build time, so the URL changes exactly when a file does:
// the browser (and the service worker) may then keep a versioned URL for a year without ever serving a stale or mismatched file. Without a version (tests, dev) the plain URL is used.
export const dataUrl = (name) => { const v = process.env.NEXT_PUBLIC_DATA_V; return v ? `/data/${name}?v=${v}` : `/data/${name}`; };
