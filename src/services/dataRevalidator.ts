import { networkSentinel } from '@/sync/networkSentinel';
import { sessionStore } from './sessionStore';

export type DataRefreshEventType =
  | 'TRIP_UPDATED'
  | 'INVENTORY_UPDATED'
  | 'CUSTOMERS_UPDATED'
  | 'CATALOG_UPDATED'
  | 'ZONES_UPDATED'
  | 'TELEMETRY_UPDATED'
  | 'FUEL_LOGS_UPDATED'
  | 'MAINTENANCE_LOGS_UPDATED'
  | 'PROFILE_UPDATED';

export interface DataRefreshPayload {
  event: DataRefreshEventType;
  resourceId?: string;
}

export type DataRefreshListener = (payload: DataRefreshPayload) => void;

const DEFAULT_COOLDOWN_MS = 15000; // 15s freshness window for automatic background revalidations

class DataRevalidator {
  private listeners = new Set<DataRefreshListener>();
  private inFlight = new Map<string, Promise<void>>();
  private lastSuccessAt = new Map<string, number>();
  private activeEpoch = 0;

  constructor() {
    // Automatically clear in-flight tracking and cooldowns on logout or user switch
    sessionStore.subscribe((session, reason) => {
      if (!session || reason === 'logout' || reason === 'revoked' || reason === 'login') {
        this.reset();
      }
    });
  }

  public reset(): void {
    this.activeEpoch += 1;
    this.inFlight.clear();
    this.lastSuccessAt.clear();
  }

  public subscribe(listener: DataRefreshListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public emit(event: DataRefreshEventType, resourceId?: string): void {
    const payload: DataRefreshPayload = { event, resourceId };
    this.listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.warn('[DataRevalidator] Listener error:', err);
      }
    });
  }

  /**
   * Executes a deduplicated, auth-gated background revalidation task.
   * - Silently no-ops if offline, unauthenticated, or mustChangePassword is true.
   * - Deduplicates concurrent requests for the same resource key.
   * - Enforces a cooldown window unless `force` is true.
   * - Passes `isSessionStillValid()` so callers can abort SQLite writes if the user logged out or switched mid-flight.
   */
  public async run(
    key: string,
    task: (ctx: { userId: string; isSessionStillValid: () => Promise<boolean> }) => Promise<void>,
    options: { force?: boolean; cooldownMs?: number } = {}
  ): Promise<void> {
    if (!networkSentinel.isOnline()) {
      return;
    }

    const session = await sessionStore.getSession();
    if (!session || !session.token || !session.id || session.mustChangePassword) {
      return;
    }

    const expectedUserId = session.id;
    const scopedKey = `${expectedUserId}:${key}`;
    const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;

    // 1. Return existing in-flight promise if already running for this user & key
    const existingPromise = this.inFlight.get(scopedKey);
    if (existingPromise) {
      return existingPromise;
    }

    // 2. Skip if within freshness cooldown and not forced
    if (!options.force) {
      const lastRun = this.lastSuccessAt.get(scopedKey);
      if (lastRun && Date.now() - lastRun < cooldownMs) {
        return;
      }
    }

    const capturedEpoch = this.activeEpoch;

    const isSessionStillValid = async (): Promise<boolean> => {
      if (this.activeEpoch !== capturedEpoch) return false;
      const latest = await sessionStore.getSession();
      return Boolean(latest && latest.token && latest.id === expectedUserId && !latest.mustChangePassword);
    };

    let runner: Promise<void> | undefined;
    runner = (async () => {
      try {
        await task({ userId: expectedUserId, isSessionStillValid });
        if (this.activeEpoch === capturedEpoch) {
          this.lastSuccessAt.set(scopedKey, Date.now());
        }
      } catch {
        // Background revalidation must fail silently without disrupting UI
      } finally {
        if (runner && this.inFlight.get(scopedKey) === runner) {
          this.inFlight.delete(scopedKey);
        }
      }
    })();

    this.inFlight.set(scopedKey, runner);
    return runner;
  }
}

export const dataRevalidator = new DataRevalidator();
