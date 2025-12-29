import express from 'express';

// Simple in-memory rate limiter
// For production, consider using redis-based rate limiting (e.g., express-rate-limit with redis store)

type RateLimitStore ={
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

// Clean up old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  Object.keys(store).forEach((key) => {
    if (store[key].resetTime < now) {
      delete store[key];
    }
  });
}, 10 * 60 * 1000);

export const createRateLimiter = (options: {
  windowMs: number;  // Time window in milliseconds
  max: number;       // Max requests per window
  message?: string;  // Custom error message
  keyGenerator?: (req: express.Request) => string;  // Custom key generator
}) => {
  const {
    windowMs,
    max,
    message = 'Too many requests, please try again later.',
    keyGenerator = (req) => {
      // Default: Use user ID if authenticated, otherwise IP address
      const userId = (req as any).user?.userId;
      return userId ? `user:${userId}` : `ip:${req.ip}`;
    }
  } = options;

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = keyGenerator(req);
    const now = Date.now();

    if (!store[key] || store[key].resetTime < now) {
      // First request or window expired
      store[key] = {
        count: 1,
        resetTime: now + windowMs
      };
      return next();
    }

    store[key].count += 1;

    if (store[key].count > max) {
      const retryAfter = Math.ceil((store[key].resetTime - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: message,
        retryAfter
      });
    }

    next();
  };
};

// Payment endpoint rate limiter: 10 requests per 15 minutes per user
export const paymentRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many payment requests. Please try again in a few minutes.'
});

// Webhook rate limiter: More permissive, per IP
export const webhookRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Stripe can send multiple webhooks in quick succession
  message: 'Webhook rate limit exceeded',
  keyGenerator: (req) => `webhook:${req.ip}`
});

// Public session creation rate limiter: 5 requests per 15 minutes per IP
// Prevents spam session creation
export const pendingSessionRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many session requests. Please try again later.',
  keyGenerator: (req) => `pending-session:${req.ip}`
});

// Public session lookup rate limiter: 20 requests per minute per IP
// Prevents token enumeration attacks
export const sessionLookupRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20,
  message: 'Too many requests. Please slow down.',
  keyGenerator: (req) => `session-lookup:${req.ip}`
});
