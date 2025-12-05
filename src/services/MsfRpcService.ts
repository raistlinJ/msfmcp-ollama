import { AppConfig } from '../config';
import { logger } from '../logger';
import { ManagedProcess, ProcessInfo } from '../processes/ManagedProcess';

export class MsfRpcService {
  private readonly process: ManagedProcess;

  constructor(private readonly cfg: AppConfig) {
    this.process = new ManagedProcess({
      name: 'msfrpcd',
      command: cfg.msfrpcdPath,
      args: this.buildArgs(),
    });
  }

  private buildArgs(): string[] {
    const args = [
      '-U',
      this.cfg.msfUser,
      '-P',
      this.cfg.msfPassword,
      '-a',
      this.cfg.msfHost,
      '-p',
      String(this.cfg.msfPort),
      '-f',
    ];

    if (!this.cfg.msfRpcSsl) {
      args.push('-S');
    }

    return args;
  }

  async ensureRunning(): Promise<void> {
    if (!this.cfg.autoStartMsfrpcd) {
      logger.info('MSFRPCD auto-start disabled; assuming it is already running.');
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
}
