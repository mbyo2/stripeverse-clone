// Centralized error handling with sanitized messages

export class AppError extends Error {
  constructor(
    message: string,
    public userMessage: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const sanitizeError = (error: unknown): { message: string; statusCode: number } => {
  // Log the full error server-side (in production, use proper logging service)
  console.error('Error occurred:', error);
  
  if (error instanceof AppError) {
    return {
      message: error.userMessage,
      statusCode: error.statusCode
    };
  }
  
  if (error instanceof Error) {
    // Don't leak internal error messages to users
    const sensitivePatterns = [
      /database/i,
      /query/i,
      /connection/i,
      /authentication/i,
      /token/i,
      /secret/i,
      /password/i,
      /api key/i
    ];
    
    const isSensitive = sensitivePatterns.some(pattern => pattern.test(error.message));
    
    if (isSensitive) {
      return {
        message: 'An error occurred. Please try again later.',
        statusCode: 500
      };
    }
    
    return {
      message: error.message,
      statusCode: 500
    };
  }
  
  return {
    message: 'An unexpected error occurred',
    statusCode: 500
  };
};
