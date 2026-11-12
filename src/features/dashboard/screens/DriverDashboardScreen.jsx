import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomNav from '../../../components/navigation/BottomNav';
import { driverService } from '@/services/driverService';
import { syncScheduler } from '@/sync/syncScheduler';
import { socketClient } from '@/realtime';
import FuelEntryModal from '../../operations/components/FuelEntryModal';
import ApprehensionModal from '../../operations/components/ApprehensionModal';
import VehicleIssueModal from '../../operations/components/VehicleIssueModal';
import EmergencySosModal from '../../operations/components/EmergencySosModal';
import EndTripModal from '../../operations/components/EndTripModal';

const DRIVER_TABS = [
  { id: 'dashboard', label: 'Cabin', iconName: 'speedometer-outline', activeIconName: 'speedometer' },
  { id: 'maintenance', label: 'Vehicle', iconName: 'construct-outline', activeIconName: 'construct' },
  { id: 'profile', label: 'Profile', iconName: 'person-circle-outline', activeIconName: 'person-circle' },
];

const DriverDashboardScreen = ({ user, activeTab = 'dashboard', onSelectTab }) => {
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isSocketConnected, setIsSocketConnected] = useState(false);

  // Emergency SOS Cooldown State (60 seconds)
  const [sosCooldown, setSosCooldown] = useState(0);
  const cooldownTimerRef = useRef(null);

  // Modals
  const [showFuelModal, setShowFuelModal] = useState(false);
  const [showApprehensionModal, setShowApprehensionModal] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showSosModal, setShowSosModal] = useState(false);
  const [showEndTripModal, setShowEndTripModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Load operational context
  const loadDashboardData = useCallback(async () => {
    try {
      const data = await driverService.getDashboardContext(user);
      setContext(data);
    } catch (e) {
      console.warn('[DriverDashboardScreen] Error loading data:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Pull-to-refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadDashboardData();
      if (isOnline) {
        await syncScheduler.syncNow();
      }
    } catch (e) {
      console.warn('[DriverDashboardScreen] Error refreshing:', e);
    } finally {
      setRefreshing(false);
    }
  }, [loadDashboardData, isOnline]);

  // Sync engine & network status listener
  useEffect(() => {
    const unsubscribe = syncScheduler.subscribe((status) => {
      setIsOnline(status.isOnline);
      setIsSyncing(status.isSyncing);
      setContext((prev) => (prev ? { ...prev, pendingSyncCount: status.pendingCount } : prev));
    });
    return () => unsubscribe();
  }, []);

  // Real-Time Socket Connection & Frontline Events Listener
  useEffect(() => {
    const unsubSocket = socketClient.subscribeConnection((connected) => {
      setIsSocketConnected(connected);
    });

    const unsubRealtime = driverService.subscribeRealtime((event, data) => {
      console.log('[DriverDashboardScreen] Realtime event received:', event);

      switch (event) {
        case 'TRIP_DISPATCHED':
          loadDashboardData();
          Alert.alert(
            '🚚 New Trip Dispatched',
            `Trip ${data?.tripNumber || ''} has been assigned and dispatched to your cabin. Have a safe route delivery!`
          );
          break;

        case 'TRIP_LOAD_RECORDED':
          loadDashboardData();
          Alert.alert(
            '📦 Load Slip Recorded',
            `Slip ${data?.slipNumber || ''} recorded with ${data?.itemCount || 0} unit(s). Onboard inventory updated.`
          );
          break;

        case 'TRIP_ENDED':
        case 'TRIP_COMPLETED':
        case 'TRIP_RECONCILED':
          loadDashboardData();
          break;

        case 'TRIP_CANCELLED':
          loadDashboardData();
          Alert.alert(
            '⚠️ Route Trip Cancelled',
            `Trip ${data?.tripNumber || ''} was cancelled by logistics dispatch. Reason: ${data?.reason || 'Route cancelled'}.`
          );
          break;

        case 'VEHICLE_DRIVER_ASSIGNED':
          loadDashboardData();
          Alert.alert(
            '🚛 Vehicle Assigned',
            `You have been assigned to delivery vehicle ${data?.plateNumber || ''}. Telemetry updated.`
          );
          break;

        case 'EMERGENCY_ALERT_STATUS_UPDATED':
          if (data?.status === 'ACKNOWLEDGED') {
            Alert.alert(
              '🚨 Emergency SOS Acknowledged',
              `Supervisor ${data?.acknowledgedByName || 'Supervisor'} has acknowledged your emergency alert. Operations team is responding!`
            );
          } else if (data?.status === 'RESOLVED') {
            Alert.alert(
              '✅ Emergency SOS Resolved',
              `Your emergency SOS has been marked resolved: ${data?.resolutionNotes || 'Situation resolved'}.`
            );
          }
          break;

        default:
          break;
      }
    });

    return () => {
      unsubSocket();
      unsubRealtime();
    };
  }, [loadDashboardData]);

  // Initial load
  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // SOS Cooldown timer
  useEffect(() => {
    if (sosCooldown > 0) {
      cooldownTimerRef.current = setTimeout(() => {
        setSosCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, [sosCooldown]);

  const handleSosDispatched = () => {
    setSosCooldown(60); // 60-second debounce cooldown
  };

  const handleManualSync = async () => {
    if (isSyncing) return;

    if (!isOnline) {
      Alert.alert(
        'Offline',
        'Backend server is currently unreachable. Your logs and orders are safely stored on this device and will automatically upload once connection is restored.'
      );
      return;
    }

    setIsSyncing(true);
    try {
      const result = await syncScheduler.syncNow();
      await loadDashboardData();

      if (result.offline) {
        Alert.alert(
          'Offline',
          'Backend server is currently unreachable. Items remain safely stored on this device.'
        );
      } else if (result.synced === 0 && result.failed > 0) {
        Alert.alert(
          'Sync Incomplete',
          'Could not reach server or upload media. Items remain queued offline and will retry automatically.'
        );
      } else if (result.synced > 0 && result.failed > 0) {
        Alert.alert(
          'Partial Sync',
          `Successfully synced ${result.synced} item(s). ${result.failed} item(s) remain queued.`
        );
      } else if (result.synced > 0 && result.failed === 0) {
        Alert.alert(
          'Sync Complete',
          `All ${result.synced} queued item(s) uploaded successfully.`
        );
      } else {
        Alert.alert('Queue Empty', 'All records are already up to date.');
      }
    } catch (e) {
      Alert.alert('Sync Notice', e.message || 'Sync cycle completed. Check connectivity if items remain queued.');
      await loadDashboardData();
    } finally {
      setIsSyncing(false);
    }
  };

  const activeTrip = context?.trip;
  const telemetry = context?.telemetry;
  const plateNumber = telemetry?.plate_number || activeTrip?.vehicle_plate || 'ABC-1001';
  const isTripReturned = Boolean(activeTrip && activeTrip.status === 'RETURNED');
  const isTripActive = Boolean(activeTrip && !isTripReturned);

  return (
    <View className="flex-1 bg-slate-100">
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 110 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#ffffff"
            colors={['#0d4761']}
          />
        }
      >
        {/* Top App Bar / Hero Header */}
        <View className="bg-[#0d4761] pt-14 pb-11 px-6 rounded-b-[36px] shadow-sm">
          <View className="flex-row justify-between items-center mb-4">
            {/* Online / Offline Pill */}
            <View className="flex-row items-center bg-white/10 px-3.5 py-1.5 rounded-full border border-white/10">
              <View
                className={`w-2.5 h-2.5 rounded-full mr-2 ${
                  isOnline ? (isSocketConnected ? 'bg-emerald-400' : 'bg-emerald-300') : 'bg-amber-400'
                }`}
              />
              <Text className="text-white text-xs font-bold tracking-wide">
                {isOnline ? 'Online' : 'Offline'}
              </Text>
              {context?.pendingSyncCount && context.pendingSyncCount > 0 ? (
                <TouchableOpacity
                  onPress={handleManualSync}
                  disabled={isSyncing}
                  className={`${
                    isOnline ? 'bg-amber-400' : 'bg-amber-400/90'
                  } px-2.5 py-0.5 rounded-full ml-2 flex-row items-center active:opacity-75`}
                >
                  {isSyncing ? (
                    <ActivityIndicator size="small" color="#0d4761" style={{ transform: [{ scale: 0.6 }], marginRight: 2 }} />
                  ) : (
                    <Ionicons
                      name={isOnline ? 'cloud-upload-outline' : 'cloud-offline-outline'}
                      size={11}
                      color="#0d4761"
                      style={{ marginRight: 2 }}
                    />
                  )}
                  <Text className="text-[#0d4761] text-[10px] font-bold">
                    {context.pendingSyncCount} queued
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Assigned Truck Badge */}
            <View className="flex-row items-center bg-[#facc15] px-3.5 py-1.5 rounded-full shadow-sm">
              <Ionicons name="bus" size={14} color="#0d4761" />
              <Text className="text-[#0d4761] text-xs font-bold ml-1.5 uppercase tracking-wide">
                {plateNumber}
              </Text>
            </View>
          </View>

          {/* Greeting */}
          <Text className="text-white/70 text-xs font-bold uppercase tracking-widest">
            Driver Cabin Control
          </Text>
          <Text className="text-white text-3xl font-extrabold tracking-tight mt-0.5">
            Good day, {user?.firstName || 'Danilo'}!
          </Text>
        </View>

        {loading ? (
          <View className="py-24 items-center justify-center">
            <ActivityIndicator size="large" color="#0d4761" />
            <Text className="text-xs text-slate-500 font-semibold mt-3">Loading cabin telemetry...</Text>
          </View>
        ) : (
          <View className="px-5 -mt-6 z-10 space-y-5">
            {/* Emergency SOS Action Button */}
            <TouchableOpacity
              onPress={() => setShowSosModal(true)}
              disabled={sosCooldown > 0}
              activeOpacity={0.88}
              className={`py-4 px-4.5 rounded-2xl flex-row items-center justify-between shadow-sm border ${
                sosCooldown > 0
                  ? 'bg-amber-500 border-amber-600'
                  : 'bg-red-600 border-red-700'
              }`}
            >
              <View className="flex-row items-center flex-1 mr-3">
                <View className="w-10 h-10 rounded-full bg-white/20 items-center justify-center mr-3">
                  <Ionicons
                    name={sosCooldown > 0 ? 'time-outline' : 'warning'}
                    size={22}
                    color="#ffffff"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-white text-sm font-extrabold uppercase tracking-wide">
                    {sosCooldown > 0
                      ? `Dispatchers Notified (${sosCooldown}s)`
                      : 'Emergency Cabin SOS'}
                  </Text>
                  <Text className="text-white/80 text-[11px] leading-tight mt-0.5">
                    {sosCooldown > 0
                      ? 'GPS alert sent. Stand by for response.'
                      : 'Tap for immediate medical or breakdown triage'}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#ffffff" />
            </TouchableOpacity>

            {/* Dynamic Active Trip / Dispatch Hero Card */}
            <View className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/90">
              {/* Header with State Pill */}
              <View className="flex-row justify-between items-center mb-4">
                <View className="flex-row items-center">
                  <View
                    className={`w-2.5 h-2.5 rounded-full mr-2 ${
                      isTripReturned
                        ? 'bg-amber-500'
                        : isTripActive
                        ? 'bg-emerald-500'
                        : 'bg-slate-400'
                    }`}
                  />
                  <Text className="text-xs font-extrabold text-[#0d4761] uppercase tracking-wider">
                    {isTripReturned
                      ? 'Trip Returned to Yard'
                      : isTripActive
                      ? 'Active Route Delivery'
                      : 'Trip Dispatch Status'}
                  </Text>
                </View>

                {activeTrip ? (
                  <View
                    className={`px-3 py-1 rounded-full ${
                      isTripReturned
                        ? 'bg-amber-100 border border-amber-300'
                        : 'bg-emerald-100 border border-emerald-300'
                    }`}
                  >
                    <Text
                      className={`text-[10px] font-extrabold uppercase tracking-wide ${
                        isTripReturned ? 'text-amber-900' : 'text-emerald-800'
                      }`}
                    >
                      {isTripReturned ? 'RETURNED' : 'IN PROGRESS'}
                    </Text>
                  </View>
                ) : (
                  <View className="bg-slate-100 border border-slate-200 px-3 py-1 rounded-full">
                    <Text className="text-slate-600 text-[10px] font-bold uppercase tracking-wide">
                      IDLE AT YARD
                    </Text>
                  </View>
                )}
              </View>

              {/* Trip Information Body */}
              {activeTrip ? (
                <View>
                  {/* Trip Number Header */}
                  <View className="bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2.5 mb-4 flex-row justify-between items-center">
                    <Text className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                      Trip ID
                    </Text>
                    <Text className="text-xs font-extrabold text-[#0d4761]">
                      {activeTrip.trip_number || `TRIP-${activeTrip.trip_id.substring(0, 8)}`}
                    </Text>
                  </View>

                  {/* 4-Item Grid */}
                  <View className="flex-row flex-wrap gap-2.5">
                    {/* Route Zone */}
                    <View className="w-[48%] bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                      <View className="flex-row items-center mb-1">
                        <Ionicons name="navigate-outline" size={13} color="#0d4761" style={{ marginRight: 4 }} />
                        <Text className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                          Route Zone
                        </Text>
                      </View>
                      <Text className="text-xs font-extrabold text-[#0d4761]" numberOfLines={1}>
                        {activeTrip.zone_name || activeTrip.zone_id || 'Assigned Zone'}
                      </Text>
                    </View>

                    {/* Sales Partner */}
                    <View className="w-[48%] bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                      <View className="flex-row items-center mb-1">
                        <Ionicons name="person-outline" size={13} color="#0d4761" style={{ marginRight: 4 }} />
                        <Text className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                          Sales Partner
                        </Text>
                      </View>
                      <Text className="text-xs font-extrabold text-[#0d4761]" numberOfLines={1}>
                        {activeTrip.sales_user_name || 'Assigned Sales Agent'}
                      </Text>
                    </View>

                    {/* Departure Time */}
                    <View className="w-[48%] bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                      <View className="flex-row items-center mb-1">
                        <Ionicons name="time-outline" size={13} color="#0d4761" style={{ marginRight: 4 }} />
                        <Text className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                          Departure
                        </Text>
                      </View>
                      <Text className="text-xs font-extrabold text-[#0d4761]">
                        {new Date(activeTrip.dispatched_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>

                    {/* Vehicle Plate */}
                    <View className="w-[48%] bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                      <View className="flex-row items-center mb-1">
                        <Ionicons name="bus-outline" size={13} color="#0d4761" style={{ marginRight: 4 }} />
                        <Text className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                          Vehicle
                        </Text>
                      </View>
                      <Text className="text-xs font-extrabold text-[#0d4761]" numberOfLines={1}>
                        {plateNumber}
                      </Text>
                    </View>
                  </View>

                  {/* State Actions & Reassurances */}
                  {isTripActive ? (
                    <TouchableOpacity
                      onPress={() => setShowEndTripModal(true)}
                      activeOpacity={0.88}
                      className="mt-4 bg-[#0d4761] active:bg-[#093548] py-4 px-4 rounded-xl flex-row items-center justify-between shadow-sm"
                    >
                      <View className="flex-row items-center">
                        <View className="w-8 h-8 rounded-full bg-white/15 items-center justify-center mr-3">
                          <Ionicons name="flag" size={16} color="#ffffff" />
                        </View>
                        <Text className="text-white text-sm font-extrabold uppercase tracking-wider">
                          End Delivery Trip
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#ffffff" />
                    </TouchableOpacity>
                  ) : isTripReturned ? (
                    <View className="mt-4 bg-amber-50/90 border border-amber-200 rounded-xl p-3.5 flex-row items-start">
                      <Ionicons
                        name="hourglass-outline"
                        size={18}
                        color="#b45309"
                        style={{ marginRight: 8, marginTop: 1 }}
                      />
                      <View className="flex-1">
                        <Text className="text-xs font-bold text-amber-900">
                          Awaiting Plant Stock Reconciliation
                        </Text>
                        <Text className="text-[11px] text-amber-800 leading-relaxed mt-0.5 font-medium">
                          Delivery completed. Plant supervisor will verify returned physical cylinders and settle reconciliation.
                        </Text>
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View className="py-7 items-center justify-center">
                  <View className="w-14 h-14 rounded-full bg-slate-100 items-center justify-center mb-3 border border-slate-200/60">
                    <Ionicons name="storefront-outline" size={26} color="#64748b" />
                  </View>
                  <Text className="text-sm font-bold text-[#0d4761] text-center mb-1">
                    Truck in Yard Standby
                  </Text>
                  <Text className="text-xs text-slate-500 text-center font-medium max-w-[280px]">
                    No active route dispatch at this time. You will receive a notification once a trip is dispatched.
                  </Text>
                </View>
              )}
            </View>

            {/* Cabin Quick-Action Bar */}
            <View>
              <Text className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2.5 ml-0.5">
                Cabin Quick Actions
              </Text>
              <View className="flex-row gap-3">
                {/* Log Fuel */}
                <TouchableOpacity
                  onPress={() => setShowFuelModal(true)}
                  activeOpacity={0.85}
                  className="flex-1 bg-white border border-slate-200/90 rounded-2xl p-4 items-center justify-center shadow-sm"
                >
                  <View className="w-11 h-11 rounded-2xl bg-sky-50 items-center justify-center mb-2">
                    <Ionicons name="water-outline" size={22} color="#0d4761" />
                  </View>
                  <Text className="text-xs font-bold text-[#0d4761] text-center">Log Fuel</Text>
                  <Text className="text-[10px] text-slate-500 mt-0.5 font-medium">Record refill</Text>
                </TouchableOpacity>

                {/* Report Citation */}
                <TouchableOpacity
                  onPress={() => setShowApprehensionModal(true)}
                  activeOpacity={0.85}
                  className="flex-1 bg-white border border-slate-200/90 rounded-2xl p-4 items-center justify-center shadow-sm"
                >
                  <View className="w-11 h-11 rounded-2xl bg-amber-50 items-center justify-center mb-2">
                    <Ionicons name="document-text-outline" size={22} color="#d97706" />
                  </View>
                  <Text className="text-xs font-bold text-[#0d4761] text-center">Citation</Text>
                  <Text className="text-[10px] text-slate-500 mt-0.5 font-medium">Traffic ticket</Text>
                </TouchableOpacity>

                {/* Report Issue */}
                <TouchableOpacity
                  onPress={() => setShowIssueModal(true)}
                  activeOpacity={0.85}
                  className="flex-1 bg-white border border-slate-200/90 rounded-2xl p-4 items-center justify-center shadow-sm"
                >
                  <View className="w-11 h-11 rounded-2xl bg-rose-50 items-center justify-center mb-2">
                    <Ionicons name="construct-outline" size={22} color="#dc2626" />
                  </View>
                  <Text className="text-xs font-bold text-[#0d4761] text-center">Report Defect</Text>
                  <Text className="text-[10px] text-slate-500 mt-0.5 font-medium">Vehicle issue</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Floating Bottom Nav for Driver */}
      <BottomNav activeTab={activeTab} onSelectTab={onSelectTab} tabs={DRIVER_TABS} />

      {/* Operational Modals */}
      <EndTripModal
        visible={showEndTripModal}
        onClose={() => setShowEndTripModal(false)}
        user={user}
        activeTrip={activeTrip}
        telemetry={telemetry}
        onSuccess={() => loadDashboardData()}
      />

      <FuelEntryModal
        visible={showFuelModal}
        onClose={() => setShowFuelModal(false)}
        user={user}
        telemetry={telemetry}
        onSuccess={() => loadDashboardData()}
      />

      <ApprehensionModal
        visible={showApprehensionModal}
        onClose={() => setShowApprehensionModal(false)}
        user={user}
        telemetry={telemetry}
        onSuccess={() => loadDashboardData()}
      />

      <VehicleIssueModal
        visible={showIssueModal}
        onClose={() => setShowIssueModal(false)}
        user={user}
        telemetry={telemetry}
        onSuccess={() => loadDashboardData()}
      />

      <EmergencySosModal
        visible={showSosModal}
        onClose={() => setShowSosModal(false)}
        user={user}
        onSosDispatched={handleSosDispatched}
      />
    </View>
  );
};

export default DriverDashboardScreen;
