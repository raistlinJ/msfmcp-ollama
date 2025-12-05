import { config } from './config';
import { logger } from './logger';
import { BridgeController } from './services/BridgeController';

async function main() {
  const controller = new BridgeController(config);

  const shutdown = async () => {
    logger.info('Shutting down services...');
    await controller.stopAll();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await controller.startAutoManagedServices();
    logger.info('Bridge ready. ollmcp can now reach the Metasploit MCP server.');
  } catch (error) {
    logger.error('Bridge failed to start', error);
    await shutdown();
  }
}

main().catch((error) => {
  logger.error('Fatal startup error', error);
  process.exit(1);
});
