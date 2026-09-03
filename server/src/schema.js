import { z } from 'zod';

export const STATUSES = ['new', 'accepted', 'writing', 'delivered', 'declined', 'cancelled'];
export const PAYMENT_STATUSES = ['unpaid', 'pending', 'paid', 'refunded'];

const trimmed = (max) => z.string().trim().max(max);
const optionalText = (max) =>
  trimmed(max)
    .optional()
    .transform((v) => (v ? v : null));

export const createRequestSchema = z.object({
  tierId: trimmed(40).min(1),
  addOnIds: z.array(trimmed(40).min(1)).max(10).default([]),

  fanName: trimmed(120).min(1, 'Tell me who this is from'),
  fanEmail: z.string().trim().email('A working email address, please').max(200),
  subject: trimmed(200).min(2, 'Who or what is the song about?'),
  brief: trimmed(4000).min(20, 'A few more details would help - 20 characters minimum'),

  occasion: optionalText(120),
  mustInclude: optionalText(1000),
  avoid: optionalText(1000),
  mood: optionalText(300),
  referenceTracks: optionalText(500),
  neededBy: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .transform((v) => (v ? v : null)),
  sharePublicly: z.boolean().default(false),
});

export const updateRequestSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    paymentRef: z.string().trim().max(200).nullish(),
    artistNotes: z.string().trim().max(4000).nullish(),
    deliveryUrl: z.string().trim().url().max(500).nullish(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });
