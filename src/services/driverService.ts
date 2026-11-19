import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import {
  driverRepository,
  tripRepository,
  syncQueueRepository,
  getActiveDatabaseUser,
} from '@/database';
import { driverApi, tripApi } from '@/api';
import { UUID_REGEX } from '@/api/endpoints/driverApi';
import {
  UserSession,
  VehicleTelemetry,
  FuelLog,
  ApprehensionReport,
  VehicleIssueReport,
  EmergencyAlertPayload,
  EmergencyType,
  ApprehendingAgency,
  IssueSeverity,
  MaintenanceServiceLogItem,
  ActiveTrip,
} from '@/types';
import { mediaService } from './mediaService';
import { dataRevalidator } from './dataRevalidator';
import type { LocalFirstReadOptions } from './salesService';
import { networkSentinel } from '@/sync/networkSentinel';
import { driverRealtimeManager, DriverRealtimeListener } from '@/realtime';

export interface DriverDashboardContext {
  trip: ActiveTrip | null;
  telemetry: VehicleTelemetry;
  pendingSyncCount: number;
}

export interface VehicleHealthData {
  telemetry: VehicleTelemetry;
  fuelLogs: FuelLog[];
  maintenanceLogs: MaintenanceServiceLogItem[];
}

async function revalidateDriverDashboard(user: UserSession, force: boolean): Promise<void> {
  await dataRevalidator.run(
    'driver:dashboard',
    async ({ isSessionStillValid }) => {
      try {
        const assignment = await tripApi.fetchActiveAssignment();
        if (!(await isSessionStillValid())) return;

        const currentLocal = await tripRepository.getActiveTrip();
        if (assignment?.trip && assignment.trip.id) {
          const rawTrip = assignment.trip as any;
          const tripId = rawTrip.id;
          const tripNumber =
            rawTrip.tripNumber ||
            rawTrip.trip_number ||
            `TRIP-${tripId.substring(0, 8)}`;
          const userDisplayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Driver';

          const nextTrip: ActiveTrip = {
            trip_id: tripId,
            trip_number: tripNumber,
            vehicle_plate:
              rawTrip.truckPlateNumber ||
              rawTrip.truck_plate_number ||
              rawTrip.truck?.plateNumber ||
              rawTrip.truck?.plate_number ||
              rawTrip.vehiclePlate ||
              rawTrip.vehicle_plate ||
              'N/A',
            driver_name:
              rawTrip.driverName ||
              rawTrip.driver_name ||
              rawTrip.driver?.fullName ||
              userDisplayName,
            sales_user_id: rawTrip.salesUserId || rawTrip.sales_user_id || user.id,
            zone_id: rawTrip.zoneId || rawTrip.zone_id || 'DEFAULT',
            status: rawTrip.status || 'IN_PROGRESS',
            dispatched_at: rawTrip.departureTime || rawTrip.departure_time || new Date().toISOString(),
            truck_id: rawTrip.truckId || rawTrip.truck_id || rawTrip.truck?.id || null,
            truck_model: rawTrip.truckModel || rawTrip.truck_model || rawTrip.truck?.model || null,
            driver_id: rawTrip.driverId || rawTrip.driver_id || rawTrip.driver?.id || user.id,
            sales_user_name: rawTrip.salesUserName || rawTrip.sales_user_name || rawTrip.salesUser?.fullName || null,
            zone_name: rawTrip.zoneName || rawTrip.zone_name || rawTrip.zone?.name || null,
          };

          const tripChanged =
            !currentLocal ||
            currentLocal.trip_id !== nextTrip.trip_id ||
            currentLocal.status !== nextTrip.status ||
            currentLocal.vehicle_plate !== nextTrip.vehicle_plate ||
            currentLocal.zone_id !== nextTrip.zone_id;

          await tripRepository.saveActiveTrip(nextTrip);
          if (tripChanged) {
            dataRevalidator.emit('TRIP_UPDATED');
          }
        } else if (currentLocal) {
          await tripRepository.clearActiveTrip();
          dataRevalidator.emit('TRIP_UPDATED');
        }
      } catch (e) {
        console.warn('[DriverService] Background assignment revalidation warning:', e);
      }

      const userDisplayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Driver';
      try {
        const myVehicle = await driverApi.fetchMyVehicle();
        if (!(await isSessionStillValid())) return;
        if (myVehicle) {
          const changed = await driverRepository.saveVehicleTelemetry(myVehicle, user.id, userDisplayName);
          if (changed) {
            dataRevalidator.emit('TELEMETRY_UPDATED');
          }
        } else {
          const cleared = await driverRepository.clearDriverVehicleAssignment(user.id);
          if (cleared) {
            dataRevalidator.emit('TELEMETRY_UPDATED');
          }
        }
      } catch (e: any) {
        const isUnassigned = e?.status === 404 || String(e?.message || '').includes('No assigned vehicle');
        if (isUnassigned && (await isSessionStillValid())) {
          const cleared = await driverRepository.clearDriverVehicleAssignment(user.id);
          if (cleared) {
            dataRevalidator.emit('TELEMETRY_UPDATED');
          }
        } else {
          console.warn('[DriverService] Background fetchMyVehicle warning:', e);
        }
      }
    },
    { force }
  );
}

async function revalidateVehicleHealth(
  truckId: string | undefined,
  force: boolean,
  driverId?: string,
  driverName?: string
): Promise<void> {
  const key = `driver:health:${truckId || driverId || 'default'}`;
  await dataRevalidator.run(
    key,
    async ({ isSessionStillValid }) => {
      let resolvedTruckId = truckId;
      try {
        const myVehicle = await driverApi.fetchMyVehicle();
        if (!(await isSessionStillValid())) return;
        if (myVehicle) {
          resolvedTruckId = myVehicle.truck_id || resolvedTruckId;
          const changed = await driverRepository.saveVehicleTelemetry(myVehicle, driverId, driverName);
          if (changed) {
            dataRevalidator.emit('TELEMETRY_UPDATED');
          }
        } else if (driverId) {
          const cleared = await driverRepository.clearDriverVehicleAssignment(driverId);
          if (cleared) {
            dataRevalidator.emit('TELEMETRY_UPDATED');
          }
        }
      } catch (e: any) {
        const isUnassigned = e?.status === 404 || String(e?.message || '').includes('No assigned vehicle');
        if (isUnassigned && driverId && (await isSessionStillValid())) {
          const cleared = await driverRepository.clearDriverVehicleAssignment(driverId);
          if (cleared) {
            dataRevalidator.emit('TELEMETRY_UPDATED');
          }
        } else {
          console.warn('[DriverService] Background vehicle telemetry warning:', e);
        }
      }

      if (!resolvedTruckId) return;

      try {
        const remoteFuel = await driverApi.fetchFuelHistory(resolvedTruckId);
        if (!(await isSessionStillValid())) return;
        if (Array.isArray(remoteFuel) && remoteFuel.length > 0) {
          const fuelChanged = await driverRepository.upsertFuelLogs(remoteFuel);
          if (fuelChanged) {
            dataRevalidator.emit('FUEL_LOGS_UPDATED');
          }
        }
      } catch (e) {
        console.warn('[DriverService] Background fuel history warning:', e);
      }

      try {
        const remoteLogs = await driverApi.fetchMaintenanceLogs(resolvedTruckId);
        if (!(await isSessionStillValid())) return;
        if (Array.isArray(remoteLogs)) {
          const maintChanged = await driverRepository.upsertMaintenanceLogs(resolvedTruckId, remoteLogs);
          if (maintChanged) {
            dataRevalidator.emit('MAINTENANCE_LOGS_UPDATED');
          }
        }
      } catch (e) {
        console.warn('[DriverService] Background maintenance logs warning:', e);
      }
    },
    { force }
  );
}

export const driverService = {
  /**
   * Local-First: Immediately returns cached dashboard operational context from SQLite
   * and triggers deduplicated background revalidation when online.
   */
  async getDashboardContext(
    user: UserSession,
    options: LocalFirstReadOptions = {}
  ): Promise<DriverDashboardContext> {
    if (options.forceRefresh) {
      await revalidateDriverDashboard(user, true);
    } else if (!options.skipRevalidate) {
      void revalidateDriverDashboard(user, false);
    }

    let activeTrip = await tripRepository.getActiveTrip();
    if (activeTrip && activeTrip.driver_id && activeTrip.driver_id !== user.id) {
      await tripRepository.clearActiveTrip();
      activeTrip = null;
    }

    let telemetry = await driverRepository.getVehicleTelemetry(undefined, user.id);
    if (!telemetry) {
      telemetry = {
        truck_id: activeTrip?.truck_id || '',
        plate_number: activeTrip?.vehicle_plate || 'N/A',
        model: activeTrip?.truck_model || 'Delivery Truck',
        current_odometer: 0,
        last_pm_odometer: 0,
        status: 'ACTIVE',
        isPmDue: false,
        distanceSinceLastPm: 0,
        remainingKmBeforePm: 5000,
        last_serviced_at: null,
      };
    }

    const pendingSyncCount = await syncQueueRepository.getPendingCount(user.id);

    return {
      trip: activeTrip,
      telemetry,
      pendingSyncCount,
    };
  },

  /**
   * Emergency SOS Dispatch
   */
  async triggerEmergencySos(
    user: UserSession,
    emergencyType: EmergencyType = 'ACCIDENT',
    description: string = 'Driver pressed emergency SOS in cabin.'
  ): Promise<any> {
    let latitude: number | null = 7.1907; // Davao refilling plant baseline fallback
    let longitude: number | null = 125.4553;

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        latitude = loc.coords.latitude;
        longitude = loc.coords.longitude;
      }
    } catch (e) {
      console.warn('[DriverService] Could not obtain GPS coordinates:', e);
    }

    const activeTrip = await tripRepository.getActiveTrip();
    const localTelemetry = await driverRepository.getVehicleTelemetry();
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let vehicleId = localTelemetry?.truck_id || activeTrip?.truck_id || '';

    // Only attach candidateTripId if it belongs to this driver
    const isDriverTrip = !activeTrip?.driver_id || activeTrip.driver_id === user.id;
    let candidateTripId =
      isDriverTrip && activeTrip?.trip_id && UUID_REGEX.test(activeTrip.trip_id)
        ? activeTrip.trip_id
        : null;

    const alertPayload: EmergencyAlertPayload = {
      driverId: user.id,
      vehicleId: UUID_REGEX.test(vehicleId) ? vehicleId : '',
      tripId: candidateTripId,
      emergencyType,
      description,
      location: { latitude, longitude },
    };

    const alertId = `sos-${Date.now()}`;

    // Life-critical Emergency SOS: Always attempt direct HTTP dispatch first
    try {
      const result = await driverApi.triggerEmergencyAlert(alertPayload);
      return result;
    } catch (e: any) {
      const errMsg = e?.message || '';
      if (
        errMsg.includes('emergency_alerts_trip_id_fkey') ||
        errMsg.includes('foreign key constraint') ||
        errMsg.includes('trip_id')
      ) {
        console.warn(
          '[DriverService] Stale trip ID rejected by server foreign key constraint. Retrying SOS without trip ID and clearing stale local trip.'
        );
        await tripRepository.clearActiveTrip();
        candidateTripId = null;
        try {
          const fallbackPayload: EmergencyAlertPayload = {
            ...alertPayload,
            tripId: null,
          };
          const result = await driverApi.triggerEmergencyAlert(fallbackPayload);
          return result;
        } catch (retryErr: any) {
          console.warn('[DriverService] Fallback direct SOS attempt failed:', retryErr.message);
        }
      }
      console.warn('[DriverService] Direct SOS attempt failed/offline, queueing for automatic delivery:', e.message);
    }

    await syncQueueRepository.enqueue({
      id: alertId,
      user_id: user.id,
      operation_type: 'EMERGENCY_SOS',
      endpoint: '/operations/alerts',
      payload: JSON.stringify({
        driverId: user.id,
        emergencyType,
        description,
        latitude,
        longitude,
        ...(UUID_REGEX.test(vehicleId) ? { vehicleId } : {}),
        ...(candidateTripId ? { tripId: candidateTripId } : {}),
      }),
    });

    return {
      id: alertId,
      status: 'QUEUED_OFFLINE',
      message: 'Emergency SOS queued locally. Will transmit automatically when connectivity is restored.',
    };
  },

  /**
   * Log Fuel Intake
   */
  async logFuel(
    user: UserSession,
    data: {
      liters: number;
      totalCost: number;
      odometer: number;
      receiptPhotoUri?: string | null;
      truckId?: string;
    }
  ): Promise<{ fuelLog: FuelLog; telemetry: VehicleTelemetry }> {
    const localTelemetry = await driverRepository.getVehicleTelemetry();
    const activeTrip = await tripRepository.getActiveTrip();
    const truckId = data.truckId || localTelemetry?.truck_id || activeTrip?.truck_id || '';

    // 1. Monotonic validation
    const currentTelemetry = truckId ? await driverRepository.getVehicleTelemetry(truckId) : localTelemetry;
    const baselineOdo = currentTelemetry?.current_odometer || 0;
    if (data.odometer < baselineOdo) {
      throw new Error(
        `Odometer reading (${data.odometer.toLocaleString()} km) cannot be lower than current vehicle odometer (${baselineOdo.toLocaleString()} km).`
      );
    }

    // 2. Compress and cache receipt photo if provided
    let cachedPhotoUri: string | null = null;
    let receiptMediaKey: string | null = null;
    if (data.receiptPhotoUri) {
      const cached = await mediaService.processAndCacheImage(data.receiptPhotoUri, 'fuel_receipt');
      cachedPhotoUri = cached.localUri;
      if (networkSentinel.isOnline()) {
        try {
          const uploadRes = await mediaService.uploadMedia(cached.localUri, 'maintenance/receipts');
          receiptMediaKey = uploadRes.storageKey;
        } catch (err) {
          console.warn('[DriverService] Remote receipt upload postponed to sync:', err);
        }
      }
    }

    const logId = `fuel-${Date.now()}`;
    const now = new Date().toISOString();

    const fuelLog: FuelLog = {
      id: logId,
      truck_id: truckId,
      driver_id: user.id,
      liters: data.liters,
      total_cost: data.totalCost,
      odometer: data.odometer,
      receipt_photo_uri: cachedPhotoUri,
      logged_at: now,
      synced: false,
    };

    // 3. Atomic local writes: Save fuel log & update telemetry odometer
    await driverRepository.saveFuelLog(fuelLog);
    if (truckId) {
      await driverRepository.updateOdometer(truckId, data.odometer);
    }

    // 4. Try remote post or queue
    const payload = {
      truckId,
      vehicleId: truckId,
      driverId: user.id,
      liters: data.liters,
      litersPumped: data.liters,
      totalCost: data.totalCost,
      odometer: data.odometer,
      odometerReading: data.odometer,
      receiptPhotoUri: cachedPhotoUri,
      receiptMediaKey: receiptMediaKey || cachedPhotoUri,
      fueledAt: now,
      timestamp: now,
    };

    let postedDirectly = false;
    const hasPendingPhoto = Boolean(data.receiptPhotoUri && !receiptMediaKey);
    if (networkSentinel.isOnline() && !hasPendingPhoto) {
      try {
        await driverApi.postFuelLog(payload);
        fuelLog.synced = true;
        await driverRepository.markFuelLogSynced(logId);
        postedDirectly = true;
      } catch (e: any) {
        console.warn('[DriverService] Remote fuel log failed, queued offline:', e.message);
      }
    }

    if (!postedDirectly) {
      await syncQueueRepository.enqueue({
        id: logId,
        user_id: user.id,
        operation_type: 'LOG_FUEL',
        endpoint: '/operations/fuel',
        payload: JSON.stringify(payload),
      });
    }

    const updatedTelemetry = truckId
      ? await driverRepository.getVehicleTelemetry(truckId)
      : await driverRepository.getVehicleTelemetry();

    const fallbackTelem: VehicleTelemetry = {
      truck_id: truckId,
      plate_number: activeTrip?.vehicle_plate || 'N/A',
      model: activeTrip?.truck_model || 'Delivery Truck',
      current_odometer: data.odometer,
      last_pm_odometer: currentTelemetry?.last_pm_odometer || 0,
      status: 'ACTIVE',
      isPmDue: false,
      distanceSinceLastPm: Math.max(0, data.odometer - (currentTelemetry?.last_pm_odometer || 0)),
      remainingKmBeforePm: Math.max(0, 5000 - Math.max(0, data.odometer - (currentTelemetry?.last_pm_odometer || 0))),
      last_serviced_at: null,
    };

    return {
      fuelLog,
      telemetry: updatedTelemetry || fallbackTelem,
    };
  },

  /**
   * Report Roadside Traffic Apprehension / Citation
   */
  async reportApprehension(
    user: UserSession,
    data: {
      agency: ApprehendingAgency;
      violationNotes: string;
      citationNumber?: string | null;
      fineAmount?: number | null;
      ticketPhotoUri: string; // Mandatory
      truckId?: string;
    }
  ): Promise<ApprehensionReport> {
    if (!data.ticketPhotoUri) {
      throw new Error('Mandatory citation ticket photo proof is required before submission.');
    }

    const localTelemetry = await driverRepository.getVehicleTelemetry();
    const activeTrip = await tripRepository.getActiveTrip();
    const truckId = data.truckId || localTelemetry?.truck_id || activeTrip?.truck_id || '';

    // Compress & cache mandatory ticket photo
    const cached = await mediaService.processAndCacheImage(data.ticketPhotoUri, 'citation_ticket');
    let ticketMediaKey: string | null = null;
    if (networkSentinel.isOnline()) {
      try {
        const uploadRes = await mediaService.uploadMedia(cached.localUri, 'fleet/apprehensions');
        ticketMediaKey = uploadRes.storageKey;
      } catch (err) {
        console.warn('[DriverService] Ticket upload postponed to sync:', err);
      }
    }

    const reportId = `citation-${Date.now()}`;
    const now = new Date().toISOString();

    const report: ApprehensionReport = {
      id: reportId,
      truck_id: truckId,
      driver_id: user.id,
      agency: data.agency,
      citation_number: data.citationNumber || null,
      violation_notes: data.violationNotes,
      fine_amount: data.fineAmount || null,
      ticket_photo_uri: cached.localUri,
      reported_at: now,
      synced: false,
    };

    await driverRepository.saveApprehension(report);

    const payload = {
      truckId,
      vehicleId: truckId,
      driverId: user.id,
      agency: data.agency,
      citationNumber: data.citationNumber || null,
      violationType: data.violationNotes || 'TRAFFIC_CITATION',
      violationNotes: data.violationNotes,
      fineAmount: data.fineAmount || null,
      ticketPhotoUri: cached.localUri,
      ticketMediaKey: ticketMediaKey || cached.localUri,
      reportedAt: now,
      timestamp: now,
    };

    let postedDirectly = false;
    if (networkSentinel.isOnline() && ticketMediaKey) {
      try {
        await driverApi.postApprehension(payload);
        report.synced = true;
        await driverRepository.markApprehensionSynced(reportId);
        postedDirectly = true;
      } catch (e: any) {
        console.warn('[DriverService] Remote apprehension failed, queued offline:', e.message);
      }
    }

    if (!postedDirectly) {
      await syncQueueRepository.enqueue({
        id: reportId,
        user_id: user.id,
        operation_type: 'REPORT_APPREHENSION',
        endpoint: '/operations/apprehensions',
        payload: JSON.stringify(payload),
      });
    }

    return report;
  },

  /**
   * Report Vehicle Issue / Breakdown
   */
  async reportVehicleIssue(
    user: UserSession,
    data: {
      incidentType: string;
      description: string;
      severity: IssueSeverity;
      photoUri?: string | null;
      truckId?: string;
    }
  ): Promise<VehicleIssueReport> {
    const localTelemetry = await driverRepository.getVehicleTelemetry();
    const activeTrip = await tripRepository.getActiveTrip();
    const truckId = data.truckId || localTelemetry?.truck_id || activeTrip?.truck_id || '';

    let cachedPhotoUri: string | null = null;
    let photoMediaKey: string | null = null;
    if (data.photoUri) {
      const cached = await mediaService.processAndCacheImage(data.photoUri, 'incident');
      cachedPhotoUri = cached.localUri;
      if (networkSentinel.isOnline()) {
        try {
          const uploadRes = await mediaService.uploadMedia(cached.localUri, 'maintenance/incidents');
          photoMediaKey = uploadRes.storageKey;
        } catch (err) {
          console.warn('[DriverService] Incident photo upload postponed to sync:', err);
        }
      }
    }

    const issueId = `incident-${Date.now()}`;
    const now = new Date().toISOString();

    const issue: VehicleIssueReport = {
      id: issueId,
      truck_id: truckId,
      driver_id: user.id,
      incident_type: data.incidentType,
      description: data.description,
      severity: data.severity,
      photo_uri: cachedPhotoUri,
      reported_at: now,
      synced: false,
    };

    await driverRepository.saveVehicleIssue(issue);

    // Map incident type string to integer ID for backend compatibility
    const typeUpper = (data.incidentType || '').toUpperCase();
    let incidentTypeId = 1; // Default MECHANICAL_DEFECT
    if (typeUpper.includes('ACCIDENT') || typeUpper.includes('CRASH')) {
      incidentTypeId = 2; // ROAD_ACCIDENT
    } else if (typeUpper.includes('TIRE') || typeUpper.includes('PUNCTURE') || typeUpper.includes('FLAT')) {
      incidentTypeId = 3; // TIRE_FAILURE
    } else if (typeUpper.includes('LEAK') || typeUpper.includes('OIL') || typeUpper.includes('GAS')) {
      incidentTypeId = 4; // LEAK_ISSUE
    }

    const payload = {
      truckId,
      vehicleId: truckId,
      driverId: user.id,
      incidentTypeId,
      incidentType: data.incidentType,
      description: data.description,
      severity: data.severity,
      photoUri: cachedPhotoUri,
      photoMediaKey: photoMediaKey || cachedPhotoUri,
      reportDate: now,
      timestamp: now,
    };

    let postedDirectly = false;
    const hasPendingPhoto = Boolean(data.photoUri && !photoMediaKey);
    if (networkSentinel.isOnline() && !hasPendingPhoto) {
      try {
        await driverApi.postVehicleIncident(payload);
        issue.synced = true;
        await driverRepository.markVehicleIssueSynced(issueId);
        postedDirectly = true;
      } catch (e: any) {
        console.warn('[DriverService] Remote incident report failed, queued offline:', e.message);
      }
    }

    if (!postedDirectly) {
      await syncQueueRepository.enqueue({
        id: issueId,
        user_id: user.id,
        operation_type: 'REPORT_ISSUE',
        endpoint: '/fleet/maintenance/incidents',
        payload: JSON.stringify(payload),
      });
    }

    return issue;
  },

  /**
   * Local-First: Query Vehicle Health, PM status, and historical logs immediately from SQLite,
   * while revalidating telemetry, fuel history, and maintenance logs in the background.
   */
  async getVehicleHealthData(
    truckId?: string,
    options: LocalFirstReadOptions = {}
  ): Promise<VehicleHealthData> {
    const activeDriverId = getActiveDatabaseUser() || undefined;
    let resolvedTruckId = truckId;
    if (!resolvedTruckId) {
      const cached = await driverRepository.getVehicleTelemetry(undefined, activeDriverId);
      if (cached?.truck_id) {
        resolvedTruckId = cached.truck_id;
      }
    }

    const activeTrip = await tripRepository.getActiveTrip();
    const candidateTruckId = resolvedTruckId || activeTrip?.truck_id || '';

    if (options.forceRefresh) {
      await revalidateVehicleHealth(candidateTruckId || undefined, true, activeDriverId);
      if (!resolvedTruckId) {
        const refreshed = await driverRepository.getVehicleTelemetry(undefined, activeDriverId);
        if (refreshed?.truck_id) resolvedTruckId = refreshed.truck_id;
      }
    } else if (!options.skipRevalidate) {
      void revalidateVehicleHealth(candidateTruckId || undefined, false, activeDriverId);
    }

    const effectiveTruckId = resolvedTruckId || activeTrip?.truck_id || '';

    const [telemetry, localFuel, localMaintenance] = await Promise.all([
      effectiveTruckId
        ? driverRepository.getVehicleTelemetry(effectiveTruckId)
        : driverRepository.getVehicleTelemetry(undefined, activeDriverId),
      (effectiveTruckId
        ? driverRepository.getFuelLogs(effectiveTruckId)
        : driverRepository.getFuelLogs()
      ).catch(() => [] as FuelLog[]),
      (effectiveTruckId
        ? driverRepository.getMaintenanceLogs(effectiveTruckId)
        : driverRepository.getMaintenanceLogs()
      ).catch(() => [] as MaintenanceServiceLogItem[]),
    ]);

    const defaultTelemetry: VehicleTelemetry = {
      truck_id: effectiveTruckId || telemetry?.truck_id || '',
      plate_number: activeTrip?.vehicle_plate || 'N/A',
      model: activeTrip?.truck_model || 'Delivery Truck',
      current_odometer: 0,
      last_pm_odometer: 0,
      status: 'ACTIVE',
      isPmDue: false,
      distanceSinceLastPm: 0,
      remainingKmBeforePm: 5000,
      last_serviced_at: null,
    };

    return {
      telemetry: telemetry || defaultTelemetry,
      fuelLogs: Array.isArray(localFuel) ? localFuel : [],
      maintenanceLogs: Array.isArray(localMaintenance) ? localMaintenance : [],
    };
  },

  /**
   * Ends an active delivery run upon vehicle return to plant yard with mandatory odometer reading.
   */
  async endTrip(
    user: UserSession,
    data: {
      tripId: string;
      currentOdometer: number;
      notes?: string;
    }
  ): Promise<{ trip: any; odometerTelemetry?: any }> {
    const currentTelemetry = await driverRepository.getVehicleTelemetry();
    const baselineOdo = currentTelemetry?.current_odometer || 0;

    // 1. Enforce monotonic odometer rule
    if (data.currentOdometer < baselineOdo) {
      throw new Error(
        `Final odometer reading (${data.currentOdometer.toLocaleString()} km) cannot be less than registered vehicle odometer (${baselineOdo.toLocaleString()} km).`
      );
    }

    const payload = {
      currentOdometer: data.currentOdometer,
      notes: data.notes?.trim() || undefined,
      returnTime: new Date().toISOString(),
    };

    let remoteResult: any = null;
    let postedDirectly = false;

    if (networkSentinel.isOnline()) {
      try {
        remoteResult = await tripApi.endTrip(data.tripId, payload);
        postedDirectly = true;
      } catch (e: any) {
        console.warn('[DriverService] Remote end trip failed, queuing offline:', e.message);
      }
    }

    if (!postedDirectly) {
      await syncQueueRepository.enqueue({
        id: `end-trip-${data.tripId}-${Date.now()}`,
        user_id: user.id,
        operation_type: 'END_TRIP',
        endpoint: `/trips/${data.tripId}/end`,
        payload: JSON.stringify(payload),
      });
    }

    // Update local SQLite active trip status to 'RETURNED'
    await tripRepository.updateTripStatus(data.tripId, 'RETURNED');

    // Update local vehicle telemetry odometer
    const truckId = currentTelemetry?.truck_id;
    if (truckId) {
      await driverRepository.updateOdometer(truckId, data.currentOdometer);
    }

    return {
      trip: remoteResult?.trip || {
        id: data.tripId,
        status: 'RETURNED',
      },
      odometerTelemetry: remoteResult?.odometerTelemetry,
    };
  },

  /**
   * Subscribe to live frontline driver real-time socket events.
   */
  subscribeRealtime(listener: DriverRealtimeListener): () => void {
    driverRealtimeManager.init();
    return driverRealtimeManager.subscribe(listener);
  },
};
