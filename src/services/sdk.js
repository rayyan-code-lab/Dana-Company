import { dualSdk } from './supabaseEngine';
import { eq, contains, or, gte, gt, lt, lte, isNull } from './localEngine';

/**
 * Authoritative Dual-Mode SDK Adapter
 * Directly interfaces with Supabase PostgreSQL using project credentials,
 * with an automatic fallback to the high-fidelity local transaction engine.
 */
export const sdk = dualSdk;

export { eq, contains, or, gte, gt, lt, lte, isNull };
