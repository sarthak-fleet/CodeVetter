#!/usr/bin/env node
/**
 * Purge codevetter.com HTML from the zone edge cache after a landing deploy.
 * Requires CLOUDFLARE_API_TOKEN with Zone.Cache Purge (+ Zone.Read).
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... node scripts/purge-edge-cache.mjs
 *   CLOUDFLARE_API_TOKEN=... node scripts/purge-edge-cache.mjs --zone-id <id>
 */

const ZONE_ID =
  process.argv.includes('--zone-id')
    ? process.argv[process.argv.indexOf('--zone-id') + 1]
    : process.env.CLOUDFLARE_ZONE_ID_CODEVETTER ?? 'c1e6464302240c22f727ce64262136fe';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!TOKEN) {
  console.error('Set CLOUDFLARE_API_TOKEN (needs Zone.Cache Purge).');
  process.exit(1);
}

const urls = ['https://codevetter.com/', 'https://www.codevetter.com/'];
const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ files: urls }),
});
const json = await res.json();
if (!res.ok || !json.success) {
  console.error('Purge failed:', json.errors?.[0]?.message ?? res.statusText);
  process.exit(1);
}
console.log('Purged:', urls.join(', '));