type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelInput = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
const level = (['debug', 'info', 'warn', 'error'].includes(levelInput)
  ? (levelInput as LogLevel)
  : 'info');
const levelWeights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const shouldLog = (requested: LogLevel) => {
  return levelWeights[requested] >= levelWeights[level];
};

export const logger = {
  debug: (...args: unknown[]) => shouldLog('debug') && console.debug('[debug]', ...args),
  info: (...args: unknown[]) => shouldLog('info') && console.info('[info]', ...args),
  warn: (...args: unknown[]) => shouldLog('warn') && console.warn('[warn]', ...args),
  error: (...args: unknown[]) => shouldLog('error') && console.error('[error]', ...args),
};
