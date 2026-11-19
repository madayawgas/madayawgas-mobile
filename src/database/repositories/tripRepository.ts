import { getDatabase } from '../connection';
import { ActiveTrip } from '@/types';

const ACTIVE_TRIP_SELECT = `
  SELECT
    t.trip_id,
    t.trip_number,
    t.truck_id,
    v.model AS truck_model,
    COALESCE(v.plate_number, 'N/A') AS vehicle_plate,
    t.driver_id,
    COALESCE(du.full_name, 'Driver') AS driver_name,
    t.sales_user_id,
    su.full_name AS sales_user_name,
    t.zone_id,
    z.name AS zone_name,
    t.status,
    t.dispatched_at
  FROM local_active_trip t
  LEFT JOIN local_vehicles v ON v.truck_id = t.truck_id
  LEFT JOIN local_users du ON du.id = t.driver_id
  LEFT JOIN local_users su ON su.id = t.sales_user_id
  LEFT JOIN local_service_zones z ON z.id = t.zone_id
`;

export const tripRepository = {
  async getActiveTrip(): Promise<ActiveTrip | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ActiveTrip>(`${ACTIVE_TRIP_SELECT} LIMIT 1;`);
    return row || null;
  },

  async getActiveTripForUser(userId: string): Promise<ActiveTrip | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ActiveTrip>(
      `${ACTIVE_TRIP_SELECT} WHERE t.sales_user_id = ? OR t.driver_id = ? LIMIT 1;`,
      [userId, userId]
    );
    return row || null;
  },

  async saveActiveTrip(trip: ActiveTrip): Promise<void> {
    const db = await getDatabase();
    const effectiveTripId = trip.trip_id || `TRIP-LOCAL-${Date.now()}`;
    const effectiveTripNumber = trip.trip_number || `TRIP-${effectiveTripId.substring(0, 8)}`;
    const effectiveSalesUserId = trip.sales_user_id || 'UNKNOWN';
    const effectiveZoneId = trip.zone_id || '7b8f9e6a-5432-41a9-83bc-9d0e12345678';
    const now = new Date().toISOString();

    await db.withExclusiveTransactionAsync(async (txn) => {
      // 1. Ensure referenced zone exists
      await txn.runAsync(
        `INSERT OR IGNORE INTO local_service_zones (id, code, name, is_active)
         VALUES (?, ?, ?, 1);`,
        [effectiveZoneId, effectiveZoneId, trip.zone_name || 'Delivery Zone']
      );

      // 2. Ensure referenced users exist
      await txn.runAsync(
        `INSERT INTO local_users (id, full_name, role, updated_at)
         VALUES (?, ?, 'SALES', ?)
         ON CONFLICT(id) DO UPDATE SET
           full_name = COALESCE(NULLIF(excluded.full_name, ''), local_users.full_name),
           updated_at = excluded.updated_at;`,
        [effectiveSalesUserId, trip.sales_user_name || 'Sales Agent', now]
      );

      if (trip.driver_id) {
        await txn.runAsync(
          `INSERT INTO local_users (id, full_name, role, updated_at)
           VALUES (?, ?, 'DRIVER', ?)
           ON CONFLICT(id) DO UPDATE SET
             full_name = COALESCE(NULLIF(excluded.full_name, ''), local_users.full_name),
             updated_at = excluded.updated_at;`,
          [trip.driver_id, trip.driver_name || 'Driver', now]
        );
      }

      // 3. Ensure referenced vehicle exists
      if (trip.truck_id) {
        await txn.runAsync(
          `INSERT INTO local_vehicles (truck_id, plate_number, model)
           VALUES (?, ?, ?)
           ON CONFLICT(truck_id) DO UPDATE SET
             plate_number = COALESCE(NULLIF(excluded.plate_number, 'N/A'), local_vehicles.plate_number),
             model = COALESCE(NULLIF(excluded.model, ''), local_vehicles.model);`,
          [trip.truck_id, trip.vehicle_plate || 'N/A', trip.truck_model || 'Delivery Truck']
        );
      }

      // 4. Upsert normalized trip row
      await txn.runAsync(
        `INSERT OR REPLACE INTO local_active_trip (
          trip_id, trip_number, truck_id, driver_id, sales_user_id, zone_id, status, dispatched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          effectiveTripId,
          effectiveTripNumber,
          trip.truck_id || null,
          trip.driver_id || null,
          effectiveSalesUserId,
          effectiveZoneId,
          trip.status || 'IN_PROGRESS',
          trip.dispatched_at || now,
        ]
      );
    });
  },

  async clearActiveTrip(): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM local_active_trip;');
  },

  async updateTripStatus(tripId: string, status: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE local_active_trip SET status = ? WHERE trip_id = ?;',
      [status, tripId]
    );
  },
};
