export type EngineErrorCode =
  | 'EMPTY_NAME'
  | 'DUPLICATE_NAME'
  | 'INVALID_COURTS'
  | 'LAST_COURT'
  | 'NOT_FOUND'
  | 'NOT_PLAYING'
  | 'NOT_READY'
  | 'CANNOT_RETURN';

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}
