import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { driverService } from '@/services/driverService';
import BottomSheetModal from '@/components/ui/BottomSheetModal';

const EndTripModal = ({ visible, onClose, user, activeTrip, telemetry, onSuccess }) => {
  const [odometer, setOdometer] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');

  const currentOdo = telemetry?.current_odometer || 0;
  const tripNumber = activeTrip?.trip_number || 'Active Trip';
  const plateNumber = telemetry?.plate_number || activeTrip?.vehicle_plate || 'N/A';

  useEffect(() => {
    if (visible) {
      setOdometer(currentOdo > 0 ? String(currentOdo) : '');
      setNotes('');
      setValidationError('');
    }
  }, [visible, currentOdo]);

  const handleOdometerChange = (val) => {
    setOdometer(val);
    const num = parseFloat(val);
    if (!isNaN(num) && num < currentOdo) {
      setValidationError(`Odometer must be at least ${currentOdo.toLocaleString()} km`);
    } else {
      setValidationError('');
    }
  };

  const handleSubmit = async () => {
    const parsedOdo = parseInt(odometer, 10);

    if (isNaN(parsedOdo) || parsedOdo <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid numeric odometer reading.');
      return;
    }

    if (parsedOdo < currentOdo) {
      Alert.alert(
        'Monotonic Odometer Error',
        `Return odometer cannot be lower than registered vehicle odometer (${currentOdo.toLocaleString()} km).`
      );
      return;
    }

    if (!activeTrip?.trip_id) {
      Alert.alert('Error', 'No active trip identifier found.');
      return;
    }

    try {
      setSubmitting(true);
      const result = await driverService.endTrip(user, {
        tripId: activeTrip.trip_id,
        currentOdometer: parsedOdo,
        notes,
      });

      Alert.alert(
        'Trip Ended',
        `Vehicle return logged at ${parsedOdo.toLocaleString()} km. Trip is now awaiting plant stock reconciliation.`
      );

      if (onSuccess) {
        onSuccess(result);
      }
      onClose();
    } catch (err) {
      Alert.alert('Submission Error', err.message || 'Failed to end trip.');
    } finally {
      setSubmitting(false);
    }
  };

  const isInvalid = !odometer || Boolean(validationError) || submitting;

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      dismissible={!submitting}
      avoidKeyboard={true}
      backdropOpacity={0.6}
    >
      <View className="bg-white rounded-t-[32px] px-6 pt-7 pb-6">
          {/* Header */}
          <View className="flex-row items-center justify-between pb-4 border-b border-gray-100">
            <View className="flex-1 mr-3">
              <Text className="text-xl font-bold text-[#0d4761]">End Delivery Trip</Text>
              <Text className="text-xs text-gray-500 mt-0.5">
                {tripNumber} • <Text className="font-bold text-[#0d4761]">{plateNumber}</Text>
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              disabled={submitting}
              className="w-9 h-9 rounded-full bg-gray-100 items-center justify-center"
            >
              <Ionicons name="close" size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 }}
          >
            {/* Odometer Baseline Card */}
            <View className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 mb-4 flex-row items-center justify-between">
              <View className="flex-row items-center">
                <View className="w-9 h-9 rounded-full bg-blue-100/70 items-center justify-center mr-3">
                  <Ionicons name="speedometer-outline" size={20} color="#0d4761" />
                </View>
                <View>
                  <Text className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    Registered Odometer
                  </Text>
                  <Text className="text-base font-bold text-[#0d4761]">
                    {currentOdo.toLocaleString()} km
                  </Text>
                </View>
              </View>
              <View className="bg-emerald-100 px-2.5 py-1 rounded-full">
                <Text className="text-[10px] font-bold text-emerald-800 uppercase tracking-wide">
                  Current baseline
                </Text>
              </View>
            </View>

            {/* Final Odometer Input */}
            <View className="mb-4">
              <Text className="text-xs font-bold text-[#0d4761] uppercase tracking-wider mb-1.5">
                Final Odometer Reading (km) *
              </Text>
              <View
                className={`flex-row items-center bg-[#f4f5f7] border rounded-xl px-4 py-3 ${
                  validationError ? 'border-red-500 bg-red-50/20' : 'border-gray-200'
                }`}
              >
                <TextInput
                  value={odometer}
                  onChangeText={handleOdometerChange}
                  placeholder={`Min ${currentOdo}`}
                  placeholderTextColor="#9ca3af"
                  keyboardType="numeric"
                  className="flex-1 text-base text-[#0d4761] font-semibold p-0"
                  editable={!submitting}
                />
                <Text className="text-sm font-bold text-gray-400">km</Text>
              </View>
              {validationError ? (
                <Text className="text-xs text-red-500 font-semibold mt-1.5 ml-1">
                  {validationError}
                </Text>
              ) : null}
            </View>

            {/* Trip Notes Input (Optional) */}
            <View className="mb-5">
              <Text className="text-xs font-bold text-[#0d4761] uppercase tracking-wider mb-1.5">
                Trip Notes (Optional)
              </Text>
              <View className="bg-[#f4f5f7] border border-gray-200 rounded-xl px-4 py-3">
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="e.g. Arrived back at plant yard, route completed"
                  placeholderTextColor="#9ca3af"
                  multiline={true}
                  numberOfLines={3}
                  textAlignVertical="top"
                  className="text-sm text-[#0d4761] p-0 min-h-[60px]"
                  editable={!submitting}
                />
              </View>
            </View>

            {/* Operational Reassurance Note */}
            <View className="bg-blue-50/70 border border-blue-100 rounded-xl p-3.5 mb-6 flex-row items-start">
              <Ionicons name="information-circle-outline" size={18} color="#0d4761" style={{ marginRight: 8, marginTop: 1 }} />
              <Text className="text-xs text-[#0d4761] leading-relaxed flex-1">
                Ending the trip records vehicle return telemetry and queues the delivery for plant physical count and stock settlement.
              </Text>
            </View>

            {/* Submit Action Button */}
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={isInvalid}
              className={`rounded-full py-4 items-center justify-center shadow-sm ${
                isInvalid ? 'bg-gray-300' : 'bg-[#0d4761] active:opacity-90'
              }`}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <View className="flex-row items-center">
                  <Ionicons name="flag" size={18} color="#ffffff" style={{ marginRight: 8 }} />
                  <Text className="text-white text-base font-bold tracking-wide uppercase">
                    Confirm End Trip
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </ScrollView>
      </View>
    </BottomSheetModal>
  );
};

export default EndTripModal;
