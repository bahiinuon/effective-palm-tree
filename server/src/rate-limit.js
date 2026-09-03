/**
 * Small fixed-window limiter, in memory. Enough to stop a bored someone
 * flooding the inbox from one browser tab; swap for a shared store if the app
 * ever runs on more than one process.
 */
export function rateLimit({ windowMs = 10 * 60 * 1000, max = 5 } = {}) {
  const hits = new Map();

  return function limiter(req, res, next) {
    const now = Date.now();
    const key = req.ip ?? 'unknown';

    for (const [ip, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(ip);
    }

    const entry = hits.get(key) ?? { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    hits.set(key, entry);

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'too_many_requests',
        message: `That's a lot of songs at once. Try again in ${Math.ceil(retryAfter / 60)} minutes.`,
      });
    }
    return next();
  };
}
