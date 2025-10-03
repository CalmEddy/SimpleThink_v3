/**
 * Graceful error handling for AI services
 * Provides user-friendly error messages for common API issues
 */

export interface AIErrorInfo {
  userMessage: string;
  isRetryable: boolean;
  retryAfter?: number; // seconds
  technicalDetails?: string;
}

/**
 * Categorizes AI errors and provides user-friendly messages
 */
export function categorizeAIError(error: Error | string): AIErrorInfo {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const lowerMessage = errorMessage.toLowerCase();

  // Network/Infrastructure errors (retryable)
  if (lowerMessage.includes('502') || lowerMessage.includes('bad gateway')) {
    return {
      userMessage: "AI services are temporarily unavailable. Please try again in a few minutes.",
      isRetryable: true,
      retryAfter: 60,
      technicalDetails: errorMessage
    };
  }

  if (lowerMessage.includes('503') || lowerMessage.includes('service unavailable')) {
    return {
      userMessage: "AI services are temporarily overloaded. Please try again in a few minutes.",
      isRetryable: true,
      retryAfter: 120,
      technicalDetails: errorMessage
    };
  }

  if (lowerMessage.includes('504') || lowerMessage.includes('gateway timeout')) {
    return {
      userMessage: "The request timed out. Please try again.",
      isRetryable: true,
      retryAfter: 30,
      technicalDetails: errorMessage
    };
  }

  if (lowerMessage.includes('network') || lowerMessage.includes('connection')) {
    return {
      userMessage: "Network connection issue. Please check your internet connection and try again.",
      isRetryable: true,
      retryAfter: 30,
      technicalDetails: errorMessage
    };
  }

  // Rate limiting (retryable)
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('429')) {
    return {
      userMessage: "Too many requests. Please wait a moment before trying again.",
      isRetryable: true,
      retryAfter: 60,
      technicalDetails: errorMessage
    };
  }

  // Authentication errors (not retryable without user action)
  if (lowerMessage.includes('api key') || lowerMessage.includes('401') || lowerMessage.includes('unauthorized')) {
    return {
      userMessage: "API key issue. Please check your AI Keys settings.",
      isRetryable: false,
      technicalDetails: errorMessage
    };
  }

  if (lowerMessage.includes('403') || lowerMessage.includes('forbidden')) {
    return {
      userMessage: "Access denied. Please check your API key permissions.",
      isRetryable: false,
      technicalDetails: errorMessage
    };
  }

  // Quota/billing errors (not retryable without user action)
  if (lowerMessage.includes('quota') || lowerMessage.includes('billing') || lowerMessage.includes('payment')) {
    return {
      userMessage: "API quota exceeded or billing issue. Please check your account.",
      isRetryable: false,
      technicalDetails: errorMessage
    };
  }

  // JSON parsing errors (not retryable)
  if (lowerMessage.includes('json') || lowerMessage.includes('parse')) {
    return {
      userMessage: "Response format error. Please try again.",
      isRetryable: true,
      retryAfter: 10,
      technicalDetails: errorMessage
    };
  }

  // Text format parsing errors (not retryable)
  if (lowerMessage.includes('text parsing') || lowerMessage.includes('format detection') || lowerMessage.includes('template doc')) {
    return {
      userMessage: "AI response format error. Please try again.",
      isRetryable: true,
      retryAfter: 10,
      technicalDetails: errorMessage
    };
  }

  // Prompt loading errors (not retryable)
  if (lowerMessage.includes('prompt loading') || lowerMessage.includes('whimsical-expansion')) {
    return {
      userMessage: "Prompt configuration error. Please refresh the page.",
      isRetryable: false,
      technicalDetails: errorMessage
    };
  }

  // Generic fallback - include technical details for debugging
  return {
    userMessage: `An unexpected error occurred: ${errorMessage}`,
    isRetryable: true,
    retryAfter: 30,
    technicalDetails: errorMessage
  };
}

/**
 * Formats error for display with optional retry information
 */
export function formatErrorForDisplay(errorInfo: AIErrorInfo, showRetryInfo: boolean = true): string {
  let message = errorInfo.userMessage;
  
  if (showRetryInfo && errorInfo.isRetryable && errorInfo.retryAfter) {
    message += ` (Retry in ${errorInfo.retryAfter}s)`;
  }
  
  return message;
}

/**
 * Checks if an error is retryable
 */
export function isRetryableError(error: Error | string): boolean {
  return categorizeAIError(error).isRetryable;
}

/**
 * Gets retry delay in milliseconds
 */
export function getRetryDelay(error: Error | string): number {
  const errorInfo = categorizeAIError(error);
  return errorInfo.retryAfter ? errorInfo.retryAfter * 1000 : 30000; // default 30s
}
