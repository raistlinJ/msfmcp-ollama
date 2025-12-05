import http from 'node:http';
import https from 'node:https';
import { AppConfig } from '../config';
import { logger } from '../logger';
import { ManagedProcess, ProcessInfo } from '../processes/ManagedProcess';

export class OllamaService {
  private readonly process: ManagedProcess;
  private externalRunning = false;
  private externalMessage = '';
  private readonly checkerIntervalMs = 8000;
  private checker?: NodeJS.Timeout;

  constructor(private readonly cfg: AppConfig) {
    this.process = new ManagedProcess({
      name: 'ollama',
      command: cfg.ollamaServeCommand,
      args: this.buildArgs(),
    });
    this.startExternalWatcher();
  }

  private buildArgs(): string[] {
    if (this.cfg.ollamaServeArgs.length > 0) {
      return this.cfg.ollamaServeArgs;
    }
    return ['serve'];
  }

  private startExternalWatcher() {
    const poll = async () => {
      try {
        await this.pollExternalInstance();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.externalRunning = false;
        this.externalMessage = `Error checking Ollama: ${message}`;
      }
    };
    void poll();
    this.checker = setInterval(poll, this.checkerIntervalMs);
  }

  private async pollExternalInstance(): Promise<void> {
    const url = new URL('/api/version', this.cfg.ollamaApiUrl);
    const transport = url.protocol === 'https:' ? https : http;
    const statusCode = await new Promise<number>((resolve, reject) => {
      const req = transport.request(
        {
          method: 'GET',
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          timeout: 1500,
        },
        (res) => {
          const code = res.statusCode ?? 0;
          res.resume();
          resolve(code);
        },
      );
      req.on('timeout', () => {
        req.destroy(new Error('Request timed out'));
      });
      req.on('error', reject);
      req.end();
    });

    if (statusCode >= 200 && statusCode < 300) {
      this.externalRunning = true;
      this.externalMessage = 'Detected existing Ollama daemon.';
      return;
    }
    this.externalRunning = false;
    this.externalMessage = `Ollama API responded with status ${statusCode}`;
  }

  async ensureRunning(): Promise<void> {
    if (!this.cfg.autoStartOllama) {
      logger.info('Ollama auto-start disabled; ensure the daemon is running manually.');
      return;
    }
    if (this.externalRunning) {
      logger.info('Ollama already detected via API; skipping managed start.');
      return;
    }
    await this.start();
  }

  async start(): Promise<void> {
    logger.info('Launching Ollama daemon...');
    try {
      await this.process.start();
    } catch (error) {
      this.externalMessage = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.process.stop('SIGINT');
  }

  getInfo(): ProcessInfo {
    const info = this.process.getInfo();
    const logsWithMessage = (message: string) => {
      const entry = `[info] ${message}`;
      if (info.logs[info.logs.length - 1] === entry) {
        return info.logs;
      }
      return [...info.logs, entry];
    };
    if (info.state !== 'running' && this.externalRunning) {
      return {
        ...info,
        state: 'running',
        logs: logsWithMessage(this.externalMessage || 'External Ollama daemon detected.'),
      };
    }
    if (this.externalMessage) {
      return { ...info, logs: logsWithMessage(this.externalMessage) };
    }
    return info;
  }

  clearLogs(): void {
    this.process.clearLogs();
  }
}
