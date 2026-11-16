import { getDatabase } from '../connection';
import { VehicleInventory, TripStockItem } from '@/types';

export const inventoryRepository = {
  async getAllInventory(): Promise<VehicleInventory[]> {
    const db = await getDatabase();
    return db.getAllAsync<VehicleInventory>(
      'SELECT * FROM local_vehicle_inventory ORDER BY product_name ASC;'
    );
  },

  async getInventoryByProductId(productId: string): Promise<VehicleInventory | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<VehicleInventory>(
      'SELECT * FROM local_vehicle_inventory WHERE product_id = ?;',
      [productId]
    );
    return row || null;
  },

  async clearInventory(): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM local_vehicle_inventory;');
  },

  async syncTripInventory(tripId: string, stockItems: TripStockItem[]): Promise<boolean> {
    const db = await getDatabase();
    let hasChanges = false;
    await db.withExclusiveTransactionAsync(async (txn) => {
      const existingRows = await txn.getAllAsync<VehicleInventory>(
        'SELECT product_id, sku, product_name, quantity_loaded, quantity_sold, quantity_remaining FROM local_vehicle_inventory;'
      );
      const existingMap = new Map<string, VehicleInventory>();
      for (const row of existingRows) {
        existingMap.set(row.product_id, row);
      }

      // 1. Calculate local sales recorded for this trip so offline sales remain accounted for
      const soldRows = await txn.getAllAsync<{ product_id: string; total_sold: number }>(
        `SELECT si.product_id, COALESCE(SUM(si.quantity_sold), 0) AS total_sold
         FROM local_sales_items si
         JOIN local_sales_orders so ON si.sales_order_id = so.id
         WHERE so.trip_id = ?
         GROUP BY si.product_id;`,
        [tripId]
      );

      const soldMap = new Map<string, number>();
      for (const row of soldRows) {
        soldMap.set(row.product_id, row.total_sold);
      }

      const activeProductIds: string[] = [];

      // 2. Upsert each dispatched stock item
      for (const item of stockItems) {
        if (!item.productId) continue;
        activeProductIds.push(item.productId);

        const loadedUnits = Number(item.loadedFull ?? item.quantityUnits ?? 0);
        const soldUnits = soldMap.get(item.productId) || 0;
        const remainingUnits = Math.max(0, loadedUnits - soldUnits);

        const prev = existingMap.get(item.productId);
        if (
          !prev ||
          prev.sku !== (item.sku || null) ||
          prev.product_name !== item.productName ||
          Number(prev.quantity_loaded) !== loadedUnits ||
          Number(prev.quantity_sold) !== soldUnits ||
          Number(prev.quantity_remaining) !== remainingUnits
        ) {
          hasChanges = true;
        }

        await txn.runAsync(
          `INSERT INTO local_vehicle_inventory (
            product_id, sku, product_name, quantity_loaded, quantity_sold, quantity_remaining
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(product_id) DO UPDATE SET
            sku = excluded.sku,
            product_name = excluded.product_name,
            quantity_loaded = excluded.quantity_loaded,
            quantity_sold = excluded.quantity_sold,
            quantity_remaining = excluded.quantity_remaining;`,
          [
            item.productId,
            item.sku || null,
            item.productName,
            loadedUnits,
            soldUnits,
            remainingUnits,
          ]
        );
      }

      // 3. Remove products no longer in the active trip manifest
      if (activeProductIds.length > 0) {
        const activeSet = new Set(activeProductIds);
        for (const prevId of existingMap.keys()) {
          if (!activeSet.has(prevId)) {
            hasChanges = true;
            break;
          }
        }
        const placeholders = activeProductIds.map(() => '?').join(',');
        await txn.runAsync(
          `DELETE FROM local_vehicle_inventory WHERE product_id NOT IN (${placeholders});`,
          activeProductIds
        );
      } else {
        if (existingMap.size > 0) hasChanges = true;
        await txn.runAsync('DELETE FROM local_vehicle_inventory;');
      }
    });
    return hasChanges;
  },

  async getProductCatalog(): Promise<any[]> {
    const db = await getDatabase();
    return db.getAllAsync<any>(
      'SELECT * FROM local_product_catalog WHERE is_active = 1 ORDER BY name ASC;'
    );
  },

  async upsertProductCatalog(products: any[]): Promise<boolean> {
    if (!Array.isArray(products) || products.length === 0) return false;
    const db = await getDatabase();
    let hasChanges = false;
    await db.withExclusiveTransactionAsync(async (txn) => {
      const existingRows = await txn.getAllAsync<any>(
        'SELECT product_id, sku, name, category, container_type, net_weight_kg, price, is_active FROM local_product_catalog;'
      );
      const existingMap = new Map<string, any>();
      for (const row of existingRows) {
        existingMap.set(row.product_id, row);
      }

      for (const p of products) {
        if (!p?.id) continue;
        const sku = p.sku || null;
        const name = p.name || p.sku || 'Gas Product';
        const category = p.category || null;
        const containerType = p.containerType || p.container_type || null;
        const netWeightKg = p.netWeightKg !== undefined ? Number(p.netWeightKg) : (p.net_weight_kg !== undefined ? Number(p.net_weight_kg) : null);
        const price = Number(p.unitPrice ?? p.unit_price ?? p.price ?? 0);
        const isActive = p.isActive !== false ? 1 : 0;
        const updatedAt = p.updatedAt || p.updated_at || new Date().toISOString();

        const prev = existingMap.get(p.id);
        if (
          !prev ||
          prev.sku !== sku ||
          prev.name !== name ||
          prev.category !== category ||
          prev.container_type !== containerType ||
          Number(prev.net_weight_kg || 0) !== Number(netWeightKg || 0) ||
          Number(prev.price) !== price ||
          Number(prev.is_active) !== isActive
        ) {
          hasChanges = true;
        }

        await txn.runAsync(
          `INSERT INTO local_product_catalog (
            product_id, sku, name, category, container_type, net_weight_kg, price, is_active, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(product_id) DO UPDATE SET
            sku = excluded.sku,
            name = excluded.name,
            category = excluded.category,
            container_type = excluded.container_type,
            net_weight_kg = excluded.net_weight_kg,
            price = excluded.price,
            is_active = excluded.is_active,
            updated_at = excluded.updated_at;`,
          [p.id, sku, name, category, containerType, netWeightKg, price, isActive, updatedAt]
        );
      }
    });
    return hasChanges;
  },

  async seedInventory(items: VehicleInventory[]): Promise<void> {
    const db = await getDatabase();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync('DELETE FROM local_vehicle_inventory;');
      for (const item of items) {
        await txn.runAsync(
          `INSERT INTO local_vehicle_inventory (
            product_id, sku, product_name, quantity_loaded, quantity_sold, quantity_remaining
          ) VALUES (?, ?, ?, ?, ?, ?);`,
          [
            item.product_id,
            item.sku || null,
            item.product_name,
            item.quantity_loaded,
            item.quantity_sold,
            item.quantity_remaining,
          ]
        );
      }
    });
  },

  async decrementStock(productId: string, soldQty: number): Promise<void> {
    const db = await getDatabase();
    const res = await db.runAsync(
      `UPDATE local_vehicle_inventory
       SET quantity_sold = quantity_sold + ?,
           quantity_remaining = quantity_remaining - ?
       WHERE product_id = ? AND quantity_remaining >= ?;`,
      [soldQty, soldQty, productId, soldQty]
    );
    if (res.changes === 0) {
      const err: any = new Error(
        `INSUFFICIENT_STOCK: Cannot deduct ${soldQty} units for product ${productId}; insufficient stock on board.`
      );
      err.code = 'INSUFFICIENT_STOCK';
      throw err;
    }
  },
};
