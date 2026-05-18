export class BaseAppError extends Error {
  constructor(
    public readonly message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly isOperational = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends BaseAppError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
  }
}

export class RateLimitError extends BaseAppError {
  constructor(retryAfter: number) {
    super("Rate limit exceeded", "RATE_LIMIT_EXCEEDED", 429);
    this.retryAfter = retryAfter;
  }
  public retryAfter: number;
}

export class InfraError extends BaseAppError {
  constructor(message: string) {
    super(message, "INFRA_ERROR", 503);
  }
}

export function toHttpError(error: unknown): BaseAppError {
  if (error instanceof BaseAppError) return error;
  if (error instanceof Error) return new InfraError(error.message);
  return new InfraError("Unknown error occurred");
}
