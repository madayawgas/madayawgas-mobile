import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheetModal from '../ui/BottomSheetModal';
import { formatSyncStatus } from '../../utils/syncErrorFormatter';
import { mediaService } from '../../services/mediaService';

const TransactionDetailsModal = ({
  visible,
  onClose,
  order,
  items = [],
  queueItem = null,
  loading = false,
  retrying = false,
  onRetrySync,
  onAttachPaymentProof,
  onSwitchToCash,
  onRegenerateAndRetry,
}) => {
  if (!order && !visible) {
    return null;
  }

  const effectiveErrorCode = order?.error_code || queueItem?.error_code || null;
  const effectiveErrorMsg = order?.error_message || queueItem?.error_message || null;
  const syncInfo = formatSyncStatus(
    order?.sync_status,
    effectiveErrorCode,
    effectiveErrorMsg,
    order?.synced_at
  );

  const isSynced = syncInfo.tone === 'synced';
  const isError = syncInfo.tone === 'error';

  const totalSold = items.reduce((sum, it) => sum + Number(it.quantity_sold || 0), 0);
  const totalEmpties = items.reduce((sum, it) => sum + Number(it.empties_returned || 0), 0);

  const formattedDate = order?.transacted_at
    ? new Date(order.transacted_at).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const paymentLabel =
    (order?.payment_method || 'CASH').toUpperCase() === 'GCASH' ? 'GCash' : 'Cash';
  const isGcash = (order?.payment_method || '').toUpperCase() === 'GCASH';
  const isDuplicateConflict = effectiveErrorCode === 'DUPLICATE_ORDER_CONFLICT';

  const handlePickPhoto = async (source) => {
    try {
      const uri =
        source === 'camera'
          ? await mediaService.capturePhoto()
          : await mediaService.pickFromGallery();
      if (uri && onAttachPaymentProof) {
        onAttachPaymentProof(order.id, uri);
      }
    } catch (err) {
      Alert.alert('Photo Error', err?.message || 'Could not capture or select photo.');
    }
  };

  const handlePromptAttachPhoto = () => {
    Alert.alert('Attach GCash Receipt', 'Choose how to attach the payment screenshot.', [
      { text: 'Take Photo', onPress: () => handlePickPhoto('camera') },
      { text: 'Choose from Gallery', onPress: () => handlePickPhoto('gallery') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleConfirmSwitchToCash = () => {
    Alert.alert(
      'Switch Payment to Cash?',
      'This will update the payment method to Cash (keeping all items and totals unchanged) and retry uploading.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch to Cash',
          onPress: () => onSwitchToCash && onSwitchToCash(order.id),
        },
      ]
    );
  };

  return (
    <BottomSheetModal visible={visible} onClose={onClose} maxHeight="85%">
      <View className="bg-white rounded-t-[32px] px-5 pt-7 pb-6 overflow-hidden flex-shrink">
        {/* Header */}
        <View className="flex-row justify-between items-start mb-4">
          <View className="flex-1 pr-3">
            <Text className="text-[#0d4761] font-extrabold text-base" numberOfLines={1}>
              {order?.receipt_number || order?.transaction_no || 'Order Details'}
            </Text>
            <Text className="text-slate-600 text-xs font-medium mt-0.5" numberOfLines={1}>
              {order?.customer_name || 'Customer'}
              {formattedDate ? ` · ${formattedDate}` : ''}
            </Text>
          </View>

          <View className="flex-row items-center">
            <View
              className={`px-2.5 py-1 rounded-full mr-2 ${
                isSynced
                  ? 'bg-emerald-100 border border-emerald-200'
                  : isError
                  ? 'bg-rose-100 border border-rose-200'
                  : 'bg-amber-100 border border-amber-200'
              }`}
            >
              <Text
                className={`text-[10px] font-bold ${
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

            <TouchableOpacity
              onPress={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 items-center justify-center"
              accessibilityLabel="Close details"
            >
              <Ionicons name="close" size={18} color="#475569" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          className="flex-shrink"
          contentContainerStyle={{ paddingBottom: 12 }}
        >
          {/* Sync Status / Error Box */}
          <View
            className={`rounded-2xl p-3.5 mb-4 border ${
              isSynced
                ? 'bg-emerald-50/70 border-emerald-200/80'
                : isError
                ? 'bg-rose-50 border-rose-200'
                : 'bg-amber-50/80 border-amber-200/80'
            }`}
          >
            <View className="flex-row items-start">
              <Ionicons
                name={
                  isSynced
                    ? 'checkmark-circle'
                    : isError
                    ? 'alert-circle'
                    : 'cloud-upload-outline'
                }
                size={18}
                color={isSynced ? '#059669' : isError ? '#e11d48' : '#d97706'}
                style={{ marginTop: 1, marginRight: 8 }}
              />
              <View className="flex-1">
                <Text
                  className={`text-xs font-semibold leading-4 ${
                    isSynced
                      ? 'text-emerald-900'
                      : isError
                      ? 'text-rose-900'
                      : 'text-amber-900'
                  }`}
                >
                  {syncInfo.summary}
                </Text>

                {syncInfo.detail ? (
                  <Text className="text-rose-700 text-[11px] mt-1 leading-4">
                    {syncInfo.detail}
                  </Text>
                ) : null}

                {isError && effectiveErrorCode ? (
                  <Text className="text-rose-500 text-[10px] font-medium mt-1">
                    Reference: {effectiveErrorCode}
                  </Text>
                ) : null}
              </View>
            </View>

            {isError ? (
              <View className="mt-3 gap-2">
                {isGcash && onAttachPaymentProof ? (
                  <TouchableOpacity
                    onPress={handlePromptAttachPhoto}
                    disabled={retrying}
                    className="bg-[#0d4761] rounded-xl py-2.5 px-4 flex-row items-center justify-center"
                  >
                    {retrying ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <Ionicons name="camera-outline" size={14} color="#ffffff" style={{ marginRight: 6 }} />
                        <Text className="text-white text-xs font-bold">Attach New GCash Photo</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : null}

                {isDuplicateConflict && onRegenerateAndRetry ? (
                  <TouchableOpacity
                    onPress={() => onRegenerateAndRetry(order.id)}
                    disabled={retrying}
                    className="bg-[#0d4761] rounded-xl py-2.5 px-4 flex-row items-center justify-center"
                  >
                    {retrying ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <Ionicons name="git-branch-outline" size={14} color="#ffffff" style={{ marginRight: 6 }} />
                        <Text className="text-white text-xs font-bold">New Ref & Retry</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : null}

                <View className="flex-row gap-2">
                  {onRetrySync ? (
                    <TouchableOpacity
                      onPress={() => onRetrySync(order.id)}
                      disabled={retrying}
                      className="flex-1 bg-rose-600 rounded-xl py-2.5 px-3 flex-row items-center justify-center"
                    >
                      {retrying ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <>
                          <Ionicons name="refresh" size={14} color="#ffffff" style={{ marginRight: 5 }} />
                          <Text className="text-white text-xs font-bold">Try Again</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : null}

                  {isGcash && onSwitchToCash ? (
                    <TouchableOpacity
                      onPress={handleConfirmSwitchToCash}
                      disabled={retrying}
                      className="flex-1 bg-white border border-rose-300 rounded-xl py-2.5 px-3 flex-row items-center justify-center"
                    >
                      <Ionicons name="cash-outline" size={14} color="#be123c" style={{ marginRight: 5 }} />
                      <Text className="text-rose-700 text-xs font-bold">Switch to Cash</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}
          </View>

          {/* Items Section */}
          <View className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 mb-4">
            <View className="flex-row justify-between items-center mb-3">
              <Text className="text-[#0d4761] text-xs font-extrabold uppercase tracking-wider">
                Items
              </Text>
              <Text className="text-slate-500 text-[11px] font-semibold">
                {totalSold > 0
                  ? `${totalSold} ${totalSold === 1 ? 'item' : 'items'} sold`
                  : totalEmpties > 0
                  ? `${totalEmpties} ${totalEmpties === 1 ? 'empty' : 'empties'} returned`
                  : 'No items'}
              </Text>
            </View>

            {loading ? (
              <View className="py-5 items-center">
                <ActivityIndicator size="small" color="#0d4761" />
              </View>
            ) : items.length > 0 ? (
              items.map((item, idx) => {
                const qtySold = Number(item.quantity_sold || 0);
                const emptiesRet = Number(item.empties_returned || 0);
                const emptiesDef = Number(item.empties_defective || 0);
                const unitPrice = Number(item.unit_price || 0);
                const subtotal = Number(item.subtotal || 0);

                return (
                  <View
                    key={item.id || idx}
                    className={`py-2.5 ${
                      idx < items.length - 1 ? 'border-b border-slate-200/70' : ''
                    }`}
                  >
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1 pr-3">
                        <Text className="text-[#0d4761] font-bold text-xs">
                          {item.product_name || 'LPG Product'}
                        </Text>
                        {qtySold > 0 ? (
                          <Text className="text-slate-500 text-[11px] mt-0.5">
                            {qtySold} × ₱{unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </Text>
                        ) : (
                          <Text className="text-slate-500 text-[11px] mt-0.5">
                            Empty return only
                          </Text>
                        )}
                      </View>
                      <Text className="text-[#0d4761] font-extrabold text-xs">
                        ₱{subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </Text>
                    </View>

                    {(emptiesRet > 0 || emptiesDef > 0) && (
                      <View className="flex-row items-center mt-1.5">
                        {emptiesRet > 0 && (
                          <View className="bg-white border border-slate-200 px-2 py-0.5 rounded-md mr-1.5">
                            <Text className="text-slate-600 text-[10px] font-semibold">
                              {emptiesRet} {emptiesRet === 1 ? 'empty' : 'empties'} returned
                            </Text>
                          </View>
                        )}
                        {emptiesDef > 0 && (
                          <View className="bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                            <Text className="text-amber-800 text-[10px] font-semibold">
                              {emptiesDef} defective
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            ) : (
              <Text className="text-slate-500 text-xs text-center py-3">
                No item details found on this device.
              </Text>
            )}
          </View>

          {/* Payment Summary */}
          <View className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-slate-500 text-xs font-medium">Payment Method</Text>
              <Text className="text-[#0d4761] text-xs font-bold">{paymentLabel}</Text>
            </View>

            {order?.payment_reference ? (
              <View className="flex-row justify-between items-center mb-2">
                <Text className="text-slate-500 text-xs font-medium">Reference No.</Text>
                <Text className="text-[#0d4761] text-xs font-semibold">
                  {order.payment_reference}
                </Text>
              </View>
            ) : null}

            <View className="flex-row justify-between items-center pt-2.5 border-t border-slate-200/80">
              <Text className="text-[#0d4761] text-sm font-extrabold">Total</Text>
              <Text className="text-[#0d4761] text-base font-extrabold">
                ₱{Number(order?.total_amount || 0).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                })}
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </BottomSheetModal>
  );
};

export default TransactionDetailsModal;
