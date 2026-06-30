import { createHash } from 'crypto';

export function logHash(value, len = 12) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, len);
}

export function safeAccountRef(accountOrId, label = '') {
  const id = typeof accountOrId === 'object'
    ? (accountOrId?.id || 'unknown')
    : (accountOrId || 'unknown');
  const rawLabel = typeof accountOrId === 'object'
    ? (accountOrId?.email || accountOrId?.name || label || '')
    : (label || '');
  const out = `account=${id}`;
  return rawLabel ? `${out} labelHash=${logHash(rawLabel)}` : out;
}

export function safeEmailRef(email) {
  return `emailHash=${logHash(email)}`;
}

export function safeKeyRef(key, prefix = 'key') {
  return `${prefix}Hash=${logHash(key)}`;
}
