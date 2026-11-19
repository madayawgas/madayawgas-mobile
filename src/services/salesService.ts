import * as Crypto from 'expo-crypto';
import {
  salesRepository,
  inventoryRepository,
  tripRepository,
  customerRepository,
  syncQueueRepository,
  zoneRepository,
} from '@/database';
import { tripApi, customerApi, productApi, scheduleApi } from '@/api';
import {
  SalesOrder,
  SalesOrderItem,
  CanisterLedgerEntry,
  PaymentMethod,
  ActiveTrip,
  Customer,
  CustomerType,
  VehicleInventory,
  ServiceZone,
  StockShortageItem,
} from '@/types';
import { networkSentinel } from '@/sync/networkSentinel';
import { syncScheduler } from '@/sync/syncScheduler';
import { mediaService } from './mediaService';
import { authService } from './authService';
import { dataRevalidator } from './dataRevalidator';

export interface LocalFirstReadOptions {
  forceRefresh?: boolean;
  skipRevalidate?: boolean;
}

export interface SaleItemInput {
  productId: string;
  productName: string;
  quantitySold: number;
  emptiesReturned: number;
  emptiesDefective?: number;
  unitPrice: number;
}

export interface ProcessSaleParams {
  customerId: string;
  customerName?: string;
  items: SaleItemInput[];
  paymentMethod: PaymentMethod;
  paymentReference?: string;
  paymentProofUri?: string;
  paymentProofKey?: string;
}

export interface StockValidationResult {
  hasShortage: boolean;
  warnings: string[];
  shortages: StockShortageItem[];
}

export class InsufficientStockError extends Error {
  code = 'INSUFFICIENT_STOCK';
  details: StockShortageItem[];

  constructor(details: StockShortageItem[]) {
    const message = details
      .map(
        (d) =>
          `Insufficient stock for "${d.productName}". Requested: ${d.requested}, Available: ${d.available}.`
      )
      .join('\n');
    super(message);
    this.name = 'InsufficientStockError';
    this.details = details;
  }
}

export interface SalesDashboardData {
  trip: ActiveTrip | null;
  totalSales: number;
  recentOrders: SalesOrder[];
  inventory: VehicleInventory[];
  pendingSyncCount: number;
  isOnline: boolean;
}

export interface RegisterCustomerInput {
  businessName?: string;
  contactPerson: string;
  contactNumber: string;
  alternateContactNumber?: string;
  deliveryAddress: string;
  customerType: CustomerType;
  tin?: string;
  zoneId?: string;
}

let activeDashboardPromise: Promise<SalesDashboardData> | null = null;
let activeDashboardUserId: string | null = null;

async function revalidateSalesTrip(effectiveUserId: string, force: boolean): Promise<void> {
  await dataRevalidator.run(
    'sales:trip',
    async ({ isSessionStillValid }) => {
      const assignment = await tripApi.fetchActiveAssignment();
      if (!(await isSessionStillValid())) return;

      const currentLocal = await tripRepository.getActiveTrip();

      if (assignment?.trip && assignment.trip.id) {
        const rawTrip = assignment.trip as any;
        const tripId = rawTrip.id;
        const tripSalesUserId = rawTrip.salesUserId || rawTrip.sales_user_id;
        const tripStatus = rawTrip.status || 'IN_PROGRESS';

        if (tripSalesUserId && tripSalesUserId !== effectiveUserId) {
          if (currentLocal) {
            await tripRepository.clearActiveTrip();
            await inventoryRepository.clearInventory();
            dataRevalidator.emit('TRIP_UPDATED');
            dataRevalidator.emit('INVENTORY_UPDATED');
          }
          return;
        }

        if (tripStatus !== 'IN_PROGRESS' && tripStatus !== 'PENDING') {
          if (currentLocal) {
            await tripRepository.clearActiveTrip();
            await inventoryRepository.clearInventory();
            dataRevalidator.emit('TRIP_UPDATED');
            dataRevalidator.emit('INVENTORY_UPDATED');
          }
          return;
        }

        const tripNumber =
          rawTrip.tripNumber ||
          rawTrip.trip_number ||
          `TRIP-${tripId.substring(0, 8)}`;

        const nextTrip: ActiveTrip = {
          trip_id: tripId,
          trip_number: tripNumber,
          vehicle_plate: rawTrip.truckPlateNumber || rawTrip.truck_plate_number || 'N/A',
          driver_name: rawTrip.driverName || rawTrip.driver_name || 'Driver',
          sales_user_id: tripSalesUserId || effectiveUserId,
          zone_id: rawTrip.zoneId || rawTrip.zone_id || 'DEFAULT',
          status: tripStatus,
          dispatched_at: rawTrip.departureTime || rawTrip.departure_time || new Date().toISOString(),
          truck_id: rawTrip.truckId || rawTrip.truck_id || null,
          truck_model: rawTrip.truckModel || rawTrip.truck_model || null,
          driver_id: rawTrip.driverId || rawTrip.driver_id || null,
          sales_user_name: rawTrip.salesUserName || rawTrip.sales_user_name || null,
          zone_name: rawTrip.zoneName || rawTrip.zone_name || null,
        };

        const tripChanged =
          !currentLocal ||
          currentLocal.trip_id !== nextTrip.trip_id ||
          currentLocal.status !== nextTrip.status ||
          currentLocal.zone_id !== nextTrip.zone_id ||
          currentLocal.vehicle_plate !== nextTrip.vehicle_plate;

        await tripRepository.saveActiveTrip(nextTrip);
        if (tripChanged) {
          dataRevalidator.emit('TRIP_UPDATED');
        }

        try {
          const stockItems = await tripApi.fetchTripStock(nextTrip.trip_id);
          if (!(await isSessionStillValid())) return;
          const invChanged = await inventoryRepository.syncTripInventory(nextTrip.trip_id, stockItems);
          if (invChanged) {
            dataRevalidator.emit('INVENTORY_UPDATED');
          }
        } catch (stockErr) {
          console.warn('[SalesService] Background trip stock sync warning:', stockErr);
        }
      } else if (currentLocal) {
        await tripRepository.clearActiveTrip();
        await inventoryRepository.clearInventory();
        dataRevalidator.emit('TRIP_UPDATED');
        dataRevalidator.emit('INVENTORY_UPDATED');
      }
    },
    { force }
  );
}

async function revalidateCustomers(zoneId: string | undefined, force: boolean): Promise<void> {
  const targetZone = zoneId && zoneId !== 'ALL' ? zoneId : undefined;
  const key = `customers:${targetZone || 'ALL'}`;
  await dataRevalidator.run(
    key,
    async ({ isSessionStillValid }) => {
      const remoteData = await customerApi.fetchZoneCustomers(targetZone);
      if (!(await isSessionStillValid())) return;
      const rawList = Array.isArray(remoteData)
        ? remoteData
        : Array.isArray((remoteData as any)?.customers)
        ? (remoteData as any).customers
        : [];
      if (rawList.length > 0) {
        const hasChanges = await customerRepository.upsertCustomers(rawList);
        if (hasChanges) {
          dataRevalidator.emit('CUSTOMERS_UPDATED');
        }
      }
    },
    { force }
  );
}

async function revalidateProductCatalog(force: boolean): Promise<void> {
  await dataRevalidator.run(
    'product:catalog',
    async ({ isSessionStillValid }) => {
      const remote = await productApi.fetchProductCatalog();
      if (!(await isSessionStillValid())) return;
      const list = Array.isArray(remote)
        ? remote
        : (remote as any)?.products || (remote as any)?.items || [];
      if (Array.isArray(list) && list.length > 0) {
        const hasChanges = await inventoryRepository.upsertProductCatalog(list);
        if (hasChanges) {
          dataRevalidator.emit('CATALOG_UPDATED');
        }
      }
    },
    { force, cooldownMs: 60000 }
  );
}

async function revalidateZones(force: boolean): Promise<void> {
  await dataRevalidator.run(
    'service:zones',
    async ({ isSessionStillValid }) => {
      const remoteZones = await scheduleApi.fetchZones();
      if (!(await isSessionStillValid())) return;
      if (remoteZones.length > 0) {
        await zoneRepository.upsertZones(remoteZones);
        dataRevalidator.emit('ZONES_UPDATED');
      }
    },
    { force, cooldownMs: 60000 }
  );
}

export const salesService = {
  /**
   * Local-First active trip resolution:
   * - Reads immediately from local SQLite (`local_active_trip`) and enforces user-binding.
   * - Triggers deduplicated background revalidation when online (or awaits it when `forceRefresh: true`).
   */
  async resolveActiveTripForUser(
    userId?: string,
    options: LocalFirstReadOptions = {}
  ): Promise<ActiveTrip | null> {
    let effectiveUserId = userId;
    if (!effectiveUserId) {
      try {
        const session = await authService.getSession();
        effectiveUserId = session?.id;
      } catch {
        // ignore
      }
    }

    if (!effectiveUserId) {
      await tripRepository.clearActiveTrip();
      await inventoryRepository.clearInventory();
      return null;
    }

    if (options.forceRefresh) {
      await revalidateSalesTrip(effectiveUserId, true);
    } else if (!options.skipRevalidate) {
      void revalidateSalesTrip(effectiveUserId, false);
    }

    const cachedTrip = await tripRepository.getActiveTrip();
    if (cachedTrip) {
      const belongsToUser = cachedTrip.sales_user_id === effectiveUserId;
      const isActive = cachedTrip.status === 'IN_PROGRESS';

      if (!belongsToUser || !isActive) {
        await tripRepository.clearActiveTrip();
        await inventoryRepository.clearInventory();
        return null;
      }
      return cachedTrip;
    }

    return null;
  },

  /**
   * Helper alias to resolve active delivery trip for user.
   */
  async getActiveTrip(userId?: string, options?: LocalFirstReadOptions): Promise<ActiveTrip | null> {
    return this.resolveActiveTripForUser(userId, options);
  },

  /**
   * Retrieves operational dashboard data for the sales agent (Local-First):
   * - Reads immediately from SQLite; triggers background revalidation unless `skipRevalidate` is set.
   */
  async getDashboardData(
    userId?: string,
    options: LocalFirstReadOptions = {}
  ): Promise<SalesDashboardData> {
    let effectiveUserId = userId;
    if (!effectiveUserId) {
      try {
        const session = await authService.getSession();
        effectiveUserId = session?.id;
      } catch {
        // ignore
      }
    }

    if (!options.forceRefresh && activeDashboardPromise && activeDashboardUserId === effectiveUserId) {
      return activeDashboardPromise;
    }

    activeDashboardUserId = effectiveUserId || null;
    activeDashboardPromise = (async () => {
      try {
        if (!options.skipRevalidate) {
          void revalidateProductCatalog(Boolean(options.forceRefresh));
        }
        const activeTrip = await this.resolveActiveTripForUser(effectiveUserId, options);
        const isTripActive = Boolean(activeTrip && activeTrip.status === 'IN_PROGRESS');

        const [totalSales, recentOrders, inventory, queueCount, offlineCustomers] = await Promise.all([
          isTripActive && activeTrip ? salesRepository.getTotalSalesAmount(activeTrip.trip_id) : Promise.resolve(0),
          isTripActive && activeTrip ? salesRepository.getRecentOrders(5, activeTrip.trip_id) : Promise.resolve([]),
          isTripActive ? inventoryRepository.getAllInventory() : Promise.resolve([]),
          syncQueueRepository.getPendingCount(effectiveUserId),
          customerRepository.getLocallyCreatedCustomers(),
        ]);

        return {
          trip: activeTrip,
          totalSales,
          recentOrders,
          inventory,
          pendingSyncCount: queueCount + offlineCustomers.length,
          isOnline: networkSentinel.isOnline(),
        };
      } finally {
        activeDashboardPromise = null;
        activeDashboardUserId = null;
      }
    })();

    return activeDashboardPromise;
  },

  /**
   * Fetches full local order details (line items + sync queue metadata) for a transaction.
   */
  async getOrderDetails(orderId: string): Promise<{
    order: SalesOrder | null;
    items: SalesOrderItem[];
    queueItem: {
      retry_count: number;
      last_attempted_at?: string | null;
      error_code?: string | null;
      error_message?: string | null;
    } | null;
  }> {
    const [{ order, items }, queueItem] = await Promise.all([
      salesRepository.getOrderWithItems(orderId),
      syncQueueRepository.getItemById(orderId),
    ]);
    return {
      order,
      items,
      queueItem: queueItem
        ? {
            retry_count: queueItem.retry_count,
            last_attempted_at: queueItem.last_attempted_at,
            error_code: queueItem.error_code,
            error_message: queueItem.error_message,
          }
        : null,
    };
  },

  /**
   * Resets a quarantined or failed order back to PENDING and triggers an immediate sync attempt.
   */
  async retryOrderSync(orderId: string) {
    await syncQueueRepository.retryQuarantinedItem(orderId);
    return syncScheduler.syncNow();
  },

  /**
   * Attaches or replaces the GCash payment proof photo for a quarantined/failed order and retries sync.
   */
  async updateOrderPaymentProof(orderId: string, newPhotoUri: string) {
    const queueItem = await syncQueueRepository.getItemById(orderId);
    if (!queueItem) {
      throw new Error('Queued sync record for this order was not found.');
    }

    const cached = await mediaService.processAndCacheImage(newPhotoUri, 'gcash_receipt');
    const payload = JSON.parse(queueItem.payload);
    if (!payload.invoice) {
      payload.invoice = {};
    }
    payload.invoice.paymentMethod = 'GCASH';
    payload.invoice.paymentProofUri = cached.localUri;
    payload.invoice.paymentProofKey = null;

    await salesRepository.updateOrderRecoveryFields(orderId, { paymentMethod: 'GCASH' });
    await syncQueueRepository.updatePayloadAndResetPending(orderId, JSON.stringify(payload));
    return syncScheduler.syncNow();
  },

  /**
   * Switches a quarantined GCash order to CASH (clearing missing proof requirements) and retries sync.
   */
  async switchQuarantinedOrderToCash(orderId: string) {
    const queueItem = await syncQueueRepository.getItemById(orderId);
    if (!queueItem) {
      throw new Error('Queued sync record for this order was not found.');
    }

    const payload = JSON.parse(queueItem.payload);
    if (!payload.invoice) {
      payload.invoice = {};
    }
    payload.invoice.paymentMethod = 'CASH';
    payload.invoice.paymentProofUri = null;
    payload.invoice.paymentProofKey = null;

    await salesRepository.updateOrderRecoveryFields(orderId, { paymentMethod: 'CASH' });
    await syncQueueRepository.updatePayloadAndResetPending(orderId, JSON.stringify(payload));
    return syncScheduler.syncNow();
  },

  /**
   * Regenerates transaction/receipt numbers after a DUPLICATE_ORDER_CONFLICT and retries sync.
   */
  async regenerateOrderRefsAndRetry(orderId: string) {
    const queueItem = await syncQueueRepository.getItemById(orderId);
    if (!queueItem) {
      throw new Error('Queued sync record for this order was not found.');
    }

    const payload = JSON.parse(queueItem.payload);
    const suffix = Date.now().toString().slice(-6);
    const newTxNo = `TX-R-${suffix}`;
    const isZeroSale = Boolean(payload.invoice?.declarationNumber && !payload.invoice?.invoiceNumber);
    const newReceiptNo = isZeroSale ? `CD-R-${suffix}` : `INV-R-${suffix}`;

    payload.transactionNo = newTxNo;
    if (payload.transaction) {
      payload.transaction.transactionNo = newTxNo;
    }
    if (payload.invoice) {
      if (isZeroSale) {
        payload.invoice.declarationNumber = newReceiptNo;
      } else {
        payload.invoice.invoiceNumber = newReceiptNo;
      }
    }

    await salesRepository.updateOrderRecoveryFields(orderId, {
      transactionNo: newTxNo,
      receiptNumber: newReceiptNo,
    });
    await syncQueueRepository.updatePayloadAndResetPending(orderId, JSON.stringify(payload));
    return syncScheduler.syncNow();
  },
  /**
   * Strict Stock Enforcement Policy: Validates that requested quantities do not
   * exceed remaining vehicle stock on board.
   */
  async validateStockSufficiency(items: SaleItemInput[]): Promise<StockValidationResult> {
    const warnings: string[] = [];
    const shortages: StockShortageItem[] = [];
    const inventory = await inventoryRepository.getAllInventory();

    const requestedByProduct = new Map<string, { productName: string; quantitySold: number }>();
    for (const item of items) {
      if (item.quantitySold <= 0) continue;
      const existing = requestedByProduct.get(item.productId);
      if (existing) {
        existing.quantitySold += item.quantitySold;
      } else {
        requestedByProduct.set(item.productId, {
          productName: item.productName,
          quantitySold: item.quantitySold,
        });
      }
    }

    for (const [productId, req] of requestedByProduct.entries()) {
      const stock = inventory.find((inv) => inv.product_id === productId);
      const remaining = stock ? stock.quantity_remaining : 0;

      if (req.quantitySold > remaining) {
        shortages.push({
          productId,
          productName: req.productName,
          requested: req.quantitySold,
          available: remaining,
        });
        warnings.push(
          `Insufficient stock for "${req.productName}". Requested: ${req.quantitySold}, Available: ${remaining}.`
        );
      }
    }

    return {
      hasShortage: shortages.length > 0,
      warnings,
      shortages,
    };
  },

  /**
   * Executes atomic sale or zero-sale canister declaration stop.
   * Single local SQLite transaction guaranteeing zero partial writes.
   * Throws InsufficientStockError if any sold quantity exceeds remaining vehicle stock.
   */
  async processSale(params: ProcessSaleParams): Promise<{ order: SalesOrder; receiptNumber: string; newCustomerDebt: number }> {
    const { customerId, customerName, items, paymentMethod, paymentReference, paymentProofUri } = params;

    const session = await authService.getSession();
    const activeTrip = await this.resolveActiveTripForUser(session?.id);
    if (!activeTrip || activeTrip.status !== 'IN_PROGRESS') {
      throw new Error('No active delivery trip assigned to you. You cannot make a sale without an active delivery trip.');
    }

    // Strict stock sufficiency guard before media upload, receipt numbering, or SQLite writes
    const stockValidation = await this.validateStockSufficiency(items);
    if (stockValidation.hasShortage) {
      throw new InsufficientStockError(stockValidation.shortages);
    }

    // Process GCash payment receipt evidence if provided
    let persistentProofUri = paymentProofUri || null;
    let paymentProofKey = params.paymentProofKey || null;

    if (paymentMethod === 'GCASH' && paymentProofUri) {
      try {
        const cached = await mediaService.processAndCacheImage(paymentProofUri, 'gcash_receipt');
        persistentProofUri = cached.localUri;
      } catch (err: any) {
        console.warn('[SalesService] Could not cache GCash payment proof:', err?.message || err);
        throw new Error('Could not save GCash receipt photo on this device. Please select or capture the photo again.');
      }

      // If online and persistent image exists, attempt eager media upload to /api/media/upload
      if (networkSentinel.isOnline() && persistentProofUri && !paymentProofKey) {
        try {
          const uploadRes = await mediaService.uploadMedia(persistentProofUri, 'sales/payments');
          paymentProofKey = uploadRes.storageKey;
        } catch (upErr: any) {
          console.warn('[SalesService] Eager GCash proof upload deferred to sync queue:', upErr?.message || upErr);
        }
      }
    }

    const totalSold = items.reduce((sum, i) => sum + i.quantitySold, 0);
    const totalEmpties = items.reduce((sum, i) => sum + i.emptiesReturned, 0);
    const isZeroSale = totalSold === 0 && totalEmpties > 0;

    // 1. Generate client UUIDs
    const orderId = Crypto.randomUUID();
    const transactionNo = `TX-${activeTrip.trip_number.replace(/^TRIP-/, '')}-${Date.now().toString().slice(-6)}`;
    const transactedAt = new Date().toISOString();

    // 2. Control Receipt Number (INV-... or CD-...)
    const receiptNumber = await salesRepository.getNextControlNumber(
      activeTrip.trip_id,
      activeTrip.trip_number,
      isZeroSale
    );

    // 3. Evaluate Canister Debt Ledger & Line Items
    // Append-only canister debt math:
    // For each product SKU:
    //   quantity_loaned = max(0, quantity_sold - empties_returned)
    //   quantity_returned = max(0, empties_returned - quantity_sold)
    //   net_balance_change = quantity_loaned - quantity_returned
    // new_customer_debt = max(0, current_customer_debt + sum(net_balance_change))
    const customer = await customerRepository.getCustomerById(customerId);
    const currentCustomerDebt = Math.max(0, customer?.canister_debt ?? customer?.canisterDebt ?? 0);

    let orderTotalAmount = 0;
    let transactionNetCanisterChange = 0;

    const salesItems: SalesOrderItem[] = [];
    const canisterEntries: CanisterLedgerEntry[] = [];
    const inventoryDeductions: { productId: string; quantitySold: number }[] = [];

    // Resolve authoritative unit prices from local_product_catalog if omitted/zero on sold items
    const needsCatalogLookup = items.some(
      (i) => i.quantitySold > 0 && (!Number.isFinite(Number(i.unitPrice)) || Number(i.unitPrice) <= 0)
    );
    const catalogById = new Map<string, number>();
    if (needsCatalogLookup) {
      const cachedCatalog = await inventoryRepository.getProductCatalog();
      for (const c of cachedCatalog || []) {
        if (c.product_id) {
          catalogById.set(c.product_id, Number(c.price ?? 0));
        }
      }
    }

    for (const item of items) {
      const resolvedUnitPrice =
        item.quantitySold > 0 && (!Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) <= 0)
          ? Number(catalogById.get(item.productId) ?? 0)
          : Number(item.unitPrice ?? 0);

      if (item.quantitySold > 0 && resolvedUnitPrice <= 0) {
        throw new Error(
          `Unit price unavailable for "${item.productName}". Please sync the product catalog while online.`
        );
      }

      const lineSubtotal = item.quantitySold * resolvedUnitPrice;
      orderTotalAmount += lineSubtotal;

      const empties = Math.max(0, item.emptiesReturned || 0);
      const qtyLoaned = Math.max(0, item.quantitySold - empties);
      const qtyReturned = Math.max(0, empties - item.quantitySold);
      const netCanisterChange = qtyLoaned - qtyReturned;

      transactionNetCanisterChange += netCanisterChange;

      const itemId = Crypto.randomUUID();
      salesItems.push({
        id: itemId,
        sales_order_id: orderId,
        product_id: item.productId,
        product_name: item.productName,
        quantity_sold: item.quantitySold,
        empties_returned: empties,
        empties_defective: item.emptiesDefective || 0,
        unit_price: resolvedUnitPrice,
        subtotal: lineSubtotal,
      });

      if (item.quantitySold > 0 || empties > 0) {
        canisterEntries.push({
          id: Crypto.randomUUID(),
          customer_id: customerId,
          product_id: item.productId,
          trip_id: activeTrip.trip_id,
          transaction_id: orderId,
          quantity_loaned: qtyLoaned,
          quantity_returned: qtyReturned,
          net_balance_change: netCanisterChange,
          transacted_at: transactedAt,
        });
      }

      if (item.quantitySold > 0) {
        inventoryDeductions.push({
          productId: item.productId,
          quantitySold: item.quantitySold,
        });
      }
    }

    const newCustomerDebt = Math.max(0, currentCustomerDebt + transactionNetCanisterChange);
    const netCustomerDebtDelta = newCustomerDebt - currentCustomerDebt;

    // 4. Build Sales Order Object
    const effectivePaymentRef = paymentReference || undefined;
    const salesOrder: SalesOrder = {
      id: orderId,
      transaction_no: transactionNo,
      trip_id: activeTrip.trip_id,
      customer_id: customerId,
      customer_name: customerName,
      receipt_number: receiptNumber,
      total_amount: orderTotalAmount,
      payment_method: paymentMethod,
      payment_reference: effectivePaymentRef,
      transacted_at: transactedAt,
      synced_at: null,
      sync_status: 'PENDING',
    };

    // 5. Build Sync Payload (flattened with transaction header at root for backend sync.service.js)
    const syncPayload = {
      id: orderId,
      transactionNo,
      tripId: activeTrip.trip_id,
      customerId,
      recordedBy: activeTrip.sales_user_id,
      status: 'COMPLETED',
      transactedAt,
      // Retain nested transaction object for backward/forward contract compatibility
      transaction: {
        id: orderId,
        transactionNo,
        tripId: activeTrip.trip_id,
        customerId,
        recordedBy: activeTrip.sales_user_id,
        status: 'COMPLETED',
        transactedAt,
      },
      invoice: {
        id: Crypto.randomUUID(),
        transactionId: orderId,
        invoiceNumber: !isZeroSale ? receiptNumber : null,
        declarationNumber: isZeroSale ? receiptNumber : null,
        totalAmount: orderTotalAmount,
        paymentMethod,
        paymentStatus: 'PAID_UNVERIFIED',
        paymentReferenceNumber: paymentReference || null,
        paymentProofKey: paymentProofKey || null,
        paymentProofUri: persistentProofUri || null,
        transactedAt,
      },
      items: salesItems.map((si) => ({
        id: si.id,
        transactionId: orderId,
        productId: si.product_id,
        quantitySold: si.quantity_sold,
        emptiesReturned: si.empties_returned,
        emptiesDefective: si.empties_defective,
        unitPriceAtSale: si.unit_price,
        subtotalAmount: si.subtotal,
      })),
      canisterLedger: canisterEntries.map((ce) => ({
        id: ce.id,
        customerId: ce.customer_id,
        productId: ce.product_id,
        tripId: ce.trip_id,
        transactionId: ce.transaction_id,
        quantityLoaned: ce.quantity_loaned,
        quantityReturned: ce.quantity_returned,
        netBalanceChange: ce.net_balance_change,
        transactedAt: ce.transacted_at,
      })),
    };

    // 6. Execute Atomic Transaction in SQLite
    await salesRepository.createAtomicSale({
      order: salesOrder,
      items: salesItems,
      canisterEntries,
      inventoryDeductions,
      customerDebtChange: netCustomerDebtDelta,
      newCustomerDebt: newCustomerDebt,
      syncQueueItem: {
        id: orderId, // Use order ID for queue item to enforce 1:1 sync tracking
        user_id: activeTrip.sales_user_id || 'sales-user',
        operation_type: isZeroSale ? 'ZERO_SALE_DECLARATION' : 'CREATE_ORDER',
        endpoint: '/sales/sync-batch',
        payload: JSON.stringify(syncPayload),
      },
    });

    // 7. If online, initiate background sync immediately
    if (networkSentinel.isOnline()) {
      syncScheduler.syncNow(activeTrip.sales_user_id).catch((err) => {
        console.warn('[SalesService] Immediate background sync cycle skipped:', err?.message || err);
      });
    }

    return { order: salesOrder, receiptNumber, newCustomerDebt };
  },

  /**
   * Registers a customer offline from the truck cabin.
   */
  async registerOfflineCustomer(customerData: {
    businessName: string;
    contactPerson: string;
    contactNumber: string;
    deliveryAddress: string;
    customerType: 'COMMERCIAL' | 'RETAIL' | 'WHOLESALE';
  }) {
    const activeTrip = await this.resolveActiveTripForUser();
    const customerId = Crypto.randomUUID();
    const now = new Date().toISOString();

    const newCustomer = {
      id: customerId,
      name: customerData.businessName || customerData.contactPerson,
      business_name: customerData.businessName,
      contact_person: customerData.contactPerson,
      contact_number: customerData.contactNumber,
      delivery_address: customerData.deliveryAddress,
      customer_type: customerData.customerType,
      zone_id: activeTrip?.zone_id,
      canister_debt: 0,
      is_locally_created: true,
      created_at: now,
    };

    await customerRepository.createOfflineCustomer(newCustomer);

    return newCustomer;
  },

  /**
   * Registers a customer following the dual direct-or-queue offline-first pattern:
   * - When online: registers directly via customerApi.registerCustomer and stores in SQLite.
   * - When offline or network error: creates in SQLite with is_locally_created = 1.
   */
  async registerCustomer(customerData: RegisterCustomerInput): Promise<Customer> {
    const activeTrip = await this.resolveActiveTripForUser();
    const effectiveZoneId = customerData.zoneId || activeTrip?.zone_id || null;

    // Standardize Philippine phone number to E.164 (+63...)
    const cleanNumber = (num?: string) => {
      if (!num) return '';
      const digits = num.replace(/\D/g, '');
      if (digits.startsWith('63') && digits.length >= 12) return `+${digits}`;
      if (digits.startsWith('0')) return `+63${digits.slice(1)}`;
      if (digits.length === 10) return `+63${digits}`;
      return `+63${digits}`;
    };

    const formattedContact = cleanNumber(customerData.contactNumber);
    const formattedAltContact = customerData.alternateContactNumber
      ? cleanNumber(customerData.alternateContactNumber)
      : null;

    const customerPayload = {
      name: customerData.businessName || customerData.contactPerson,
      businessName: customerData.businessName || null,
      contactPerson: customerData.contactPerson,
      contactNumber: formattedContact,
      alternateContactNumber: formattedAltContact,
      deliveryAddress: customerData.deliveryAddress,
      customerType: customerData.customerType || 'RETAIL',
      tin: customerData.tin || null,
      zoneId: effectiveZoneId,
    };

    // 1. Try online direct registration if networkSentinel indicates online
    if (networkSentinel.isOnline()) {
      try {
        const createdRemote = await customerApi.registerCustomer(customerPayload);
        if (createdRemote && createdRemote.id) {
          const syncedCustomer: Customer = {
            id: createdRemote.id,
            name: createdRemote.name || customerPayload.name,
            business_name: createdRemote.business_name || (createdRemote as any).businessName || customerPayload.businessName || '',
            contact_person: createdRemote.contact_person || (createdRemote as any).contactPerson || customerPayload.contactPerson,
            contact_number: createdRemote.contact_number || (createdRemote as any).contactNumber || customerPayload.contactNumber,
            delivery_address: createdRemote.delivery_address || (createdRemote as any).deliveryAddress || customerPayload.deliveryAddress,
            customer_type: createdRemote.customer_type || (createdRemote as any).customerType || customerPayload.customerType,
            zone_id: createdRemote.zone_id || (createdRemote as any).zoneId || effectiveZoneId || undefined,
            canister_debt: createdRemote.canister_debt ?? 0,
            is_locally_created: false,
            created_at: createdRemote.created_at || (createdRemote as any).createdAt || new Date().toISOString(),
          };
          await customerRepository.upsertCustomers([syncedCustomer]);
          return syncedCustomer;
        }
      } catch (err: any) {
        // If it's a 400 validation error or 409 conflict, rethrow so UI can notify user
        const status = err?.status || err?.statusCode;
        const msg = err?.message || '';
        if (status === 400 || status === 409 || msg.includes('already exists') || msg.includes('required') || msg.includes('Invalid')) {
          throw err;
        }
        console.warn('[SalesService] Direct customer registration failed, falling back to local SQLite:', err);
      }
    }

    // 2. Offline Fallback: store locally with is_locally_created = 1
    const customerId = Crypto.randomUUID();
    const now = new Date().toISOString();

    const newCustomer: Customer = {
      id: customerId,
      name: customerPayload.name,
      business_name: customerPayload.businessName || '',
      contact_person: customerPayload.contactPerson,
      contact_number: customerPayload.contactNumber,
      delivery_address: customerPayload.deliveryAddress,
      customer_type: customerPayload.customerType,
      zone_id: effectiveZoneId || undefined,
      canister_debt: 0,
      is_locally_created: true,
      created_at: now,
    };

    await customerRepository.createOfflineCustomer(newCustomer);
    return newCustomer;
  },

  /**
   * Updates an existing customer profile:
   * - When online: updates directly via customerApi.updateCustomer and stores in SQLite.
   * - When offline or network error: updates in local SQLite immediately.
   */
  async updateCustomer(id: string, customerData: RegisterCustomerInput): Promise<Customer> {
    const existing = await customerRepository.getCustomerById(id);
    const activeTrip = await tripRepository.getActiveTrip();
    const effectiveZoneId =
      customerData.zoneId !== undefined
        ? customerData.zoneId
        : (existing?.zone_id || activeTrip?.zone_id || null);

    const cleanNumber = (num?: string) => {
      if (!num) return '';
      const digits = num.replace(/\D/g, '');
      if (digits.startsWith('63') && digits.length >= 12) return `+${digits}`;
      if (digits.startsWith('0')) return `+63${digits.slice(1)}`;
      if (digits.length === 10) return `+63${digits}`;
      return `+63${digits}`;
    };

    const formattedContact = cleanNumber(customerData.contactNumber);
    const formattedAltContact = customerData.alternateContactNumber
      ? cleanNumber(customerData.alternateContactNumber)
      : null;

    const customerPayload = {
      name: customerData.businessName || customerData.contactPerson,
      businessName: customerData.businessName || null,
      contactPerson: customerData.contactPerson,
      contactNumber: formattedContact,
      alternateContactNumber: formattedAltContact,
      deliveryAddress: customerData.deliveryAddress,
      customerType: customerData.customerType || 'RETAIL',
      tin: customerData.tin || null,
      zoneId: effectiveZoneId,
    };

    // 1. Try online direct update
    if (networkSentinel.isOnline()) {
      try {
        const updatedRemote = await customerApi.updateCustomer(id, customerPayload);
        if (updatedRemote && updatedRemote.id) {
          const syncedCustomer: Customer = {
            id: updatedRemote.id,
            name: updatedRemote.name || customerPayload.name,
            business_name: updatedRemote.business_name || (updatedRemote as any).businessName || customerPayload.businessName || '',
            contact_person: updatedRemote.contact_person || (updatedRemote as any).contactPerson || customerPayload.contactPerson,
            contact_number: updatedRemote.contact_number || (updatedRemote as any).contactNumber || customerPayload.contactNumber,
            delivery_address: updatedRemote.delivery_address || (updatedRemote as any).deliveryAddress || customerPayload.deliveryAddress,
            customer_type: updatedRemote.customer_type || (updatedRemote as any).customerType || customerPayload.customerType,
            zone_id: updatedRemote.zone_id || (updatedRemote as any).zoneId || effectiveZoneId || undefined,
            canister_debt: updatedRemote.canister_debt ?? existing?.canister_debt ?? 0,
            is_locally_created: existing?.is_locally_created || false,
            created_at: updatedRemote.created_at || (updatedRemote as any).createdAt || existing?.created_at || new Date().toISOString(),
          };
          await customerRepository.upsertCustomers([syncedCustomer]);
          return syncedCustomer;
        }
      } catch (err: any) {
        const status = err?.status || err?.statusCode;
        const msg = err?.message || '';
        if (status === 400 || status === 409 || msg.includes('already exists') || msg.includes('required') || msg.includes('Invalid')) {
          throw err;
        }
        console.warn('[SalesService] Direct customer update failed, falling back to local SQLite:', err);
      }
    }

    // 2. Offline Fallback: update local SQLite record
    const updatedLocal: Customer = {
      id,
      name: customerPayload.name,
      business_name: customerPayload.businessName || '',
      contact_person: customerPayload.contactPerson,
      contact_number: customerPayload.contactNumber,
      delivery_address: customerPayload.deliveryAddress,
      customer_type: customerPayload.customerType,
      zone_id: effectiveZoneId || undefined,
      canister_debt: existing?.canister_debt ?? 0,
      is_locally_created: existing?.is_locally_created || false,
      created_at: existing?.created_at || new Date().toISOString(),
    };

    await customerRepository.upsertCustomers([updatedLocal]);
    return updatedLocal;
  },

  /**
   * Retrieves customers with optional zone, search, and sorting filters.
   * Local-First: Immediately queries SQLite; triggers background zone sync only when not skipped.
   */
  async getCustomers(
    zoneId?: string,
    searchQuery?: string,
    sortOrder: 'ASC' | 'DESC' | 'RECENT' = 'ASC',
    options: LocalFirstReadOptions = {}
  ): Promise<{ customers: Customer[]; count: number }> {
    if (options.forceRefresh) {
      await revalidateCustomers(zoneId, true);
    } else if (!options.skipRevalidate) {
      void revalidateCustomers(zoneId, false);
    }

    const localCustomers = await customerRepository.getAllCustomers(searchQuery, zoneId, sortOrder);
    return {
      customers: localCustomers,
      count: localCustomers.length,
    };
  },

  /**
   * Product catalog fetcher for sales and inventory selection (Local-First).
   * Strictly scopes returned products to what is loaded on the vehicle (local_vehicle_inventory),
   * enriched with cached metadata from local_product_catalog and refreshed in the background.
   */
  async getProductCatalog(options: LocalFirstReadOptions = {}): Promise<any[]> {
    const session = await authService.getSession();
    const activeTrip = await this.resolveActiveTripForUser(session?.id, options);
    if (!activeTrip || activeTrip.status !== 'IN_PROGRESS') {
      return [];
    }

    if (options.forceRefresh) {
      await revalidateProductCatalog(true);
    } else if (!options.skipRevalidate) {
      void revalidateProductCatalog(false);
    }

    const [localInventory, cachedCatalog] = await Promise.all([
      inventoryRepository.getAllInventory(),
      inventoryRepository.getProductCatalog(),
    ]);

    if (!Array.isArray(localInventory) || localInventory.length === 0) {
      return [];
    }

    const catalogById = new Map<string, any>();
    const catalogBySkuOrName = new Map<string, any>();
    for (const c of cachedCatalog || []) {
      if (c.product_id) catalogById.set(c.product_id, c);
      if (c.sku) catalogBySkuOrName.set(String(c.sku).toLowerCase(), c);
      if (c.name) catalogBySkuOrName.set(String(c.name).toLowerCase(), c);
    }

    return localInventory.map((item) => {
      const cached =
        catalogById.get(item.product_id) ||
        (item.sku ? catalogBySkuOrName.get(String(item.sku).toLowerCase()) : undefined) ||
        catalogBySkuOrName.get(String(item.product_name || '').toLowerCase());

      const isCanister =
        cached?.container_type === 'CANISTER' ||
        item.sku?.toLowerCase().includes('canister') ||
        item.product_name?.toLowerCase().includes('canister');
      const is50kg =
        Number(cached?.net_weight_kg) === 50 ||
        item.sku?.toLowerCase().includes('50kg') ||
        item.product_name?.toLowerCase().includes('50kg');

      const defaultNetWeight = isCanister ? 0.17 : is50kg ? 50 : 11;
      const catalogPrice = Number(cached?.price ?? 0);

      return {
        id: item.product_id,
        name: cached?.name || item.product_name,
        category: cached?.category || (isCanister ? 'Canister' : 'LPG Cylinder'),
        containerType: cached?.container_type || (isCanister ? 'CANISTER' : 'CYLINDER'),
        netWeightKg: Number(cached?.net_weight_kg || defaultNetWeight),
        unitPrice: catalogPrice,
        price: catalogPrice,
        quantityRemaining: item.quantity_remaining,
        quantityLoaded: item.quantity_loaded,
        quantitySold: item.quantity_sold,
        isActive: cached ? Boolean(cached.is_active) : true,
        createdAt: cached?.updated_at || new Date().toISOString(),
        updatedAt: cached?.updated_at || new Date().toISOString(),
      };
    });
  },

  /**
   * Synchronizes delivery service zones from local cache with background revalidation.
   */
  async syncZones(options: LocalFirstReadOptions = {}): Promise<ServiceZone[]> {
    if (options.forceRefresh) {
      await revalidateZones(true);
    } else if (!options.skipRevalidate) {
      void revalidateZones(false);
    }
    return zoneRepository.getAllZones();
  },

  /**
   * Background-fetches enriched customer details (e.g. canisterBalances, TIN) without blocking UI.
   */
  async fetchEnrichedCustomerDetails(customerId: string): Promise<any | null> {
    if (!customerId || !networkSentinel.isOnline()) return null;
    try {
      const remoteDetails = await customerApi.getCustomerById(customerId);
      if (remoteDetails) {
        await customerRepository.upsertCustomers([remoteDetails]);
      }
      return remoteDetails;
    } catch {
      return null;
    }
  },

  /**
   * Saves a newly placed order atomically to SQLite through salesService.processSale
   * and queues or syncs directly based on connectivity.
   */
  async createOrder(orderPayload: any): Promise<any> {
    const items: SaleItemInput[] = (orderPayload.items || []).map((i: any) => ({
      productId: i.id || i.productId,
      productName: i.name || i.productName || 'Gas Product',
      quantitySold: Number(i.quantity || i.quantitySold || 0),
      emptiesReturned: Number(i.emptiesReturned || 0),
      emptiesDefective: Number(i.emptiesDefective || 0),
      unitPrice: Number(i.price || i.unitPrice || 0),
    }));

    try {
      const result = await this.processSale({
        customerId: orderPayload.customerId,
        customerName: orderPayload.customerName,
        items,
        paymentMethod: orderPayload.paymentMethod || 'CASH',
        paymentReference: orderPayload.paymentReference,
        paymentProofUri: orderPayload.paymentProofUri,
      });

      return {
        success: true,
        message: 'Order created successfully!',
        data: {
          orderId: result.order.id,
          transactionNo: result.order.transaction_no,
          receiptNumber: result.receiptNumber,
          totalAmount: result.order.total_amount,
          customerName: orderPayload.customerName,
          status: result.order.sync_status || 'PENDING',
          createdAt: result.order.transacted_at,
          order: result.order,
          newCustomerDebt: result.newCustomerDebt,
        },
      };
    } catch (err: any) {
      if (err instanceof InsufficientStockError || err?.code === 'INSUFFICIENT_STOCK') {
        return {
          success: false,
          code: 'INSUFFICIENT_STOCK',
          message: err.message,
          details: err.details || [],
        };
      }
      throw err;
    }
  },

  /**
   * Fetches orders placed by a specific customer.
   */
  async getOrdersByCustomer(customerId: string): Promise<any> {
    const filtered = await salesRepository.getOrdersByCustomerId(customerId);
    return {
      success: true,
      data: filtered.map((o) => ({
        orderId: o.id,
        receiptNumber: o.receipt_number,
        customerId: o.customer_id,
        customerName: o.customer_name,
        totalAmount: o.total_amount,
        paymentMethod: o.payment_method,
        status: o.sync_status,
        createdAt: o.transacted_at,
      })),
    };
  },
};
