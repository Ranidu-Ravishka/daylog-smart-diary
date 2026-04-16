export type LocationTrackingRuntimeConfig = {
  enableBackgroundLocationTracking: boolean;
  batchMaxPoints: number;
  maxUpdatesPerHour: number;
  batchFlushIntervalMinutes: number;
  maxBatteryDrainPercentPerHour: number;
};
