import type { ErrorCode } from '@klockr/contracts';
import { err, type Err, type Result } from '@klockr/domain';

/** Typed application error. Every expected failure of a command is one of these codes. */
export interface AppError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type CommandResult<T> = Result<T, AppError>;

export function appError(
  code: ErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): Err<AppError> {
  return err(details === undefined ? { code, message } : { code, message, details });
}
