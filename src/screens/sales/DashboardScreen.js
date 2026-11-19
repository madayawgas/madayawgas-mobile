import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomNav from '../../components/navigation/BottomNav';
import DashboardDesign from '../../../assets/svg/dashboard-bg.svg';
import { salesService } from '../../services/salesService';
import { dataRevalidator } from '../../services/dataRevalidator';
import { syncScheduler } from '../../sync/syncScheduler';
import { syncWorker } from '../../sync/syncWorker';
import { driverRealtimeManager } from '../../realtime/driverRealtimeManager';
import TransactionDetailsModal from '../../components/sales/TransactionDetailsModal';
import { formatSyncStatus } from '../../utils/syncErrorFormatter';

const DashboardScreen = ({ user, activeTab, onSelectTab }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState({ items: [], queueItem: null });
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [retryingSync, setRetryingSync] = useState(false);
  const [dashboardData, setDashboardData] = useState({
    trip: null,
    totalSales: 0,
    recentOrders: [],
    inventory: [],
    pendingSyncCount: 0,
    isOnline: true,
  });

  const loadData = useCallback(async (options = {}) => {
    try {
      const data = await salesService.getDashboardData(user?.id, options);
      setDashboardData(data);
    } catch (err) {
      console.warn('[DashboardScreen] Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();

    // Subscribe to sync scheduler updates to reactively refresh on sync completion (local read only)
    const unsubSync = syncScheduler.subscribe(() => {
      loadData({ skipRevalidate: true });
    });

    // Subscribe to background revalidation updates (local read only)
    const unsubReval = dataRevalidator.subscribe(({ event }) => {
      if (event === 'TRIP_UPDATED' || event === 'INVENTORY_UPDATED') {
        loadData({ skipRevalidate: true });
      }
    });

    // Subscribe to real-time dispatch and stock events to reload immediately
    const unsubRealtime = driverRealtimeManager.subscribe((event) => {
      if (
        event === 'TRIP_DISPATCHED' ||
        event === 'TRIP_LOAD_RECORDED' ||
        event === 'VEHICLE_STOCK_UPDATED' ||
        event === 'TRIP_COMPLETED' ||
        event === 'TRIP_CANCELLED' ||
        event === 'TRIP_RECONCILED'
      ) {
        loadData({ skipRevalidate: true });
      }
    });

    return () => {
      if (unsubSync) unsubSync();
      if (unsubReval) unsubReval();
      if (unsubRealtime) unsubRealtime();
    };
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (dashboardData.isOnline) {
      try {
        await syncWorker.runSyncCycle(25, user?.id);
      } catch (_e) {
        // sync error handled internally
      }
    }
    await loadData({ forceRefresh: true });
  }, [dashboardData.isOnline, loadData, user]);

  const handleOpenOrderDetails = useCallback(async (ord) => {
    setSelectedOrder(ord);
    setSelectedOrderDetails({ items: [], queueItem: null });
    setDetailsLoading(true);
    try {
      const details = await salesService.getOrderDetails(ord.id);
      if (details.order) {
        setSelectedOrder(details.order);
      }
      setSelectedOrderDetails({
        items: details.items || [],
        queueItem: details.queueItem || null,
      });
    } catch (err) {
      console.warn('[DashboardScreen] Failed to load order details:', err);
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  const handleCloseOrderDetails = useCallback(() => {
    setSelectedOrder(null);
    setSelectedOrderDetails({ items: [], queueItem: null });
  }, []);

  const runOrderRecoveryAction = useCallback(
    async (orderId, action) => {
      if (retryingSync) return;
      setRetryingSync(true);
      try {
        const result = await action();
        const refreshed = await salesService.getOrderDetails(orderId);
        if (refreshed.order) {
          setSelectedOrder(refreshed.order);
        }
        setSelectedOrderDetails({
          items: refreshed.items || [],
          queueItem: refreshed.queueItem || null,
        });
        await loadData({ skipRevalidate: true });

        if (result?.offline) {
          Alert.alert('Offline', 'Order is queued and will upload automatically when you are back online.');
        }
      } catch (err) {
        Alert.alert('Upload Failed', err?.message || 'Could not update and retry upload right now.');
      } finally {
        setRetryingSync(false);
      }
    },
    [loadData, retryingSync]
  );

  const handleRetryOrderSync = useCallback(
    (orderId) => runOrderRecoveryAction(orderId, () => salesService.retryOrderSync(orderId)),
    [runOrderRecoveryAction]
  );

  const handleAttachPaymentProof = useCallback(
    (orderId, photoUri) =>
      runOrderRecoveryAction(orderId, () => salesService.updateOrderPaymentProof(orderId, photoUri)),
    [runOrderRecoveryAction]
  );

  const handleSwitchToCash = useCallback(
    (orderId) =>
      runOrderRecoveryAction(orderId, () => salesService.switchQuarantinedOrderToCash(orderId)),
    [runOrderRecoveryAction]
  );

  const handleRegenerateAndRetry = useCallback(
    (orderId) =>
      runOrderRecoveryAction(orderId, () => salesService.regenerateOrderRefsAndRetry(orderId)),
    [runOrderRecoveryAction]
  );

  const quarantinedOrders = (dashboardData.recentOrders || []).filter(
    (o) => o.sync_status === 'QUARANTINED'
  );
  const activeTrip = dashboardData.trip;
  const isTripActive = Boolean(activeTrip && activeTrip.status === 'IN_PROGRESS');
  const inventoryItems = dashboardData.inventory || [];

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
        {/* Header Section with SVG Background */}
        <View className="relative w-full h-80 bg-slate-100">
          <View className="absolute top-0 left-0 right-0 bottom-0 w-full">
            <DashboardDesign width="100%" height="100%" preserveAspectRatio="none" />
          </View>

          <View className="pt-14 px-6">
            <View className="flex-row justify-between items-center mb-4">
              {/* Network / Sync Status Pill */}
              <View className="flex-row items-center bg-white/10 px-3.5 py-1.5 rounded-full border border-white/10">
                <View
                  className={`w-2.5 h-2.5 rounded-full mr-2 ${
                    dashboardData.isOnline ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                <Text className="text-white text-xs font-bold tracking-wide">
                  {dashboardData.isOnline ? 'Online' : 'Offline'}
                </Text>
              </View>

              {dashboardData.pendingSyncCount > 0 ? (
                <View className="bg-amber-400 px-3 py-1 rounded-full flex-row items-center">
                  <Ionicons name="cloud-upload-outline" size={12} color="#0d4761" style={{ marginRight: 4 }} />
                  <Text className="text-[#0d4761] text-[10px] font-extrabold uppercase tracking-wide">
                    {dashboardData.pendingSyncCount} queued
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Greeting */}
            <Text className="text-white/70 text-xs font-bold uppercase tracking-widest">
              Sales Route Control
            </Text>
            <Text className="text-white text-3xl font-extrabold tracking-tight mt-0.5">
              Welcome, {user?.firstName || user?.username || 'Sales Agent'}!
            </Text>
          </View>
        </View>

        {/* Main Content */}
        <View className="px-5 -mt-24 z-10">
          {/* Active Trip / Delivery Route Card */}
          <View className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/90 mb-5">
            <View className="flex-row justify-between items-center mb-4">
              <View className="flex-row items-center">
                <View
                  className={`w-2.5 h-2.5 rounded-full mr-2 ${
                    isTripActive ? 'bg-emerald-500' : 'bg-slate-400'
                  }`}
                />
                <Text className="text-xs font-extrabold text-[#0d4761] uppercase tracking-wider">
                  {isTripActive ? 'Active Route Delivery' : 'Delivery Assignment'}
                </Text>
              </View>

              <View
                className={`px-3 py-1 rounded-full ${
                  isTripActive
                    ? 'bg-emerald-100 border border-emerald-300'
                    : 'bg-slate-100 border border-slate-200'
                }`}
              >
                <Text
                  className={`text-[10px] font-extrabold uppercase tracking-wide ${
                    isTripActive ? 'text-emerald-800' : 'text-slate-600'
                  }`}
                >
                  {activeTrip?.status || 'STANDBY'}
                </Text>
              </View>
            </View>

            {activeTrip ? (
              <View>
                {/* Trip Number Chip */}
                <View className="bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2.5 mb-3.5 flex-row justify-between items-center">
                  <Text className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                    Trip Number
                  </Text>
                  <Text className="text-xs font-extrabold text-[#0d4761]">
                    {activeTrip.trip_number}
                  </Text>
                </View>

                {/* 2x2 Bento Grid */}
                <View className="flex-row flex-wrap gap-2.5">
                  <View className="w-[48%] bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                    <View className="flex-row items-center mb-1">
                      <Ionicons name="navigate-outline" size={13} color="#0d4761" style={{ marginRight: 4 }} />
                      <Text className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                        Service Zone
                      </Text>
                    </View>
                    <Text className="text-xs font-extrabold text-[#0d4761]" numberOfLines={1}>
                      {activeTrip.zone_name || activeTrip.zone_id || 'Default Route'}
                    </Text>
                  </View>

                  <View className="w-[48%] bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                    <View className="flex-row items-center mb-1">
                      <Ionicons name="person-outline" size={13} color="#0d4761" style={{ marginRight: 4 }} />
                      <Text className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                        Driver
                      </Text>
                    </View>
                    <Text className="text-xs font-extrabold text-[#0d4761]" numberOfLines={1}>
                      {activeTrip.driver_name || 'Assigned Driver'}
                    </Text>
                  </View>

                  <View className="w-[48%] bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                    <View className="flex-row items-center mb-1">
                      <Ionicons name="bus-outline" size={13} color="#0d4761" style={{ marginRight: 4 }} />
                      <Text className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                        Vehicle Plate
                      </Text>
                    </View>
                    <Text className="text-xs font-extrabold text-[#0d4761]" numberOfLines={1}>
                      {activeTrip.vehicle_plate || 'N/A'}
                    </Text>
                  </View>

                  <View className="w-[48%] bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                    <View className="flex-row items-center mb-1">
                      <Ionicons name="cube-outline" size={13} color="#0d4761" style={{ marginRight: 4 }} />
                      <Text className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                        Truck Model
                      </Text>
                    </View>
                    <Text className="text-xs font-extrabold text-[#0d4761]" numberOfLines={1}>
                      {activeTrip.truck_model || 'Standard Truck'}
                    </Text>
                  </View>
                </View>
              </View>
            ) : (
              <View className="py-6 items-center justify-center">
                <View className="w-12 h-12 rounded-full bg-slate-100 items-center justify-center mb-2.5 border border-slate-200/60">
                  <Ionicons name="time-outline" size={24} color="#64748b" />
                </View>
                <Text className="text-sm font-bold text-[#0d4761] text-center mb-1">
                  Awaiting Shift Dispatch
                </Text>
                <Text className="text-xs text-slate-500 text-center font-medium max-w-[260px]">
                  No active delivery trip assigned today. Pull down to refresh or check with dispatch.
                </Text>
              </View>
            )}
          </View>

          {/* Total Sales KPI Card */}
          <View className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/90 mb-5">
            <View className="flex-row justify-between items-center">
              <View className="flex-1 pr-3">
                <Text className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Total Sales (Active Shift)
                </Text>
                <Text className="text-[#0d4761] text-3xl font-extrabold tracking-tight mt-1">
                  ₱{' '}
                  {(dashboardData.totalSales || 0).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
                <Text className="text-slate-500 text-[11px] font-medium mt-0.5">
                  Real-time local recorded gross sales
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => {
                  if (!isTripActive) {
                    Alert.alert(
                      'No Active Trip',
                      'You cannot make a sale without an assigned active delivery trip. Please check your trip assignment.'
                    );
                    return;
                  }
                  onSelectTab && onSelectTab('sales');
                }}
                activeOpacity={isTripActive ? 0.85 : 0.6}
                className={`${
                  isTripActive ? 'bg-[#facc15] border border-amber-300' : 'bg-slate-200 border border-slate-300'
                } px-4 py-3 rounded-2xl flex-row items-center shadow-sm`}
              >
                <Ionicons
                  name="add-circle"
                  size={16}
                  color={isTripActive ? '#0d4761' : '#94a3b8'}
                  style={{ marginRight: 5 }}
                />
                <Text
                  className={`${
                    isTripActive ? 'text-[#0d4761]' : 'text-slate-500'
                  } text-xs font-extrabold uppercase tracking-wider`}
                >
                  New Order
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Pending Sync Alert Banner (if any) */}
          {dashboardData.pendingSyncCount > 0 && (
            <View className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex-row items-center mb-5 shadow-sm">
              <View className="w-9 h-9 rounded-xl bg-amber-100 items-center justify-center mr-3">
                <Ionicons name="cloud-upload-outline" size={20} color="#d97706" />
              </View>
              <View className="flex-1">
                <Text className="text-amber-900 font-bold text-xs">
                  {dashboardData.pendingSyncCount} record(s) queued for synchronization
                </Text>
                <Text className="text-amber-800 text-[11px] mt-0.5 font-medium">
                  Transactions and offline customers will upload automatically when online.
                </Text>
              </View>
            </View>
          )}

          {/* Vehicle Inventory Card */}
          <View className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/90 mb-5">
            <View className="flex-row justify-between items-center mb-3.5">
              <View className="flex-row items-center">
                <Ionicons name="layers-outline" size={16} color="#0d4761" style={{ marginRight: 6 }} />
                <Text className="text-xs font-extrabold text-[#0d4761] uppercase tracking-wider">
                  Vehicle Inventory on Board
                </Text>
              </View>
              <Text className="text-slate-500 text-[10px] font-semibold">Remaining / Loaded</Text>
            </View>

            {inventoryItems.length > 0 ? (
              <View>
                {inventoryItems.map((inv, idx) => (
                  <View
                    key={inv.product_id || idx}
                    className={`bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-3 flex-row justify-between items-center ${
                      idx < inventoryItems.length - 1 ? 'mb-2.5' : ''
                    }`}
                  >
                    <View className="flex-1 pr-2">
                      <Text className="text-[#0d4761] font-bold text-xs">
                        {inv.product_name}
                      </Text>
                      <Text className="text-slate-500 text-[11px] mt-0.5 font-medium">
                        Sold: {inv.quantity_sold || 0} unit(s)
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-[#0d4761] font-extrabold text-sm">
                        {inv.quantity_remaining || 0}{' '}
                        <Text className="text-slate-400 text-xs font-semibold">
                          / {inv.quantity_loaded || 0}
                        </Text>
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View className="py-5 items-center bg-slate-50 border border-slate-200/80 rounded-xl">
                <Text className="text-slate-500 text-xs font-medium">
                  Inventory not loaded yet for this shift.
                </Text>
              </View>
            )}
          </View>

          {/* Quarantined Orders Alert Banner */}
          {quarantinedOrders.length > 0 ? (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => handleOpenOrderDetails(quarantinedOrders[0])}
              className="bg-rose-50 border border-rose-200 rounded-2xl p-4 mb-5 flex-row items-center justify-between"
            >
              <View className="flex-row items-center flex-1 pr-3">
                <View className="w-9 h-9 rounded-full bg-rose-100 items-center justify-center mr-3">
                  <Ionicons name="alert-circle" size={20} color="#e11d48" />
                </View>
                <View className="flex-1">
                  <Text className="text-rose-900 font-extrabold text-xs">
                    {quarantinedOrders.length}{' '}
                    {quarantinedOrders.length === 1 ? 'Order Needs' : 'Orders Need'} Attention
                  </Text>
                  <Text className="text-rose-700 text-[11px] mt-0.5">
                    Tap to review and resolve so it syncs for plant reconciliation.
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#e11d48" />
            </TouchableOpacity>
          ) : null}

          {/* Recent Transactions Card */}
          <View className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/90">
            <View className="flex-row justify-between items-center mb-3.5">
              <View className="flex-row items-center">
                <Ionicons name="receipt-outline" size={16} color="#0d4761" style={{ marginRight: 6 }} />
                <Text className="text-xs font-extrabold text-[#0d4761] uppercase tracking-wider">
                  Recent Transactions
                </Text>
              </View>
              {dashboardData.recentOrders?.length > 0 && (
                <Text className="text-slate-500 text-[10px] font-semibold">
                  Latest {dashboardData.recentOrders.length}
                </Text>
              )}
            </View>

            {loading ? (
              <View className="bg-slate-50 border border-slate-200/80 rounded-xl h-32 items-center justify-center">
                <ActivityIndicator color="#0d4761" size="small" />
              </View>
            ) : dashboardData.recentOrders && dashboardData.recentOrders.length > 0 ? (
              <View>
                {dashboardData.recentOrders.map((ord, idx) => {
                  const syncInfo = formatSyncStatus(
                    ord.sync_status,
                    ord.error_code,
                    ord.error_message,
                    ord.synced_at
                  );
                  const isSynced = syncInfo.tone === 'synced';
                  const isError = syncInfo.tone === 'error';
                  const formattedTime = ord.transacted_at
                    ? new Date(ord.transacted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '';
                  const soldCount = Number(ord.total_items_sold || 0);
                  const emptiesCount = Number(ord.total_empties_returned || 0);
                  const itemSummary =
                    soldCount > 0
                      ? `${soldCount} ${soldCount === 1 ? 'item' : 'items'}`
                      : emptiesCount > 0
                      ? `${emptiesCount} ${emptiesCount === 1 ? 'empty' : 'empties'}`
                      : null;

                  return (
                    <TouchableOpacity
                      key={ord.id || idx}
                      activeOpacity={0.7}
                      onPress={() => handleOpenOrderDetails(ord)}
                      className={`p-3.5 rounded-xl bg-slate-50 border ${
                        isError ? 'border-rose-200' : 'border-slate-200/80'
                      } ${idx < dashboardData.recentOrders.length - 1 ? 'mb-2.5' : ''}`}
                    >
                      <View className="flex-row justify-between items-start mb-1.5">
                        <View className="flex-1 pr-2">
                          <Text className="text-[#0d4761] font-bold text-xs" numberOfLines={1}>
                            {ord.receipt_number || ord.transaction_no}
                          </Text>
                          <Text className="text-slate-600 text-[11px] font-medium mt-0.5" numberOfLines={1}>
                            {ord.customer_name || 'Customer'}
                          </Text>
                        </View>
                        <View className="items-end">
                          <Text className="text-[#0d4761] font-extrabold text-xs">
                            ₱ {Number(ord.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </Text>
                          <Text className="text-slate-400 text-[10px] mt-0.5">{formattedTime}</Text>
                        </View>
                      </View>

                      <View className="flex-row justify-between items-center pt-2 border-t border-slate-200/70">
                        <View className="flex-row items-center">
                          <View className="bg-white border border-slate-200 px-2.5 py-0.5 rounded-md">
                            <Text className="text-slate-600 text-[9px] font-bold uppercase tracking-wide">
                              {ord.payment_method || 'CASH'}
                            </Text>
                          </View>
                          {itemSummary ? (
                            <Text className="text-slate-500 text-[10px] font-medium ml-2">
                              {itemSummary}
                            </Text>
                          ) : null}
                        </View>

                        <View className="flex-row items-center">
                          <View
                            className={`px-2.5 py-0.5 rounded-full mr-1.5 ${
                              isSynced
                                ? 'bg-emerald-100 border border-emerald-200'
                                : isError
                                ? 'bg-rose-100 border border-rose-200'
                                : 'bg-amber-100 border border-amber-200'
                            }`}
                          >
                            <Text
                              className={`text-[9px] font-extrabold tracking-wide ${
                                isSynced
                                  ? 'text-emerald-800'
                                  : isError
                                  ? 'text-rose-800'
                                  : 'text-amber-800'
                              }`}
                            >
                              {syncInfo.label}
                            </Text>
                          </View>
                          <Ionicons name="chevron-forward" size={14} color="#94a3b8" />
                        </View>
                      </View>

                      {isError ? (
                        <Text className="text-rose-700 text-[10px] font-medium mt-1.5" numberOfLines={1}>
                          {syncInfo.summary}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View className="bg-slate-50 border border-slate-200/80 rounded-xl p-6 items-center justify-center">
                <View className="w-12 h-12 rounded-full bg-white border border-slate-200 items-center justify-center mb-2.5">
                  <Ionicons name="receipt-outline" size={24} color="#64748b" />
                </View>
                <Text className="text-[#0d4761] font-bold text-sm">No Transactions Yet</Text>
                <Text className="text-slate-500 text-xs text-center mt-1 max-w-[240px]">
                  Completed orders transacted during this delivery shift will appear here.
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <TransactionDetailsModal
        visible={Boolean(selectedOrder)}
        onClose={handleCloseOrderDetails}
        order={selectedOrder}
        items={selectedOrderDetails.items}
        queueItem={selectedOrderDetails.queueItem}
        loading={detailsLoading}
        retrying={retryingSync}
        onRetrySync={handleRetryOrderSync}
        onAttachPaymentProof={handleAttachPaymentProof}
        onSwitchToCash={handleSwitchToCash}
        onRegenerateAndRetry={handleRegenerateAndRetry}
      />

      {/* Floating Bottom Nav */}
      <BottomNav activeTab={activeTab} onSelectTab={onSelectTab} />
    </View>
  );
};

export default DashboardScreen;
