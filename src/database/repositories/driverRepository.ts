import { getDatabase } from '../connection';
import {
  VehicleTelemetry,
  FuelLog,
  ApprehensionReport,
  VehicleIssueReport,
  MaintenanceServiceLogItem,
} from '@/types';

export const driverRepository = {
  // ==========================================
  // 1. Vehicle Telemetry & 5,000-km PM
  // ==========================================
  async getVehicleTelemetry(truckId?: string): Promise<VehicleTelemetry | null> {
    const db = await getDatabase();
    const row = truckId
      ? await db.getFirstAsync<{
          truck_id: string;
          plate_number: string;
          model: string;
          current_odometer: number;
          last_pm_odometer: number;
          status: string;
          last_serviced_at: string | null;
        }>(
          `SELECT * FROM local_vehicle_telemetry WHERE truck_id = ? LIMIT 1;`,
          [truckId]
        )
      : await db.getFirstAsync<{
          truck_id: string;
          plate_number: string;
          model: string;
          current_odometer: number;
          last_pm_odometer: number;
          status: string;
          last_serviced_at: string | null;
        }>(
          `SELECT * FROM local_vehicle_telemetry ORDER BY rowid DESC LIMIT 1;`
        );

    if (!row) return null;

    const distanceSinceLastPm = Math.max(0, row.current_odometer - row.last_pm_odometer);
    const isPmDue = distanceSinceLastPm >= 5000;
    const remainingKmBeforePm = Math.max(0, 5000 - distanceSinceLastPm);

    return {
      truck_id: row.truck_id,
      plate_number: row.plate_number,
      model: row.model,
      current_odometer: row.current_odometer,
      last_pm_odometer: row.last_pm_odometer,
      status: row.status as any,
      isPmDue,
      distanceSinceLastPm,
      remainingKmBeforePm,
      last_serviced_at: row.last_serviced_at,
    };
  },

  async saveVehicleTelemetry(telemetry: Omit<VehicleTelemetry, 'isPmDue' | 'distanceSinceLastPm' | 'remainingKmBeforePm'>): Promise<boolean> {
    const db = await getDatabase();
    let hasChanges = false;

    await db.withExclusiveTransactionAsync(async (txn) => {
      const existing = await txn.getFirstAsync<{
        truck_id: string;
        plate_number: string;
        model: string;
        current_odometer: number;
        last_pm_odometer: number;
        status: string;
        last_serviced_at: string | null;
      }>(
        'SELECT truck_id, plate_number, model, current_odometer, last_pm_odometer, status, last_serviced_at FROM local_vehicle_telemetry WHERE truck_id = ?;',
        [telemetry.truck_id]
      );

      // Protect monotonic odometer if there are unsynced local fuel logs or pending END_TRIP/LOG_FUEL mutations
      const pendingOdoRow = await txn.getFirstAsync<{ cnt: number }>(
        `SELECT (
          (SELECT COUNT(*) FROM local_fuel_logs WHERE truck_id = ? AND synced = 0) +
          (SELECT COUNT(*) FROM sync_queue WHERE operation_type IN ('LOG_FUEL', 'END_TRIP') AND status IN ('PENDING', 'PROCESSING'))
        ) AS cnt;`,
        [telemetry.truck_id]
      );
      const hasPendingOdometer = Number(pendingOdoRow?.cnt || 0) > 0;
      const effectiveOdometer =
        existing && hasPendingOdometer
          ? Math.max(Number(existing.current_odometer || 0), Number(telemetry.current_odometer || 0))
          : Number(telemetry.current_odometer || 0);

      if (
        !existing ||
        existing.plate_number !== telemetry.plate_number ||
        existing.model !== telemetry.model ||
        Number(existing.current_odometer) !== effectiveOdometer ||
        Number(existing.last_pm_odometer) !== Number(telemetry.last_pm_odometer || 0) ||
        existing.status !== telemetry.status ||
        (existing.last_serviced_at || null) !== (telemetry.last_serviced_at || null)
      ) {
        hasChanges = true;
      }

      await txn.runAsync(
        `INSERT INTO local_vehicle_telemetry (
          truck_id, plate_number, model, current_odometer, last_pm_odometer, status, last_serviced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(truck_id) DO UPDATE SET
          plate_number = excluded.plate_number,
          model = excluded.model,
          current_odometer = excluded.current_odometer,
          last_pm_odometer = excluded.last_pm_odometer,
          status = excluded.status,
          last_serviced_at = excluded.last_serviced_at;`,
        [
          telemetry.truck_id,
          telemetry.plate_number,
          telemetry.model,
          effectiveOdometer,
          telemetry.last_pm_odometer,
          telemetry.status,
          telemetry.last_serviced_at || null,
        ]
      );
    });

    return hasChanges;
  },

  async updateOdometer(truckId: string, newOdometer: number): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE local_vehicle_telemetry SET current_odometer = ? WHERE truck_id = ?;`,
      [newOdometer, truckId]
    );
  },

  // ==========================================
  // 3. Fuel Intake Logs
  // ==========================================
  async getFuelLogs(truckId?: string, limit: number = 20): Promise<FuelLog[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      id: string;
      truck_id: string;
      driver_id: string;
      liters: number;
      total_cost: number;
      odometer: number;
      receipt_photo_uri: string | null;
      logged_at: string;
      synced: number;
    }>(
      truckId
        ? `SELECT * FROM local_fuel_logs WHERE truck_id = ? ORDER BY logged_at DESC LIMIT ?;`
        : `SELECT * FROM local_fuel_logs ORDER BY logged_at DESC LIMIT ?;`,
      truckId ? [truckId, limit] : [limit]
    );

    return rows.map((r) => ({
      id: r.id,
      truck_id: r.truck_id,
      driver_id: r.driver_id,
      liters: r.liters,
      total_cost: r.total_cost,
      odometer: r.odometer,
      receipt_photo_uri: r.receipt_photo_uri,
      logged_at: r.logged_at,
      synced: Boolean(r.synced),
    }));
  },

  async saveFuelLog(log: FuelLog): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO local_fuel_logs (
        id, truck_id, driver_id, liters, total_cost, odometer, receipt_photo_uri, logged_at, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        liters = excluded.liters,
        total_cost = excluded.total_cost,
        odometer = excluded.odometer,
        receipt_photo_uri = COALESCE(excluded.receipt_photo_uri, local_fuel_logs.receipt_photo_uri),
        logged_at = excluded.logged_at,
        synced = excluded.synced
      WHERE local_fuel_logs.synced = 1;`,
      [
        log.id,
        log.truck_id,
        log.driver_id,
        log.liters,
        log.total_cost,
        log.odometer,
        log.receipt_photo_uri || null,
        log.logged_at,
        log.synced ? 1 : 0,
      ]
    );
  },

  async upsertFuelLogs(logs: FuelLog[]): Promise<boolean> {
    if (!Array.isArray(logs) || logs.length === 0) return false;
    const db = await getDatabase();
    let hasChanges = false;
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const log of logs) {
        if (!log?.id) continue;
        const existing = await txn.getFirstAsync<{
          id: string;
          liters: number;
          total_cost: number;
          odometer: number;
          logged_at: string;
          synced: number;
        }>(
          'SELECT id, liters, total_cost, odometer, logged_at, synced FROM local_fuel_logs WHERE id = ?;',
          [log.id]
        );
        if (existing && existing.synced === 0) {
          continue;
        }
        if (
          !existing ||
          Number(existing.liters) !== Number(log.liters) ||
          Number(existing.total_cost) !== Number(log.total_cost) ||
          Number(existing.odometer) !== Number(log.odometer) ||
          existing.logged_at !== log.logged_at
        ) {
          hasChanges = true;
        }
        await txn.runAsync(
          `INSERT INTO local_fuel_logs (
            id, truck_id, driver_id, liters, total_cost, odometer, receipt_photo_uri, logged_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            liters = excluded.liters,
            total_cost = excluded.total_cost,
            odometer = excluded.odometer,
            receipt_photo_uri = COALESCE(excluded.receipt_photo_uri, local_fuel_logs.receipt_photo_uri),
            logged_at = excluded.logged_at,
            synced = excluded.synced
          WHERE local_fuel_logs.synced = 1;`,
          [
            log.id,
            log.truck_id,
            log.driver_id,
            log.liters,
            log.total_cost,
            log.odometer,
            log.receipt_photo_uri || null,
            log.logged_at,
            log.synced ? 1 : 0,
          ]
        );
      }
    });
    return hasChanges;
  },

  // ==========================================
  // 3b. Vehicle Maintenance Service History
  // ==========================================
  async getMaintenanceLogs(truckId?: string, limit: number = 30): Promise<MaintenanceServiceLogItem[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<any>(
      truckId
        ? 'SELECT * FROM local_maintenance_logs WHERE truck_id = ? ORDER BY serviced_at DESC LIMIT ?;'
        : 'SELECT * FROM local_maintenance_logs ORDER BY serviced_at DESC LIMIT ?;',
      truckId ? [truckId, limit] : [limit]
    );
    return rows.map((r) => ({
      id: r.id,
      truckId: r.truck_id,
      serviceType: r.service_type || 'PM',
      title: r.title || r.service_type || 'Maintenance Service',
      description: r.description || undefined,
      odometerAtService: Number(r.odometer_at_service || 0),
      completedAt: r.serviced_at,
      cost: r.cost !== null && r.cost !== undefined ? Number(r.cost) : undefined,
    }));
  },

  async upsertMaintenanceLogs(truckId: string, logs: MaintenanceServiceLogItem[]): Promise<boolean> {
    if (!truckId || !Array.isArray(logs)) return false;
    const db = await getDatabase();
    let hasChanges = false;
    await db.withExclusiveTransactionAsync(async (txn) => {
      const existingRows = await txn.getAllAsync<{
        id: string;
        service_type: string | null;
        title: string | null;
        description: string | null;
        odometer_at_service: number;
        serviced_at: string;
      }>(
        'SELECT id, service_type, title, description, odometer_at_service, serviced_at FROM local_maintenance_logs WHERE truck_id = ?;',
        [truckId]
      );
      const existingMap = new Map<string, any>();
      for (const row of existingRows) {
        existingMap.set(row.id, row);
      }

      const incomingIds: string[] = [];
      for (const log of logs) {
        if (!log?.id) continue;
        incomingIds.push(log.id);
        const serviceType = log.serviceType || null;
        const title = log.title || log.serviceType || 'Maintenance Service';
        const description = log.description || null;
        const odometerAtService = Number(log.odometerAtService || 0);
        const cost = log.cost !== undefined && log.cost !== null ? Number(log.cost) : null;
        const completedAt = log.completedAt || new Date().toISOString();

        const prev = existingMap.get(log.id);
        if (
          !prev ||
          prev.service_type !== serviceType ||
          prev.title !== title ||
          prev.description !== description ||
          Number(prev.odometer_at_service) !== odometerAtService ||
          prev.serviced_at !== completedAt
        ) {
          hasChanges = true;
        }

        await txn.runAsync(
          `INSERT INTO local_maintenance_logs (
            id, truck_id, service_type, title, description, odometer_at_service, cost, serviced_at, next_pm_odometer, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            truck_id = excluded.truck_id,
            service_type = excluded.service_type,
            title = excluded.title,
            description = excluded.description,
            odometer_at_service = excluded.odometer_at_service,
            cost = excluded.cost,
            serviced_at = excluded.serviced_at;`,
          [log.id, truckId, serviceType, title, description, odometerAtService, cost, completedAt, null, completedAt]
        );
      }

      if (incomingIds.length > 0) {
        const activeSet = new Set(incomingIds);
        for (const prevId of existingMap.keys()) {
          if (!activeSet.has(prevId)) {
            hasChanges = true;
            break;
          }
        }
        const placeholders = incomingIds.map(() => '?').join(',');
        await txn.runAsync(
          `DELETE FROM local_maintenance_logs WHERE truck_id = ? AND id NOT IN (${placeholders});`,
          [truckId, ...incomingIds]
        );
      } else if (existingMap.size > 0) {
        hasChanges = true;
        await txn.runAsync('DELETE FROM local_maintenance_logs WHERE truck_id = ?;', [truckId]);
      }
    });
    return hasChanges;
  },

  // ==========================================
  // 4. Apprehensions / Citations
  // ==========================================
  async getApprehensions(truckId: string, limit: number = 20): Promise<ApprehensionReport[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      id: string;
      truck_id: string;
      driver_id: string;
      agency: string;
      citation_number: string | null;
      violation_notes: string;
      fine_amount: number | null;
      ticket_photo_uri: string;
      reported_at: string;
      synced: number;
    }>(
      `SELECT * FROM local_apprehensions WHERE truck_id = ? ORDER BY reported_at DESC LIMIT ?;`,
      [truckId, limit]
    );

    return rows.map((r) => ({
      id: r.id,
      truck_id: r.truck_id,
      driver_id: r.driver_id,
      agency: r.agency as any,
      citation_number: r.citation_number,
      violation_notes: r.violation_notes,
      fine_amount: r.fine_amount,
      ticket_photo_uri: r.ticket_photo_uri,
      reported_at: r.reported_at,
      synced: Boolean(r.synced),
    }));
  },

  async saveApprehension(report: ApprehensionReport): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO local_apprehensions (
        id, truck_id, driver_id, agency, citation_number, violation_notes, fine_amount, ticket_photo_uri, reported_at, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        report.id,
        report.truck_id,
        report.driver_id,
        report.agency,
        report.citation_number || null,
        report.violation_notes,
        report.fine_amount || null,
        report.ticket_photo_uri,
        report.reported_at,
        report.synced ? 1 : 0,
      ]
    );
  },

  // ==========================================
  // 5. Vehicle Incidents
  // ==========================================
  async saveVehicleIssue(issue: VehicleIssueReport): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO local_incidents (
        id, truck_id, driver_id, incident_type, description, severity, photo_uri, reported_at, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        issue.id,
        issue.truck_id,
        issue.driver_id,
        issue.incident_type,
        issue.description,
        issue.severity,
        issue.photo_uri || null,
        issue.reported_at,
        issue.synced ? 1 : 0,
      ]
    );
  },

  // ==========================================
  // 5. Sync Queue Status Synchronization
  // ==========================================
  async markFuelLogSynced(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(`UPDATE local_fuel_logs SET synced = 1 WHERE id = ?;`, [id]);
  },

  async markApprehensionSynced(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(`UPDATE local_apprehensions SET synced = 1 WHERE id = ?;`, [id]);
  },

  async markVehicleIssueSynced(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(`UPDATE local_incidents SET synced = 1 WHERE id = ?;`, [id]);
  },
};
