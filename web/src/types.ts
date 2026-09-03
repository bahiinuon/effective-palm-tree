export type Tier = {
  id: string;
  name: string;
  tagline: string;
  priceMinor: number;
  lengthLabel: string;
  turnaroundDays: number;
  revisions: number;
  deliverables: string[];
  sortOrder: number;
};

export type AddOn = {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
};

export type Catalog = {
  currency: string;
  tiers: Tier[];
  addOns: AddOn[];
  payment: PaymentSettings;
};

export type PaymentSettings = {
  provider: 'manual' | 'stripe';
  /** True when the fan pays at the moment they send the brief. */
  chargeUpFront: boolean;
};

export type RequestStatus =
  | 'new'
  | 'accepted'
  | 'writing'
  | 'delivered'
  | 'declined'
  | 'cancelled';

export type PaymentStatus = 'unpaid' | 'pending' | 'paid';

export type PublicRequest = {
  reference: string;
  status: RequestStatus;
  paymentStatus: PaymentStatus;
  tier: { id: string; name: string };
  subject: string;
  amountMinor: number;
  currency: string;
  turnaroundDays: number;
  deliveryUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The artist's view: the raw record, including everything the fan wrote. */
export type AdminRequest = {
  id: string;
  reference: string;
  status: RequestStatus;
  paymentStatus: PaymentStatus;
  paymentRef: string | null;
  tierId: string;
  addOnIds: string[];
  currency: string;
  amountMinor: number;
  turnaroundDays: number;
  createdAt: string;
  updatedAt: string;
  deliveryUrl: string | null;
  subject: string;
  fanName: string;
  fanEmail: string;
  brief: string;
  occasion: string | null;
  mustInclude: string | null;
  avoid: string | null;
  mood: string | null;
  referenceTracks: string | null;
  neededBy: string | null;
  sharePublicly: boolean;
  artistNotes: string | null;
  /** Set the first time the finished song is emailed out, so it only goes once. */
  deliveredEmailAt: string | null;
};

export type FieldError = { path: string; message: string };

export class ApiError extends Error {
  fields: FieldError[];
  status: number;

  constructor(message: string, status: number, fields: FieldError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
  }
}
