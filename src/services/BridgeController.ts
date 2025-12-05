import { AppConfig } from '../config';
import { logger } from '../logger';
import { MetasploitMcpService } from './MetasploitMcpService';
import { MsfRpcService } from './MsfRpcService';
import { OllmcpService } from './OllmcpService';
import { OllamaService } from './OllamaService';
import { ProcessInfo } from '../processes/ManagedProcess';

export type ServiceId = 'msfrpcd' | 'metasploit-mcp' | 'ollmcp' | 'ollama';

export interface ServiceSnapshot {
  id: ServiceId;
  label: string;
  description: string;
  autoStart: boolean;
  info: ProcessInfo;
}

interface ManagedService {
  id: ServiceId;
  label: string;
  description: string;
  autoStart: boolean;
  ensure: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  info: () => ProcessInfo;
  clearLogs: () => void;
  sendInput?: (line: string) => void;
}

export class BridgeController {
  private readonly services: Record<ServiceId, ManagedService>;

  constructor(private readonly cfg: AppConfig) {
    const msf = new MsfRpcService(cfg);
    const metasploit = new MetasploitMcpService(cfg);
    const ollmcp = new OllmcpService(cfg);
    const ollama = new OllamaService(cfg);

    this.services = {
      'msfrpcd': {
        id: 'msfrpcd',
        label: 'msfrpcd',
        description: 'Metasploit RPC daemon',
        autoStart: cfg.autoStartMsfrpcd,
        ensure: () => msf.ensureRunning(),
        start: () => msf.start(),
        stop: () => msf.stop(),
        info: () => msf.getInfo(),
        clearLogs: () => msf.clearLogs(),
      },
      'metasploit-mcp': {
        id: 'metasploit-mcp',
        label: 'Metasploit MCP',
        description: 'Python MCP server wrapping Metasploit',
        autoStart: cfg.autoStartMetasploitMcp,
        ensure: () => metasploit.ensureRunning(),
        start: () => metasploit.start(),
        stop: () => metasploit.stop(),
        info: () => metasploit.getInfo(),
        clearLogs: () => metasploit.clearLogs(),
      },
      'ollmcp': {
        id: 'ollmcp',
        label: 'ollmcp CLI',
        description: 'Optional Ollama MCP client',
        autoStart: cfg.autoStartOllmcp,
        ensure: () => ollmcp.ensureRunning(),
        start: () => ollmcp.start(),
        stop: () => ollmcp.stop(),
        info: () => ollmcp.getInfo(),
        clearLogs: () => ollmcp.clearLogs(),
        sendInput: (line: string) => ollmcp.sendInput(line),
      },
      'ollama': {
        id: 'ollama',
        label: 'Ollama',
        description: 'Local Ollama model server',
        autoStart: cfg.autoStartOllama,
        ensure: () => ollama.ensureRunning(),
        start: () => ollama.start(),
        stop: () => ollama.stop(),
        info: () => ollama.getInfo(),
        clearLogs: () => ollama.clearLogs(),
      },
    };
  }

  async startAutoManagedServices(): Promise<void> {
    for (const service of Object.values(this.services)) {
      if (!service.autoStart) {
        logger.info(`${service.label} auto-start disabled; skip ensure.`);
        continue;
      }
      await service.ensure();
    }
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled(Object.values(this.services).map((svc) => svc.stop()));
  }

  async startAll(): Promise<void> {
    for (const svc of Object.values(this.services)) {
      await svc.start();
    }
  }

  async startService(id: ServiceId): Promise<void> {
    const svc = this.services[id];
    if (!svc) {
      throw new Error(`Unknown service: ${id}`);
    }
    await svc.start();
  }

  async stopService(id: ServiceId): Promise<void> {
    const svc = this.services[id];
    if (!svc) {
      throw new Error(`Unknown service: ${id}`);
    }
    await svc.stop();
  }

  async clearServiceLogs(id: ServiceId): Promise<void> {
    const svc = this.services[id];
    if (!svc) {
      throw new Error(`Unknown service: ${id}`);
    }
    svc.clearLogs();
  }

  sendServiceInput(id: ServiceId, line: string): void {
    const svc = this.services[id];
    if (!svc) {
      throw new Error(`Unknown service: ${id}`);
    }
    if (!svc.sendInput) {
      throw new Error(`Service ${id} does not accept interactive input`);
    }
    svc.sendInput(line);
  }

  getStatus(): ServiceSnapshot[] {
    return Object.values(this.services).map((svc) => ({
      id: svc.id,
      label: svc.label,
      description: svc.description,
      autoStart: svc.autoStart,
      info: svc.info(),
    }));
  }

  hasService(id: string): id is ServiceId {
    return id === 'msfrpcd' || id === 'metasploit-mcp' || id === 'ollmcp' || id === 'ollama';
  }
}
