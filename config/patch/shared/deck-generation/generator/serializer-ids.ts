/**
 * WARNO deck codes allocate 11 bits to division IDs and 14 bits to unit IDs.
 * Generated IDs stay in high reserved bands without exceeding those encoded ranges.
 */
export const SERIALIZER_ID_LIMITS = {
  division: { start: 1_600, maximum: 2 ** 11 - 1 },
  unit: { start: 16_000, maximum: 2 ** 14 - 1 },
} as const;
