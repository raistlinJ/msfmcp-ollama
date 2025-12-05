import path from 'node:path';
import { AppConfig } from '../config';
import { logger } from '../logger';
import { ManagedProcess, ProcessInfo } from '../processes/ManagedProcess';

export class MetasploitMcpService {
  private readonly process: ManagedProcess;

  constructor(private readonly cfg: AppConfig) {
    this.process = new ManagedProcess({
      name: 'MetasploitMCP',
      command: cfg.metasploitMcpPython,
      args: this.buildArgs(),
      cwd: cfg.metasploitMcpPath,
      env: this.buildEnv(),
    });
  }

  private buildArgs(): string[] {
    const scriptPath = path.resolve(this.cfg.metasploitMcpPath, 'MetasploitMCP.py');
    const args = [
      ...this.cfg.metasploitMcpExtraArgs,
      scriptPath,
      '--transport',
      this.cfg.metasploitMcpTransport,
    ];

    if (this.cfg.metasploitMcpTransport === 'http') {
      args.push('--host', this.cfg.metasploitMcpHost, '--port', String(this.cfg.metasploitMcpPort));
    }

    return args;
  }

  private buildEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      MSF_USER: this.cfg.msfUser,
      MSF_PASSWORD: this.cfg.msfPassword,
      MSF_SERVER: this.cfg.msfHost,
      MSF_PORT: String(this.cfg.msfPort),
      MSF_SSL: String(this.cfg.msfRpcSsl),
      PAYLOAD_SAVE_DIR: this.cfg.payloadSaveDir,
    };
  }

  async start(): Promise<void> {
    logger.info('Launching Metasploit MCP server...');
    await this.process.start();
  }

  async ensureRunning(): Promise<void> {
    if (!this.cfg.autoStartMetasploitMcp) {
      logger.info('Metasploit MCP auto-start disabled; ensure it is running manually.');
      return;
    }

    await this.start();
  }

  async stop(): Promise<void> {
    await this.process.stop();
  }

  getInfo(): ProcessInfo {
    return this.process.getInfo();
  }

  clearLogs(): void {
    this.process.clearLogs();
  }
}
