import { ENV } from '@/config';

/**
 * Normalizes relative keys, localhost URLs, and absolute remote URLs
 * to a fully qualified, loadable URL for mobile devices.
 */
export function resolveMediaUrl(urlOrKey?: string | null): string | null {
  if (!urlOrKey) return null;
  const trimmed = urlOrKey.trim();
  if (!trimmed) return null;

  // Local file / data / blob URI
  if (trimmed.startsWith('file://') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  const backendOrigin = ENV.API_URL.replace(/\/api\/?$/, '');

  // Backend returned http://localhost:5000 or http://127.0.0.1:5000
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(trimmed)) {
    const path = trimmed.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
    return `${backendOrigin}${path.startsWith('/') ? path : `/${path}`}`;
  }

  // Already a full remote URL (e.g. public Supabase bucket or cloud backend)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  // Relative path starting with /
  if (trimmed.startsWith('/')) {
    return `${backendOrigin}${trimmed}`;
  }

  // Canonical storage key like "users/avatars/..."
  return `${backendOrigin}/media/${trimmed}`;
}
