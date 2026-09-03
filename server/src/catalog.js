import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const tierSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  tagline: z.string().min(1),
  priceMinor: z.number().int().nonnegative(),
  lengthLabel: z.string().min(1),
  turnaroundDays: z.number().int().positive(),
  revisions: z.number().int().nonnegative(),
  deliverables: z.array(z.string().min(1)).min(1),
  sortOrder: z.number().int(),
});

const addOnSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  priceMinor: z.number().int().nonnegative(),
});

const catalogSchema = z.object({
  currency: z.string().length(3),
  tiers: z.array(tierSchema).min(1),
  addOns: z.array(addOnSchema).default([]),
});

const defaultCatalogPath = fileURLToPath(new URL('../config/tiers.json', import.meta.url));

/**
 * The catalog is a data file rather than code so prices and copy can change
 * without a deploy. It is validated on load: a broken file fails at boot,
 * not on a fan's first request.
 */
export function loadCatalog(path = process.env.CATALOG_FILE || defaultCatalogPath) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const catalog = catalogSchema.parse(raw);
  catalog.tiers.sort((a, b) => a.sortOrder - b.sortOrder);

  const ids = new Set();
  for (const tier of catalog.tiers) {
    if (ids.has(tier.id)) throw new Error(`Duplicate tier id: ${tier.id}`);
    ids.add(tier.id);
  }
  return catalog;
}

export function findTier(catalog, tierId) {
  return catalog.tiers.find((t) => t.id === tierId) ?? null;
}

/**
 * Prices are always recomputed here from the catalog. Whatever total the
 * browser shows is display only — it never reaches the database.
 */
export function priceRequest(catalog, tierId, addOnIds = []) {
  const tier = findTier(catalog, tierId);
  if (!tier) throw new Error(`Unknown tier: ${tierId}`);

  const unique = [...new Set(addOnIds)];
  const addOns = unique.map((id) => {
    const addOn = catalog.addOns.find((a) => a.id === id);
    if (!addOn) throw new Error(`Unknown add-on: ${id}`);
    return addOn;
  });

  const rushed = unique.includes('rush');
  return {
    tier,
    addOns,
    currency: catalog.currency,
    amountMinor: tier.priceMinor + addOns.reduce((sum, a) => sum + a.priceMinor, 0),
    turnaroundDays: rushed ? Math.max(1, Math.ceil(tier.turnaroundDays / 2)) : tier.turnaroundDays,
  };
}

export function formatMoney(amountMinor, currency) {
  // Round amounts read better without the trailing zeros - and this matches
  // what the site itself shows, so the two never disagree in front of a fan.
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
  }).format(amountMinor / 100);
}
