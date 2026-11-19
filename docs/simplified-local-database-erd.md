# MadayawGas Mobile — Simplified Offline-First SQLite ERD

> **Database Engine**: `expo-sqlite` (WAL mode, `PRAGMA foreign_keys = ON`, per-account isolated `.db`)  
> **Schema Version**: `2` (3NF Normalized)  
> **Scope**: 10 Core Offline-First Tables (distilled from the 17-table [`local-database-erd.md`](./local-database-erd.md))  
> **Purpose**: Presentation-friendly (PPT) entity-relationship diagram highlighting the core local tables, keys, essential fields, and store-and-forward sync architecture.

---

## 1. Simplified Core SQLite ERD

```mermaid
---
config:
  layout: elk
  theme: neutral
---

erDiagram

    %% ========================================================
    %% 1. IDENTITY, FLEET & ACTIVE TRIP (4 Core Tables)
    %% ========================================================

    local_users {
        TEXT id PK
        TEXT full_name
        TEXT role
    }

    local_service_zones {
        TEXT id PK
        TEXT code
        TEXT name
    }

    local_vehicles {
        TEXT truck_id PK
        TEXT plate_number
        TEXT model
        INTEGER current_odometer
        TEXT status
    }

    local_active_trip {
        TEXT trip_id PK
        TEXT trip_number
        TEXT truck_id FK
        TEXT driver_id FK
        TEXT sales_user_id FK
        TEXT zone_id FK
        TEXT status
    }

    %% ========================================================
    %% 2. CATALOG & TRUCK INVENTORY (2 Core Tables)
    %% ========================================================

    local_product_catalog {
        TEXT product_id PK
        TEXT name
        TEXT category
        TEXT container_type
        REAL price
    }

    local_vehicle_inventory {
        TEXT product_id PK,FK
        INTEGER quantity_loaded
        INTEGER quantity_sold
        INTEGER quantity_remaining
    }

    %% ========================================================
    %% 3. OFFLINE CUSTOMERS & SALES (3 Core Tables)
    %% ========================================================

    local_customers {
        TEXT id PK
        TEXT zone_id FK
        TEXT business_name
        TEXT contact_person
        TEXT customer_type
        INTEGER canister_debt
    }

    local_sales_orders {
        TEXT id PK
        TEXT transaction_no UK
        TEXT trip_id
        TEXT customer_id FK
        TEXT receipt_number UK
        REAL total_amount
        TEXT payment_method
        TEXT sync_status
    }

    local_sales_items {
        TEXT id PK
        TEXT sales_order_id FK
        TEXT product_id FK
        INTEGER quantity_sold
        INTEGER empties_returned
        REAL subtotal
    }

    %% ========================================================
    %% 4. STORE-AND-FORWARD SYNC ENGINE (1 Core Table)
    %% ========================================================

    sync_queue {
        TEXT id PK
        TEXT user_id
        TEXT operation_type
        TEXT endpoint
        TEXT status
        INTEGER retry_count
    }

    %% ========================================================
    %% CORE RELATIONSHIPS
    %% ========================================================

    local_vehicles ||--o{ local_active_trip : "dispatched_on"
    local_users ||--o{ local_active_trip : "driver / sales_rep"
    local_service_zones ||--o{ local_active_trip : "route_zone"

    local_product_catalog ||--|| local_vehicle_inventory : "tracks_truck_stock"

    local_service_zones ||--o{ local_customers : "belongs_to"
    local_customers ||--o{ local_sales_orders : "places"
    local_sales_orders ||--|{ local_sales_items : "contains"
    local_product_catalog ||--o{ local_sales_items : "sold_item"

    local_users ||--o{ sync_queue : "queues_mutations"
```

---

## 2. Core Offline-First Layer Breakdown

| Offline Layer | Core Tables Included | Role in Offline-First Flow |
| :--- | :--- | :--- |
| **1. Identity, Fleet & Active Trip** | `local_users`, `local_service_zones`, `local_vehicles`, `local_active_trip` | Caches authenticated crew, Davao delivery zones, assigned truck telemetry, and the active shift/trip context. |
| **2. Catalog & Truck Inventory** | `local_product_catalog`, `local_vehicle_inventory` | Stores product pricing/metadata and enforces real-time truck stock counters (`quantity_remaining >= 0`) while offline. |
| **3. Offline Customers & Sales** | `local_customers`, `local_sales_orders`, `local_sales_items` | Enables offline customer lookup/creation, sales order capture, empty-cylinder return tracking, and local receipt generation. |
| **4. Store-and-Forward Sync** | `sync_queue` | Persists outbound API mutations (`PENDING`, `PROCESSING`, `SYNCED`, `FAILED`, `QUARANTINED`) for reliable background replay when connectivity returns. |

> For the complete 17-table local schema including `local_canister_ledger`, `local_receipt_sequences`, driver assignments, fuel logs, apprehensions, incidents, and maintenance logs, see [`local-database-erd.md`](./local-database-erd.md).
