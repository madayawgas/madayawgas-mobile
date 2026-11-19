export const FUEL_LIMITS = {
  MIN_LITERS: 0.01,
  MAX_LITERS: 1000,
  MIN_COST_PHP: 1,
  MAX_COST_PHP: 150000,
  MAX_ODOMETER_KM: 999999,
} as const;

export interface FuelValidationInput {
  liters: number;
  totalCost: number;
  odometer: number;
  currentOdometer: number;
}

export interface FuelFieldErrors {
  liters?: string;
  totalCost?: string;
  odometer?: string;
}

export interface FuelValidationResult {
  valid: boolean;
  fieldErrors: FuelFieldErrors;
  message?: string;
}

/**
 * Validates fuel refill inputs against physical truck limits and monotonic odometer rules.
 */
export function validateFuelInput(input: FuelValidationInput): FuelValidationResult {
  const fieldErrors: FuelFieldErrors = {};
  const baselineOdo = Number.isFinite(input.currentOdometer) ? input.currentOdometer : 0;

  if (!Number.isFinite(input.liters) || input.liters < FUEL_LIMITS.MIN_LITERS) {
    fieldErrors.liters = 'Enter a valid volume greater than 0 L.';
  } else if (input.liters > FUEL_LIMITS.MAX_LITERS) {
    fieldErrors.liters = `Volume cannot exceed ${FUEL_LIMITS.MAX_LITERS.toLocaleString()} L per refill.`;
  }

  if (!Number.isFinite(input.totalCost) || input.totalCost < FUEL_LIMITS.MIN_COST_PHP) {
    fieldErrors.totalCost = `Total cost must be at least ₱${FUEL_LIMITS.MIN_COST_PHP}.`;
  } else if (input.totalCost > FUEL_LIMITS.MAX_COST_PHP) {
    fieldErrors.totalCost = `Total cost cannot exceed ₱${FUEL_LIMITS.MAX_COST_PHP.toLocaleString()} per refill.`;
  }

  if (!Number.isFinite(input.odometer) || !Number.isInteger(input.odometer)) {
    fieldErrors.odometer = 'Enter a valid whole-number odometer reading.';
  } else if (input.odometer < baselineOdo) {
    fieldErrors.odometer = `Odometer must be ≥ ${baselineOdo.toLocaleString()} km.`;
  } else if (input.odometer > FUEL_LIMITS.MAX_ODOMETER_KM) {
    fieldErrors.odometer = `Odometer cannot exceed 6 digits (${FUEL_LIMITS.MAX_ODOMETER_KM.toLocaleString()} km).`;
  }

  const firstMessage = fieldErrors.liters || fieldErrors.totalCost || fieldErrors.odometer;

  return {
    valid: !firstMessage,
    fieldErrors,
    message: firstMessage,
  };
}

/**
 * Strips non-numeric characters while keeping at most one decimal point.
 */
export function sanitizeDecimalInput(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const dotIdx = cleaned.indexOf('.');
  if (dotIdx === -1) return cleaned;
  return cleaned.slice(0, dotIdx + 1) + cleaned.slice(dotIdx + 1).replace(/\./g, '');
}

/**
 * Strips all non-digit characters for integer-only inputs.
 */
export function sanitizeIntegerInput(value: string): string {
  return value.replace(/[^0-9]/g, '');
}
