/**
 * SQLite Database Schema Definitions for MadayawGas Mobile (3NF Normalized)
 */

export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
-- 1. Canonical User Identity Cache (for FK anchors on trips & driver assignments)
CREATE TABLE IF NOT EXISTS local_users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  role TEXT,
  updated_at TEXT
);

-- 2. Service Zones Directory
CREATE TABLE IF NOT EXISTS local_service_zones (
  id TEXT PRIMARY KEY,
  code TEXT,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- 3. Product Catalog Metadata Cache (Prices, Weights, Container Types)
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

-- 4. Vehicles & Telemetry (Normalized from local_vehicle_telemetry)
CREATE TABLE IF NOT EXISTS local_vehicles (
  truck_id TEXT PRIMARY KEY,
  plate_number TEXT NOT NULL,
  model TEXT NOT NULL,
  current_odometer INTEGER NOT NULL DEFAULT 0,
  last_pm_odometer INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  last_serviced_at TEXT
);

-- 5. Driver-to-Vehicle Assignment Mapping (1:1 active assignment per driver)
CREATE TABLE IF NOT EXISTS local_driver_vehicle_assignments (
  driver_id TEXT PRIMARY KEY,
  truck_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  FOREIGN KEY (driver_id) REFERENCES local_users (id) ON DELETE CASCADE,
  FOREIGN KEY (truck_id) REFERENCES local_vehicles (truck_id) ON DELETE CASCADE
);

-- 6. Active Shift / Trip Metadata (3NF: references truck, users, and zone by FK)
CREATE TABLE IF NOT EXISTS local_active_trip (
  trip_id TEXT PRIMARY KEY,
  trip_number TEXT NOT NULL,
  truck_id TEXT,
  driver_id TEXT,
  sales_user_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  status TEXT NOT NULL,
  dispatched_at TEXT NOT NULL,
  FOREIGN KEY (truck_id) REFERENCES local_vehicles (truck_id) ON DELETE SET NULL,
  FOREIGN KEY (driver_id) REFERENCES local_users (id) ON DELETE SET NULL,
  FOREIGN KEY (sales_user_id) REFERENCES local_users (id),
  FOREIGN KEY (zone_id) REFERENCES local_service_zones (id)
);

-- 7. Vehicle Inventory Counters (3NF: product metadata resolved via local_product_catalog)
CREATE TABLE IF NOT EXISTS local_vehicle_inventory (
  product_id TEXT PRIMARY KEY,
  quantity_loaded INTEGER NOT NULL DEFAULT 0,
  quantity_sold INTEGER NOT NULL DEFAULT 0,
  quantity_remaining INTEGER NOT NULL DEFAULT 0 CHECK (quantity_remaining >= 0),
  FOREIGN KEY (product_id) REFERENCES local_product_catalog (product_id)
);

-- 8. Customer Directory & Running Canister Debt Ledger (3NF: duplicate name/address removed)
CREATE TABLE IF NOT EXISTS local_customers (
  id TEXT PRIMARY KEY,
  business_name TEXT,
  contact_person TEXT,
  contact_number TEXT,
  delivery_address TEXT,
  customer_type TEXT,
  zone_id TEXT,
  canister_debt INTEGER NOT NULL DEFAULT 0,
  is_locally_created INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (zone_id) REFERENCES local_service_zones (id) ON DELETE SET NULL
);

-- 9. Sales Orders / Transactions (3NF: customer_name resolved via local_customers)
CREATE TABLE IF NOT EXISTS local_sales_orders (
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
  error_message TEXT,
  FOREIGN KEY (customer_id) REFERENCES local_customers (id)
);

-- 10. Sales Order Line Items (3NF: product_name resolved via local_product_catalog)
CREATE TABLE IF NOT EXISTS local_sales_items (
  id TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity_sold INTEGER NOT NULL,
  empties_returned INTEGER NOT NULL DEFAULT 0,
  empties_defective INTEGER NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL,
  subtotal REAL NOT NULL,
  FOREIGN KEY (sales_order_id) REFERENCES local_sales_orders (id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES local_product_catalog (product_id)
);

-- 11. Canister Swap Running Ledger
CREATE TABLE IF NOT EXISTS local_canister_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  quantity_loaned INTEGER NOT NULL DEFAULT 0,
  quantity_returned INTEGER NOT NULL DEFAULT 0,
  net_balance_change INTEGER NOT NULL,
  transacted_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES local_customers (id),
  FOREIGN KEY (product_id) REFERENCES local_product_catalog (product_id),
  FOREIGN KEY (transaction_id) REFERENCES local_sales_orders (id) ON DELETE CASCADE
);

-- 12. Store-and-Forward Mutation Sync Queue
CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  operation_type TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  payload TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL,
  last_attempted_at TEXT,
  error_code TEXT,
  error_message TEXT,
  last_error TEXT
);

-- 13. Monotonic Receipt Sequence Tracking (INV and CD series)
CREATE TABLE IF NOT EXISTS local_receipt_sequences (
  trip_id TEXT NOT NULL,
  series_type TEXT NOT NULL, -- 'INV' or 'CD'
  last_sequence INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trip_id, series_type)
);

-- 14. Vehicle Fuel Intake Logs
CREATE TABLE IF NOT EXISTS local_fuel_logs (
  id TEXT PRIMARY KEY,
  truck_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  liters REAL NOT NULL,
  total_cost REAL NOT NULL,
  odometer INTEGER NOT NULL,
  receipt_photo_uri TEXT,
  logged_at TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (truck_id) REFERENCES local_vehicles (truck_id)
);

-- 15. Roadside Traffic Apprehensions & Citations
CREATE TABLE IF NOT EXISTS local_apprehensions (
  id TEXT PRIMARY KEY,
  truck_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  agency TEXT NOT NULL,
  citation_number TEXT,
  violation_notes TEXT NOT NULL,
  fine_amount REAL,
  ticket_photo_uri TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (truck_id) REFERENCES local_vehicles (truck_id)
);

-- 16. Vehicle Incident & Breakdown Reports
CREATE TABLE IF NOT EXISTS local_incidents (
  id TEXT PRIMARY KEY,
  truck_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  incident_type TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  photo_uri TEXT,
  reported_at TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (truck_id) REFERENCES local_vehicles (truck_id)
);

-- 17. Vehicle Maintenance & Service History Cache
CREATE TABLE IF NOT EXISTS local_maintenance_logs (
  id TEXT PRIMARY KEY,
  truck_id TEXT NOT NULL,
  service_type TEXT,
  title TEXT,
  description TEXT,
  odometer_at_service INTEGER NOT NULL DEFAULT 0,
  cost REAL,
  serviced_at TEXT NOT NULL,
  next_pm_odometer INTEGER,
  created_at TEXT,
  FOREIGN KEY (truck_id) REFERENCES local_vehicles (truck_id)
);

-- Seed canonical MadayawGas delivery routes for offline instant resolution
INSERT OR IGNORE INTO local_service_zones (id, code, name, description, is_active) VALUES
  ('0df0e09d-3cea-4a88-88dc-835bb6d3ad8f', 'BANKEROHAN', 'Bankerohan Hub', 'Bankerohan Public Market and Central Commercial Hub', 1),
  ('de550109-9a9a-4f28-91b5-943c3efcc584', 'BUHANGIN', 'Buhangin Corridor', 'Buhangin Commercial Corridor and Subdivisions', 1),
  ('09a5c157-e23c-43a5-be82-91e5773a5c99', 'CALINAN', 'Calinan Zone', 'Calinan Agricultural and Residential Route', 1),
  ('9b4e4713-8c94-4b70-b08e-3eeaacee514e', 'MATINA', 'Matina Crossing', 'Matina Commercial Crossing and Institutional Area', 1),
  ('abd4f004-8cd0-43fb-88a3-518aeccf195e', 'PANACAN', 'Panacan Industrial', 'Panacan Industrial and Port District', 1),
  ('ab33aec7-f998-488e-aff5-3386007753a5', 'TORIL', 'Toril District', 'Toril Commercial, Agricultural and Residential Route', 1),
  ('7b8f9e6a-5432-41a9-83bc-9d0e12345678', 'DEFAULT', 'Toril Route', 'Primary operational default route', 1);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_customers_search ON local_customers (business_name, contact_person);
CREATE INDEX IF NOT EXISTS idx_customers_zone ON local_customers (zone_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_trip ON local_sales_orders (trip_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON local_sales_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_items_order ON local_sales_items (sales_order_id);
CREATE INDEX IF NOT EXISTS idx_sales_items_product ON local_sales_items (product_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue (status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_user_status ON sync_queue (user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_fuel_logs_truck ON local_fuel_logs (truck_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_apprehensions_truck ON local_apprehensions (truck_id, reported_at);
CREATE INDEX IF NOT EXISTS idx_incidents_truck ON local_incidents (truck_id, reported_at);
CREATE INDEX IF NOT EXISTS idx_service_zones_code ON local_service_zones (code);
CREATE INDEX IF NOT EXISTS idx_maintenance_logs_truck ON local_maintenance_logs (truck_id, serviced_at);
`;
