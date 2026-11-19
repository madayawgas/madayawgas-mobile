# MadayawGas Mobile — Local SQLite Database ERD

**Schema Version:** `2` (3NF Normalized)  
**Source of Truth:** [`src/database/schema.ts`](../src/database/schema.ts)  
**Isolation & Engine:** `expo-sqlite` with WAL mode, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000`, and per-account isolated database files (`madayawgas_<userId>.db` / `madayawgas_guest.db`).

---

## Entity Relationship Diagram

```mermaid
erDiagram
    local_users {
        TEXT id PK
        TEXT full_name
        TEXT role
        TEXT updated_at
    }

    local_service_zones {
        TEXT id PK
        TEXT code
        TEXT name
        TEXT description
        INTEGER is_active
    }

    local_product_catalog {
        TEXT product_id PK
        TEXT sku
        TEXT name
        TEXT category
        TEXT container_type
        REAL net_weight_kg
        REAL price
        INTEGER is_active
        TEXT updated_at
    }

    local_vehicles {
        TEXT truck_id PK
        TEXT plate_number
        TEXT model
        INTEGER current_odometer
        INTEGER last_pm_odometer
        TEXT status
        TEXT last_serviced_at
    }

    local_driver_vehicle_assignments {
        TEXT driver_id PK,FK
        TEXT truck_id FK
        TEXT assigned_at
    }

    local_active_trip {
        TEXT trip_id PK
        TEXT trip_number
        TEXT truck_id FK
        TEXT driver_id FK
        TEXT sales_user_id FK
        TEXT zone_id FK
        TEXT status
        TEXT dispatched_at
    }

    local_vehicle_inventory {
        TEXT product_id PK,FK
        INTEGER quantity_loaded
        INTEGER quantity_sold
        INTEGER quantity_remaining
    }

    local_customers {
        TEXT id PK
        TEXT business_name
        TEXT contact_person
        TEXT contact_number
        TEXT delivery_address
        TEXT customer_type
        TEXT zone_id FK
        INTEGER canister_debt
        INTEGER is_locally_created
        TEXT created_at
    }

    local_sales_orders {
        TEXT id PK
        TEXT transaction_no UK
        TEXT trip_id
        TEXT customer_id FK
        TEXT receipt_number UK
        REAL total_amount
        TEXT payment_method
        TEXT payment_reference
        TEXT transacted_at
        TEXT synced_at
        TEXT sync_status
        TEXT error_code
        TEXT error_message
    }

    local_sales_items {
        TEXT id PK
        TEXT sales_order_id FK
        TEXT product_id FK
        INTEGER quantity_sold
        INTEGER empties_returned
        INTEGER empties_defective
        REAL unit_price
        REAL subtotal
    }

    local_canister_ledger {
        TEXT id PK
        TEXT customer_id FK
        TEXT product_id FK
        TEXT trip_id
        TEXT transaction_id FK
        INTEGER quantity_loaned
        INTEGER quantity_returned
        INTEGER net_balance_change
        TEXT transacted_at
    }

    sync_queue {
        TEXT id PK
        TEXT user_id
        TEXT operation_type
        TEXT endpoint
        TEXT payload
        INTEGER retry_count
        TEXT status
        TEXT created_at
        TEXT last_attempted_at
        TEXT error_code
        TEXT error_message
        TEXT last_error
    }

    local_receipt_sequences {
        TEXT trip_id PK
        TEXT series_type PK
        INTEGER last_sequence
    }

    local_fuel_logs {
        TEXT id PK
        TEXT truck_id FK
        TEXT driver_id
        REAL liters
        REAL total_cost
        INTEGER odometer
        TEXT receipt_photo_uri
        TEXT logged_at
        INTEGER synced
    }

    local_apprehensions {
        TEXT id PK
        TEXT truck_id FK
        TEXT driver_id
        TEXT agency
        TEXT citation_number
        TEXT violation_notes
        REAL fine_amount
        TEXT ticket_photo_uri
        TEXT reported_at
        INTEGER synced
    }

    local_incidents {
        TEXT id PK
        TEXT truck_id FK
        TEXT driver_id
        TEXT incident_type
        TEXT description
        TEXT severity
        TEXT photo_uri
        TEXT reported_at
        INTEGER synced
    }

    local_maintenance_logs {
        TEXT id PK
        TEXT truck_id FK
        TEXT service_type
        TEXT title
        TEXT description
        INTEGER odometer_at_service
        REAL cost
        TEXT serviced_at
        INTEGER next_pm_odometer
        TEXT created_at
    }

    local_users ||--o| local_driver_vehicle_assignments : "assigned as driver"
    local_vehicles ||--o{ local_driver_vehicle_assignments : "assigned truck"

    local_vehicles ||--o{ local_active_trip : "dispatched on"
    local_users ||--o{ local_active_trip : "driver_id / sales_user_id"
    local_service_zones ||--o{ local_active_trip : "route zone"

    local_product_catalog ||--o| local_vehicle_inventory : "loaded stock"

    local_service_zones ||--o{ local_customers : "belongs to"
    local_customers ||--o{ local_sales_orders : "places"

    local_sales_orders ||--|{ local_sales_items : "contains"
    local_product_catalog ||--o{ local_sales_items : "sold item"

    local_customers ||--o{ local_canister_ledger : "tracks debt"
    local_product_catalog ||--o{ local_canister_ledger : "canister SKU"
    local_sales_orders ||--o{ local_canister_ledger : "recorded in"

    local_vehicles ||--o{ local_fuel_logs : "refueled"
    local_vehicles ||--o{ local_apprehensions : "cited"
    local_vehicles ||--o{ local_incidents : "reported"
    local_vehicles ||--o{ local_maintenance_logs : "serviced"
```

---

## Domain Grouping & Notes

| Domain | Tables | Notes |
| --- | --- | --- |
| **Identity, Fleet & Trip Dispatch** | `local_users`, `local_service_zones`, `local_vehicles`, `local_driver_vehicle_assignments`, `local_active_trip` | `local_service_zones` is pre-seeded with 7 canonical Davao delivery routes. `local_active_trip` references `truck_id`, `driver_id`, `sales_user_id`, and `zone_id` via FKs. |
| **Catalog & Truck Inventory** | `local_product_catalog`, `local_vehicle_inventory` | `local_vehicle_inventory` enforces `CHECK (quantity_remaining >= 0)` and resolves SKU/name via `local_product_catalog`. |
| **Customers, Sales & Canister Ledger** | `local_customers`, `local_sales_orders`, `local_sales_items`, `local_canister_ledger`, `local_receipt_sequences` | `local_sales_orders.trip_id` and `local_canister_ledger.trip_id` are logical trip references (not SQL FKs) so historical orders survive trip clears. `local_receipt_sequences` uses a composite PK `(trip_id, series_type)` for monotonic `INV` / `CD` numbering. |
| **Driver Operations & Maintenance** | `local_fuel_logs`, `local_apprehensions`, `local_incidents`, `local_maintenance_logs` | All four reference `local_vehicles(truck_id)`; `driver_id` is stored as a logical user identifier. |
| **Offline Store-and-Forward Sync** | `sync_queue` | Standalone mutation queue partitioned by `user_id` (`PENDING`, `PROCESSING`, `SYNCED`, `FAILED`, `QUARANTINED`). |
