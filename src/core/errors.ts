export type ErrorCode =
  | 'capture_unavailable' | 'invalid_request' | 'unauthorized' | 'locked' | 'session_changed'
  | 'no_vault' | 'invalid_vault' | 'unlock_failed' | 'weak_password'
  | 'invalid_connection' | 'permission_required' | 'network' | 'timeout'
  | 'authentication' | 'forbidden' | 'not_found' | 'rate_limited'
  | 'duplicate' | 'server' | 'invalid_response' | 'invalid_destination' | 'write_uncertain' | 'conflict' | 'unsupported_edit';

export class AppError extends Error {
  constructor(readonly code: ErrorCode) { super(code); this.name = 'AppError'; }
}

export function errorCode(error: unknown): ErrorCode {
  if (error instanceof AppError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code);
    if (['invalid_vault', 'unlock_failed', 'weak_password', 'invalid_connection'].includes(code)) return code as ErrorCode;
  }
  return 'invalid_request';
}
