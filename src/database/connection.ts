import * as SQLite from 'expo-sqlite';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

const GUEST_DB_NAME = 'madayawgas_guest.db';

let activeUserId: string | null = null;
let activeDbName: string = GUEST_DB_NAME;
let dbInstance: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function resolveDbNameForUser(userId?: string | null): string {
  if (!userId || !String(userId).trim()) {
    return GUEST_DB_NAME;
  }
  const sanitized = String(userId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return `madayawgas_${sanitized}.db`;
}

/**
 * Switches the active SQLite database file to the specified user's isolated file.
 * Closes any previously open database handle cleanly so accounts never share state.
 */
export async function setActiveDatabaseUser(userId: string | null): Promise<void> {
  const nextDbName = resolveDbNameForUser(userId);
  activeUserId = userId || null;

  if (nextDbName === activeDbName && (dbInstance || !initPromise)) {
    return;
  }

  if (initPromise) {
    try {
      await initPromise;
    } catch {
      // ignore failed prior init
    }
  }

  if (dbInstance) {
    try {
      await dbInstance.closeAsync();
    } catch (closeErr) {
      console.warn('[Database] Failed to close previous DB handle cleanly:', closeErr);
    }
    dbInstance = null;
  }

  initPromise = null;
  activeDbName = nextDbName;
}

export function getActiveDatabaseUser(): string | null {
  return activeUserId;
}

/**
 * Migrates any legacy (v0/v1) tables inside an existing DB file to the 3NF schema (v2)
 * while preserving queued mutations, orders, customers, and driver logs.
 */
async function migrateTo3NFIfNeeded(db: SQLite.SQLiteDatabase): Promise<void> {
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const currentVersion = Number(versionRow?.user_version ?? 0);

  if (currentVersion >= SCHEMA_VERSION) {
    return;
  }

  const legacyTelemetry = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='local_vehicle_telemetry';"
  );

  // If this is a brand-new database (no legacy tables), SCHEMA_SQL will create everything cleanly
  const anyLegacyTable = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='local_active_trip';"
  );

  if (!legacyTelemetry && !anyLegacyTable) {
    await db.execAsync(SCHEMA_SQL);
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    return;
  }

  // Legacy v1 database detected: migrate preserving user data
  console.log(`[Database] Migrating ${activeDbName} from v${currentVersion} to 3NF v${SCHEMA_VERSION}...`);

  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await db.withExclusiveTransactionAsync(async (txn) => {
      // 1. Ensure new v2 anchor tables exist
      await txn.execAsync(`
        CREATE TABLE IF NOT EXISTS local_users (
          id TEXT PRIMARY KEY,
          full_name TEXT NOT NULL,
          role TEXT,
          updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS local_vehicles (
          truck_id TEXT PRIMARY KEY,
          plate_number TEXT NOT NULL,
          model TEXT NOT NULL,
          current_odometer INTEGER NOT NULL DEFAULT 0,
          last_pm_odometer INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          last_serviced_at TEXT
        );
        CREATE TABLE IF NOT EXISTS local_driver_vehicle_assignments (
          driver_id TEXT PRIMARY KEY,
          truck_id TEXT NOT NULL,
          assigned_at TEXT NOT NULL
        );
      `);

      // 2. Migrate local_vehicle_telemetry -> local_vehicles
      if (legacyTelemetry) {
        await txn.execAsync(`
          INSERT OR IGNORE INTO local_vehicles (
            truck_id, plate_number, model, current_odometer, last_pm_odometer, status, last_serviced_at
          )
          SELECT truck_id, plate_number, model, current_odometer, last_pm_odometer, status, last_serviced_at
          FROM local_vehicle_telemetry;
          DROP TABLE IF EXISTS local_vehicle_telemetry;
        `);
      }

      // 3. Migrate sync_queue missing columns if needed
      const syncTableCheck = await txn.getFirstAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sync_queue';"
      );
      if (syncTableCheck) {
        const cols = await txn.getAllAsync<{ name: string }>('PRAGMA table_info(sync_queue);');
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has('user_id')) await txn.execAsync('ALTER TABLE sync_queue ADD COLUMN user_id TEXT;');
        if (!colNames.has('error_code')) await txn.execAsync('ALTER TABLE sync_queue ADD COLUMN error_code TEXT;');
        if (!colNames.has('error_message')) await txn.execAsync('ALTER TABLE sync_queue ADD COLUMN error_message TEXT;');
        if (!colNames.has('last_error')) await txn.execAsync('ALTER TABLE sync_queue ADD COLUMN last_error TEXT;');
      }

      // 4. Migrate local_active_trip (extract users/vehicles/zones, drop transitive columns)
      const tripCols = await txn.getAllAsync<{ name: string }>('PRAGMA table_info(local_active_trip);');
      const tripColNames = new Set(tripCols.map((c) => c.name));
      if (tripColNames.has('vehicle_plate') || tripColNames.has('driver_name')) {
        await txn.execAsync(`
          INSERT OR IGNORE INTO local_users (id, full_name, role)
          SELECT driver_id, COALESCE(driver_name, 'Driver'), 'DRIVER'
          FROM local_active_trip WHERE driver_id IS NOT NULL;

          INSERT OR IGNORE INTO local_users (id, full_name, role)
          SELECT sales_user_id, COALESCE(sales_user_name, 'Sales Agent'), 'SALES'
          FROM local_active_trip WHERE sales_user_id IS NOT NULL;

          INSERT OR IGNORE INTO local_vehicles (truck_id, plate_number, model)
          SELECT truck_id, COALESCE(vehicle_plate, 'N/A'), COALESCE(truck_model, 'Delivery Truck')
          FROM local_active_trip WHERE truck_id IS NOT NULL;

          CREATE TABLE local_active_trip_v2 (
            trip_id TEXT PRIMARY KEY,
            trip_number TEXT NOT NULL,
            truck_id TEXT,
            driver_id TEXT,
            sales_user_id TEXT NOT NULL,
            zone_id TEXT NOT NULL,
            status TEXT NOT NULL,
            dispatched_at TEXT NOT NULL
          );
          INSERT OR IGNORE INTO local_active_trip_v2 (
            trip_id, trip_number, truck_id, driver_id, sales_user_id, zone_id, status, dispatched_at
          )
          SELECT trip_id, trip_number, truck_id, driver_id, sales_user_id, zone_id, status, dispatched_at
          FROM local_active_trip;
          DROP TABLE local_active_trip;
          ALTER TABLE local_active_trip_v2 RENAME TO local_active_trip;
        `);
      }

      // 5. Migrate local_vehicle_inventory (seed catalog, drop transitive sku/product_name)
      const invCols = await txn.getAllAsync<{ name: string }>('PRAGMA table_info(local_vehicle_inventory);');
      const invColNames = new Set(invCols.map((c) => c.name));
      if (invColNames.has('product_name')) {
        await txn.execAsync(`
          CREATE TABLE IF NOT EXISTS local_product_catalog (
            product_id TEXT PRIMARY KEY,
            sku TEXT,
            name TEXT NOT NULL,
            category TEXT,
            container_type TEXT,
            net_weight_kg REAL,
            price REAL NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT
          );
          INSERT OR IGNORE INTO local_product_catalog (product_id, sku, name, price, is_active)
          SELECT product_id, sku, product_name, 0, 1 FROM local_vehicle_inventory;

          CREATE TABLE local_vehicle_inventory_v2 (
            product_id TEXT PRIMARY KEY,
            quantity_loaded INTEGER NOT NULL DEFAULT 0,
            quantity_sold INTEGER NOT NULL DEFAULT 0,
            quantity_remaining INTEGER NOT NULL DEFAULT 0 CHECK (quantity_remaining >= 0)
          );
          INSERT OR IGNORE INTO local_vehicle_inventory_v2 (
            product_id, quantity_loaded, quantity_sold, quantity_remaining
          )
          SELECT product_id, quantity_loaded, quantity_sold, quantity_remaining FROM local_vehicle_inventory;
          DROP TABLE local_vehicle_inventory;
          ALTER TABLE local_vehicle_inventory_v2 RENAME TO local_vehicle_inventory;
        `);
      }

      // 6. Migrate local_customers (drop duplicate name/address)
      const custCols = await txn.getAllAsync<{ name: string }>('PRAGMA table_info(local_customers);');
      const custColNames = new Set(custCols.map((c) => c.name));
      if (custColNames.has('name') || custColNames.has('address')) {
        await txn.execAsync(`
          CREATE TABLE local_customers_v2 (
            id TEXT PRIMARY KEY,
            business_name TEXT,
            contact_person TEXT,
            contact_number TEXT,
            delivery_address TEXT,
            customer_type TEXT,
            zone_id TEXT,
            canister_debt INTEGER NOT NULL DEFAULT 0,
            is_locally_created INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          );
          INSERT OR IGNORE INTO local_customers_v2 (
            id, business_name, contact_person, contact_number, delivery_address,
            customer_type, zone_id, canister_debt, is_locally_created, created_at
          )
          SELECT
            id,
            COALESCE(business_name, name),
            COALESCE(contact_person, name),
            contact_number,
            COALESCE(delivery_address, address),
            customer_type,
            zone_id,
            canister_debt,
            is_locally_created,
            created_at
          FROM local_customers;
          DROP TABLE local_customers;
          ALTER TABLE local_customers_v2 RENAME TO local_customers;
        `);
      }

      // 7. Migrate local_sales_orders (drop customer_name)
      const ordCols = await txn.getAllAsync<{ name: string }>('PRAGMA table_info(local_sales_orders);');
      const ordColNames = new Set(ordCols.map((c) => c.name));
      if (ordColNames.has('customer_name')) {
        const hasErrCode = ordColNames.has('error_code');
        const hasErrMsg = ordColNames.has('error_message');
        await txn.execAsync(`
          CREATE TABLE local_sales_orders_v2 (
            id TEXT PRIMARY KEY,
            transaction_no TEXT NOT NULL UNIQUE,
            trip_id TEXT NOT NULL,
            customer_id TEXT NOT NULL,
            receipt_number TEXT NOT NULL UNIQUE,
            total_amount REAL NOT NULL,
            payment_method TEXT NOT NULL,
            payment_reference TEXT,
            transacted_at TEXT NOT NULL,
            synced_at TEXT,
            sync_status TEXT NOT NULL DEFAULT 'PENDING',
            error_code TEXT,
            error_message TEXT
          );
          INSERT OR IGNORE INTO local_sales_orders_v2 (
            id, transaction_no, trip_id, customer_id, receipt_number, total_amount,
            payment_method, payment_reference, transacted_at, synced_at, sync_status,
            error_code, error_message
          )
          SELECT
            id, transaction_no, trip_id, customer_id, receipt_number, total_amount,
            payment_method, payment_reference, transacted_at, synced_at, sync_status,
            ${hasErrCode ? 'error_code' : 'NULL'},
            ${hasErrMsg ? 'error_message' : 'NULL'}
          FROM local_sales_orders;
          DROP TABLE local_sales_orders;
          ALTER TABLE local_sales_orders_v2 RENAME TO local_sales_orders;
        `);
      }

      // 8. Migrate local_sales_items (drop product_name)
      const itemCols = await txn.getAllAsync<{ name: string }>('PRAGMA table_info(local_sales_items);');
      const itemColNames = new Set(itemCols.map((c) => c.name));
      if (itemColNames.has('product_name')) {
        await txn.execAsync(`
          INSERT OR IGNORE INTO local_product_catalog (product_id, name, price, is_active)
          SELECT product_id, COALESCE(product_name, 'LPG Product'), unit_price, 1
          FROM local_sales_items;

          CREATE TABLE local_sales_items_v2 (
            id TEXT PRIMARY KEY,
            sales_order_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            quantity_sold INTEGER NOT NULL,
            empties_returned INTEGER NOT NULL DEFAULT 0,
            empties_defective INTEGER NOT NULL DEFAULT 0,
            unit_price REAL NOT NULL,
            subtotal REAL NOT NULL
          );
          INSERT OR IGNORE INTO local_sales_items_v2 (
            id, sales_order_id, product_id, quantity_sold,
            empties_returned, empties_defective, unit_price, subtotal
          )
          SELECT
            id, sales_order_id, product_id, quantity_sold,
            empties_returned, empties_defective, unit_price, subtotal
          FROM local_sales_items;
          DROP TABLE local_sales_items;
          ALTER TABLE local_sales_items_v2 RENAME TO local_sales_items;
        `);
      }
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }

  await db.execAsync(SCHEMA_SQL);
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

/**
 * Initializes and returns the active user's isolated SQLite database singleton.
 * Configures PRAGMA journal_mode = WAL and foreign_keys = ON.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  if (initPromise) {
    return initPromise;
  }

  const targetDbName = activeDbName;

  initPromise = (async () => {
    try {
      const db = await SQLite.openDatabaseAsync(targetDbName);

      // Enable WAL mode for high concurrency and resilience against app kills
      await db.execAsync('PRAGMA journal_mode = WAL;');
      await db.execAsync('PRAGMA foreign_keys = ON;');
      await db.execAsync('PRAGMA busy_timeout = 5000;');

      await migrateTo3NFIfNeeded(db);

      dbInstance = db;
      return db;
    } catch (err) {
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

/**
 * Resets all shift-specific tables in the active user's database.
 */
export async function resetShiftDatabase(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    DELETE FROM local_canister_ledger;
    DELETE FROM local_sales_items;
    DELETE FROM local_sales_orders;
    DELETE FROM local_active_trip;
    DELETE FROM local_vehicle_inventory;
    DELETE FROM local_receipt_sequences;
  `);
}

/**
 * Drops all local SQLite tables in the active user's database and recreates the fresh 3NF schema.
 */
export async function resetFullDatabase(): Promise<void> {
  const db = await getDatabase();
  try {
    await db.execAsync('PRAGMA foreign_keys = OFF;');
    await db.execAsync(`
      DROP TABLE IF EXISTS local_canister_ledger;
      DROP TABLE IF EXISTS local_sales_items;
      DROP TABLE IF EXISTS local_sales_orders;
      DROP TABLE IF EXISTS local_customers;
      DROP TABLE IF EXISTS local_vehicle_inventory;
      DROP TABLE IF EXISTS local_active_trip;
      DROP TABLE IF EXISTS local_driver_vehicle_assignments;
      DROP TABLE IF EXISTS sync_queue;
      DROP TABLE IF EXISTS local_receipt_sequences;
      DROP TABLE IF EXISTS local_fuel_logs;
      DROP TABLE IF EXISTS local_apprehensions;
      DROP TABLE IF EXISTS local_incidents;
      DROP TABLE IF EXISTS local_maintenance_logs;
      DROP TABLE IF EXISTS local_vehicles;
      DROP TABLE IF EXISTS local_users;
      DROP TABLE IF EXISTS local_service_zones;
      DROP TABLE IF EXISTS local_product_catalog;
      DROP TABLE IF EXISTS local_vehicle_telemetry;
    `);
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }

  await db.execAsync(SCHEMA_SQL);
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}
