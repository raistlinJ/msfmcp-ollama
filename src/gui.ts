import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config, configFilePath } from './config';
import { logger } from './logger';
import { BridgeController, ServiceId } from './services/BridgeController';

const controller = new BridgeController(config);
const app = express();
const port = Number(process.env.BRIDGE_GUI_PORT ?? 4173);
const publicDir = path.join(process.cwd(), 'public');
const envFilePath = path.join(process.cwd(), '.env');

app.use(express.json({ limit: '1mb' }));

class ClientError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

app.get('/api/status', (_req, res) => {
  res.json({ services: controller.getStatus() });
});

const handleServiceAction = (action: (id: ServiceId) => Promise<void>) => {
  return async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    if (!controller.hasService(id)) {
      res.status(404).json({ error: `Unknown service ${id}` });
      return;
    }
    try {
      await action(id);
      res.json({ ok: true, services: controller.getStatus() });
    } catch (error) {
      logger.error(`Service action failed for ${id}`, error);
      res.status(500).json({ error: (error as Error).message ?? 'Service action failed' });
    }
  };
};

app.post('/api/service/:id/start', handleServiceAction((id) => controller.startService(id)));
app.post('/api/service/:id/stop', handleServiceAction((id) => controller.stopService(id)));
app.post('/api/service/:id/clear-logs', handleServiceAction((id) => controller.clearServiceLogs(id)));

app.post('/api/start-all', async (_req, res) => {
  try {
    await controller.startAll();
    res.json({ ok: true, services: controller.getStatus() });
  } catch (error) {
    logger.error('Failed to start all services', error);
    res.status(500).json({ error: (error as Error).message ?? 'Failed to start all services' });
  }
});

app.post('/api/stop-all', async (_req, res) => {
  try {
    await controller.stopAll();
    res.json({ ok: true, services: controller.getStatus() });
  } catch (error) {
    logger.error('Failed to stop all services', error);
    res.status(500).json({ error: (error as Error).message ?? 'Failed to stop all services' });
  }
});

const serveFile = (label: string, filePath: string) => async (_req: express.Request, res: express.Response) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    res.type('text/plain').send(content);
  } catch (error) {
    logger.warn(`${label} unavailable at ${filePath}`, error);
    res.status(404).json({ error: `${label} not found at ${filePath}` });
  }
};

app.get('/api/files/bridge-config', serveFile('Bridge config', configFilePath));
app.get('/api/files/env', serveFile('.env file', envFilePath));

const getContentFromBody = (req: express.Request): string => {
  const body = req.body as { content?: unknown } | undefined;
  if (!body || typeof body.content !== 'string') {
    throw new ClientError('Request body must include a string "content" field');
  }
  return body.content;
};
const getLineFromBody = (req: express.Request): string => {
  const body = req.body as { line?: unknown } | undefined;
  if (!body || typeof body.line !== 'string') {
    throw new ClientError('Request body must include a string "line" field');
  }
  return body.line;
};
app.post('/api/service/:id/input', async (req, res) => {
  const id = req.params.id;
  if (!controller.hasService(id)) {
    res.status(404).json({ error: `Unknown service ${id}` });
    return;
  }
  try {
    const line = getLineFromBody(req);
    controller.sendServiceInput(id, line);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof ClientError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error(`Failed to send input to ${id}`, error);
    res.status(500).json({ error: (error as Error).message ?? 'Failed to send input' });
  }
});

const saveFile = (
  label: string,
  writer: (content: string) => Promise<void>,
) => async (req: express.Request, res: express.Response) => {
  try {
    const content = getContentFromBody(req);
    await writer(content);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof ClientError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error(`Failed to save ${label}`, error);
    res.status(500).json({ error: `Failed to save ${label}` });
  }
};

const bridgeConfigWriter = async (content: string) => {
  try {
    const parsed = JSON.parse(content);
    const normalized = `${JSON.stringify(parsed, null, 2)}\n`;
    await fs.writeFile(configFilePath, normalized, 'utf-8');
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ClientError('Bridge config must be valid JSON');
    }
    throw error;
  }
};

const envFileWriter = async (content: string) => {
  await fs.writeFile(envFilePath, content, 'utf-8');
};

app.post('/api/files/bridge-config', saveFile('bridge config', bridgeConfigWriter));
app.post('/api/files/env', saveFile('.env file', envFileWriter));

app.use(express.static(publicDir));

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'gui.html'));
});

const server = app.listen(port, async () => {
  logger.info(`Bridge GUI available at http://127.0.0.1:${port}`);
  try {
    await controller.startAutoManagedServices();
    logger.info('Auto-managed services started. Use the GUI to start/stop components as needed.');
  } catch (error) {
    logger.error('Failed to auto-start services', error);
  }
});

const shutdown = async () => {
  logger.info('Shutting down GUI and services...');
  server.close();
  await controller.stopAll();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
