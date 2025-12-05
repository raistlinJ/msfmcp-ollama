import { AppConfig } from '../config';
import { logger } from '../logger';
import { ManagedProcess, ProcessInfo } from '../processes/ManagedProcess';

export class OllmcpService {
  private readonly process: ManagedProcess;

  constructor(private readonly cfg: AppConfig) {
    this.process = new ManagedProcess({
      name: 'ollmcp',
      command: cfg.ollmcpCommand,
      args: this.buildArgs(),
      stdin: 'pipe',
    });
  }

  private buildArgs(): string[] {
    if (this.cfg.extraOllmcpArgs.length > 0) {
      return this.cfg.extraOllmcpArgs;
    }

    const metasploitServerUrl = `http://${this.cfg.metasploitMcpHost}:${this.cfg.metasploitMcpPort}/sse`;
    return [
      '--model',
      this.cfg.ollmcpModel,
      '--host',
      this.cfg.ollamaApiUrl,
      '--mcp-server-url',
      metasploitServerUrl,
    ];
  }

  async ensureRunning(): Promise<void> {
    if (!this.cfg.autoStartOllmcp) {
      logger.info('ollmcp auto-start disabled; run it manually if desired.');
      return;
    }

    await this.start();
  }

  async stop(): Promise<void> {
    await this.process.stop();
  }

  async start(): Promise<void> {
    await this.process.start();
  }

  getInfo(): ProcessInfo {
    return this.process.getInfo();
  }

  clearLogs(): void {
    this.process.clearLogs();
  }

  sendInput(line: string): void {
    const payload = line.endsWith('\n') ? line : `${line}\n`;
    this.process.writeInput(payload);
  }
}
