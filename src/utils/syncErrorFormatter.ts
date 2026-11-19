import { SyncStatus } from '@/types';

const TRANSIENT_ERROR_CODES = new Set([
  'NETWORK_TIMEOUT',
  'NETWORK_ERROR',
  'OFFLINE',
  'MEDIA_UPLOAD_FAILED',
  'SERVICE_UNAVAILABLE',
  'GATEWAY_TIMEOUT',
  'RATE_LIMITED',
]);

/**
 * Determines whether a sync error is transient (network, timeout, 5xx, 429)
 * and should remain queued for automatic retry rather than being quarantined.
 */
export function isTransientSyncError(error: any): boolean {
  if (!error) return true;

  const status = Number(error?.status ?? error?.response?.status ?? 0);
  if (status === 0 || status === 408 || status === 429 || (status >= 500 && status <= 599)) {
    return true;
  }

  const code = String(error?.data?.code || error?.code || '').toUpperCase();
  if (TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }

  const msg = String(error?.message || '').toLowerCase();
  if (
    msg.includes('timeout') ||
    msg.includes('offline') ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('aborted') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound')
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts a normalized error code from an API error or network exception.
 */
export function extractSyncErrorCode(error: any, fallback: string = 'SYNC_FAILED'): string {
  const backendCode = error?.data?.code || error?.code;
  if (backendCode && typeof backendCode === 'string') {
    return backendCode.toUpperCase();
  }

  const status = Number(error?.status ?? 0);
  if (status === 408) return 'NETWORK_TIMEOUT';
  if (status === 0) return 'NETWORK_ERROR';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return `HTTP_${status}`;
  if (status >= 400) return `HTTP_${status}`;

  return fallback;
}

export interface FormattedSyncStatus {
  label: string;
  tone: 'synced' | 'pending' | 'error';
  summary: string;
  detail?: string;
}

function cleanRawMessage(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/^HTTP\s+\d+:\s*/i, '').trim();
  return cleaned || undefined;
}

/**
 * Translates sync status, error codes, and server messages into clear,
 * natural-language copy for the UI.
 */
export function formatSyncStatus(
  syncStatus?: SyncStatus | string | null,
  errorCode?: string | null,
  errorMessage?: string | null,
  syncedAt?: string | null
): FormattedSyncStatus {
  const status = (syncStatus || 'PENDING').toUpperCase();
  const code = (errorCode || '').toUpperCase();
  const cleanedMsg = cleanRawMessage(errorMessage);

  if (status === 'SYNCED') {
    const syncedTime = syncedAt
      ? new Date(syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : null;
    return {
      label: 'Synced',
      tone: 'synced',
      summary: syncedTime ? `Uploaded at ${syncedTime}.` : 'Uploaded to server.',
    };
  }

  if (status === 'QUARANTINED') {
    let summary = 'This order could not be uploaded to the server.';
    let detail = cleanedMsg;

    switch (code) {
      case 'MISSING_PAYMENT_PROOF':
        summary = 'This GCash order is missing its payment screenshot, so it cannot be uploaded.';
        detail = undefined;
        break;
      case 'INVALID_CUSTOMER_ID':
        summary = 'The customer for this order was not found on the server.';
        break;
      case 'INVALID_TRANSACTION_HEADER':
      case 'INVALID_ITEM_PAYLOAD':
      case 'INVALID_INVOICE_PAYLOAD':
        summary = 'Some details in this order were rejected by the server.';
        break;
      case 'CANISTER_LEDGER_ERROR':
        summary = 'The cylinder return or loan count could not be saved on the server.';
        break;
      case 'DUPLICATE_ORDER_CONFLICT':
        summary = 'This order number conflicts with an existing order on the server.';
        break;
      case 'DB_CONSTRAINT_ERROR':
        summary = 'The server had a database error while saving this order after multiple tries.';
        break;
      default:
        if (cleanedMsg) {
          summary = cleanedMsg;
          detail = undefined;
        }
        break;
    }

    return {
      label: 'Needs attention',
      tone: 'error',
      summary,
      detail: detail && detail !== summary ? detail : undefined,
    };
  }

  // PENDING, PROCESSING, or transient FAILED (still retrying)
  let summary = 'Saved on this device. Waiting to upload.';
  if (status === 'FAILED' || cleanedMsg) {
    if (
      code === 'NETWORK_TIMEOUT' ||
      code === 'NETWORK_ERROR' ||
      code === 'OFFLINE' ||
      (cleanedMsg && /timeout|offline|network/i.test(cleanedMsg))
    ) {
      summary = 'Waiting for an internet connection to finish uploading.';
    } else if (code === 'MEDIA_UPLOAD_FAILED') {
      summary = 'Waiting for a stable connection to upload the photo attachment.';
    } else if (code === 'DB_CONSTRAINT_ERROR') {
      summary = 'Temporary server issue while saving. Will try again automatically.';
    } else if (cleanedMsg) {
      summary = `Last attempt did not go through (${cleanedMsg}). Will try again automatically.`;
    }
  }

  return {
    label: 'Pending upload',
    tone: 'pending',
    summary,
  };
}
