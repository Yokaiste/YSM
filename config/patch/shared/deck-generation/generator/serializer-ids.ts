/** WARNO deck codes give division ids 11 bits and unit ids 14. */
export const SERIALIZER_ID_LIMITS = {
  division: { start: 1_600, maximum: 2 ** 11 - 1 },
  unit: { start: 16_000, maximum: 2 ** 14 - 1 },
} as const;
