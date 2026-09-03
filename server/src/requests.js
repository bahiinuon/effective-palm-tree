import { randomUUID, randomInt } from 'node:crypto';

// No I, O, 0 or 1 - references get read out over the phone and written on tape boxes.
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newReference() {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `SR-${code}`;
}

function toRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentRef: row.payment_ref,
    tierId: row.tier_id,
    addOnIds: JSON.parse(row.add_on_ids),
    currency: row.currency,
    amountMinor: row.amount_minor,
    turnaroundDays: row.turnaround_days,
    fanName: row.fan_name,
    fanEmail: row.fan_email,
    subject: row.subject,
    brief: row.brief,
    occasion: row.occasion,
    mustInclude: row.must_include,
    avoid: row.avoid,
    mood: row.mood,
    referenceTracks: row.reference_tracks,
    neededBy: row.needed_by,
    sharePublicly: Boolean(row.share_publicly),
    artistNotes: row.artist_notes,
    deliveryUrl: row.delivery_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createRequestStore(db) {
  const insert = db.prepare(`
    INSERT INTO requests (
      id, reference, tier_id, add_on_ids, currency, amount_minor, turnaround_days,
      fan_name, fan_email, subject, brief, occasion, must_include, avoid, mood,
      reference_tracks, needed_by, share_publicly, created_at, updated_at
    ) VALUES (
      @id, @reference, @tierId, @addOnIds, @currency, @amountMinor, @turnaroundDays,
      @fanName, @fanEmail, @subject, @brief, @occasion, @mustInclude, @avoid, @mood,
      @referenceTracks, @neededBy, @sharePublicly, @now, @now
    )
  `);

  const selectById = db.prepare('SELECT * FROM requests WHERE id = ?');
  const selectByReference = db.prepare('SELECT * FROM requests WHERE reference = ?');
  const selectByPaymentRef = db.prepare('SELECT * FROM requests WHERE payment_ref = ?');

  return {
    create(input, pricing) {
      const now = new Date().toISOString();

      // A collision is vanishingly unlikely, but a duplicate reference would be
      // confusing forever, so retry rather than hand back a clashing code.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const row = {
          ...input,
          id: randomUUID(),
          reference: newReference(),
          addOnIds: JSON.stringify(pricing.addOns.map((a) => a.id)),
          currency: pricing.currency,
          amountMinor: pricing.amountMinor,
          turnaroundDays: pricing.turnaroundDays,
          sharePublicly: input.sharePublicly ? 1 : 0,
          now,
        };
        try {
          insert.run(row);
          return toRecord(selectById.get(row.id));
        } catch (err) {
          if (!String(err.message).includes('UNIQUE') || attempt === 4) throw err;
        }
      }
      throw new Error('Could not allocate a request reference');
    },

    list({ status, limit = 50, offset = 0 } = {}) {
      const where = status ? 'WHERE status = ?' : '';
      const params = status ? [status, limit, offset] : [limit, offset];
      const rows = db
        .prepare(`SELECT * FROM requests ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
        .all(...params);
      const total = status
        ? db.prepare('SELECT COUNT(*) AS n FROM requests WHERE status = ?').get(status).n
        : db.prepare('SELECT COUNT(*) AS n FROM requests').get().n;
      return { items: rows.map(toRecord), total };
    },

    countsByStatus() {
      const rows = db.prepare('SELECT status, COUNT(*) AS n FROM requests GROUP BY status').all();
      return Object.fromEntries(rows.map((r) => [r.status, r.n]));
    },

    get(id) {
      return toRecord(selectById.get(id));
    },

    getByReference(reference) {
      return toRecord(selectByReference.get(reference));
    },

    // Refund events name a payment intent rather than a request.
    getByPaymentRef(paymentRef) {
      return toRecord(selectByPaymentRef.get(paymentRef));
    },

    update(id, patch) {
      const columns = {
        status: 'status',
        paymentStatus: 'payment_status',
        paymentRef: 'payment_ref',
        artistNotes: 'artist_notes',
        deliveryUrl: 'delivery_url',
      };
      const sets = [];
      const params = {};
      for (const [key, column] of Object.entries(columns)) {
        if (patch[key] !== undefined) {
          sets.push(`${column} = @${key}`);
          params[key] = patch[key];
        }
      }
      if (sets.length === 0) return this.get(id);

      db.prepare(`UPDATE requests SET ${sets.join(', ')}, updated_at = @updatedAt WHERE id = @id`).run({
        ...params,
        id,
        updatedAt: new Date().toISOString(),
      });
      return this.get(id);
    },
  };
}

/** What a fan is allowed to see when they look up their own reference. */
export function publicView(record, catalog) {
  const tier = catalog.tiers.find((t) => t.id === record.tierId);
  return {
    reference: record.reference,
    status: record.status,
    paymentStatus: record.paymentStatus,
    tier: tier ? { id: tier.id, name: tier.name } : { id: record.tierId, name: record.tierId },
    subject: record.subject,
    amountMinor: record.amountMinor,
    currency: record.currency,
    turnaroundDays: record.turnaroundDays,
    deliveryUrl: record.deliveryUrl,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
