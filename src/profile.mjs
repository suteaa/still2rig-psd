export const PROFILE_STANDARD = 'standard';
export const PROFILE_VTUBER = 'vtuber';
export const SUPPORTED_PROFILES = Object.freeze([PROFILE_STANDARD, PROFILE_VTUBER]);

export function parseProfile(value) {
  if (value === undefined || value === null) return PROFILE_STANDARD;
  if (typeof value !== 'string' || !SUPPORTED_PROFILES.includes(value)) {
    throw new Error(`Unknown profile: ${String(value)}. Supported profiles: ${SUPPORTED_PROFILES.join(', ')}.`);
  }
  return value;
}

export function resolveJobProfile(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    throw new Error('Job data must be an object.');
  }
  return parseProfile(job.profile);
}

export function withResolvedJobProfile(job) {
  return { ...job, profile: resolveJobProfile(job) };
}
