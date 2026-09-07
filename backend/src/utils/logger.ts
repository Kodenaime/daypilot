export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

interface LogPayload {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  [key: string]: any;
}

function formatLog(level: LogLevel, category: string, message: string, context?: Record<string, any>): string {
  const payload: LogPayload = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    ...(context || {})
  };
  return JSON.stringify(payload);
}

export function logInfo(category: string, message: string, context?: Record<string, any>): void {
  console.log(formatLog('INFO', category, message, context));
}

export function logWarn(category: string, message: string, context?: Record<string, any>): void {
  console.warn(formatLog('WARN', category, message, context));
}

export function logError(category: string, message: string, context?: Record<string, any>): void {
  console.error(formatLog('ERROR', category, message, context));
}
