import type { AppError } from '@klockr/application';
import type { ErrorCode, ErrorResponse } from '@klockr/contracts';

const STATUS: Readonly<Record<ErrorCode, number>> = {
  validation_failed: 400,
  forbidden: 403,
  not_found: 404,
  revision_conflict: 409,
  invalid_transition: 409,
  idempotency_conflict: 422,
  locked: 423,
  internal: 500,
};

export function httpStatusOf(error: AppError): number {
  return STATUS[error.code];
}

export function errorBody(error: AppError): ErrorResponse {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: { ...error.details } } : {}),
    },
  };
}

export const unauthenticated: ErrorResponse = {
  error: { code: 'forbidden', message: 'Missing or invalid credential' },
};
