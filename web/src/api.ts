import { ApiError } from './types';
import type { AdminRequest, Catalog, PublicRequest, RequestStatus } from './types';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      body.message ?? `Request failed (${res.status})`,
      res.status,
      body.fields ?? [],
    );
  }
  return body as T;
}

export const getCatalog = () => request<Catalog>('/api/catalog');

export type NewRequestInput = {
  tierId: string;
  addOnIds: string[];
  fanName: string;
  fanEmail: string;
  subject: string;
  brief: string;
  occasion?: string;
  mustInclude?: string;
  avoid?: string;
  mood?: string;
  referenceTracks?: string;
  neededBy?: string;
  sharePublicly: boolean;
};

export type PaymentOutcome = {
  provider: string;
  status: string;
  instructions?: string;
  /** Present when the provider wants the fan sent to a hosted checkout. */
  checkoutUrl?: string;
};

export const submitRequest = (input: NewRequestInput) =>
  request<{ request: PublicRequest; payment: PaymentOutcome }>('/api/requests', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const lookupRequest = (reference: string, email: string) =>
  request<{ request: PublicRequest }>(
    `/api/requests/${encodeURIComponent(reference)}?email=${encodeURIComponent(email)}`,
  );

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export const adminList = (token: string, status?: RequestStatus | '') =>
  request<{ items: AdminRequest[]; total: number; counts: Record<string, number> }>(
    `/api/admin/requests${status ? `?status=${status}` : ''}`,
    { headers: auth(token) },
  );

export const adminUpdate = (
  token: string,
  id: string,
  patch: Partial<{
    status: RequestStatus;
    paymentStatus: string;
    artistNotes: string | null;
    deliveryUrl: string | null;
  }>,
) =>
  request<{ request: AdminRequest }>(`/api/admin/requests/${id}`, {
    method: 'PATCH',
    headers: auth(token),
    body: JSON.stringify(patch),
  });

export const adminCreateCheckout = (token: string, id: string) =>
  request<{ request: AdminRequest; checkoutUrl: string }>(`/api/admin/requests/${id}/checkout`, {
    method: 'POST',
    headers: auth(token),
  });

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
  }).format(amountMinor / 100);
}
