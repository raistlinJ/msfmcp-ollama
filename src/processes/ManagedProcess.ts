import { ChildProcess, SpawnOptions, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import process from 'node:process';
import treeKill from 'tree-kill';
import { logger } from '../logger';

export type ProcessState = 'stopped' | 'starting' | 'running' | 'stopping';

export interface ProcessInfo {
  state: ProcessState;
  pid?: number;
  lastExit?: { code: number | null; signal: NodeJS.Signals | null };
  logs: string[];
}

export interface ManagedProcessOptions {
  name: string;
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  readyPattern?: RegExp;
  stdin?: 'ignore' | 'pipe' | 'inherit';
}

export class ManagedProcess extends EventEmitter {
  private child?: ChildProcess;
  private readonly options: ManagedProcessOptions;
  private state: ProcessState = 'stopped';
  private lastExit?: { code: number | null; signal: NodeJS.Signals | null };
  private readonly logBuffer: string[] = [];
  private static readonly MAX_LOG_LINES = 200;
  private readonly streamBuffers: Record<'stdout' | 'stderr', string> = {
    stdout: '',
    stderr: '',
  };

  constructor(options: ManagedProcessOptions) {
    super();
    this.options = { ...options, args: options.args ?? [] };
  }

  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      logger.debug(`${this.options.name} already ${this.state}`);
      return;
    }

    logger.info(`Starting ${this.options.name}...`);
    this.setState('starting');
    const stdin = this.options.stdin ?? 'ignore';
    const spawnOptions: SpawnOptions = {
      env: { ...process.env, ...this.options.env },
      cwd: this.options.cwd ?? process.cwd(),
      stdio: [stdin, 'pipe', 'pipe'],
    };

    this.child = spawn(this.options.command, this.options.args ?? [], spawnOptions);

    await new Promise<void>((resolve, reject) => {
      let readyResolved = false;

      const flushBufferedLine = (stream: 'stdout' | 'stderr', line: string) => {
        const sanitized = line.replace(/\r$/, '');
        logger.debug(`[${this.options.name}:${stream}] ${sanitized}`);
        this.pushLog(`[${stream}] ${sanitized}`);
        this.emit('output', { stream, text: sanitized });
      };

      const drainStreamBuffer = (stream: 'stdout' | 'stderr') => {
        const buffered = this.streamBuffers[stream];
        if (buffered.length === 0) {
          return;
        }
        flushBufferedLine(stream, buffered);
        this.streamBuffers[stream] = '';
      };

      const handleOutput = (data: Buffer, stream: 'stdout' | 'stderr') => {
        const chunk = data.toString();
        if (chunk.length === 0) {
          return;
        }

        this.streamBuffers[stream] += chunk;
        let buffer = this.streamBuffers[stream];
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex);
          flushBufferedLine(stream, line);
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf('\n');
        }
        this.streamBuffers[stream] = buffer;

        if (!readyResolved && this.options.readyPattern && this.options.readyPattern.test(chunk)) {
          readyResolved = true;
          this.setState('running');
          resolve();
        }
      };

      this.child?.stdout?.on('data', (data) => handleOutput(data, 'stdout'));
      this.child?.stderr?.on('data', (data) => handleOutput(data, 'stderr'));

      this.child?.once('error', (error) => {
        logger.error(`${this.options.name} crashed`, error);
         this.setState('stopped');
        reject(error);
      });

      this.child?.once('exit', (code, signal) => {
        drainStreamBuffer('stdout');
        drainStreamBuffer('stderr');
        this.child = undefined;
        const reason = code !== null ? `code ${code}` : `signal ${signal}`;
        logger.warn(`${this.options.name} exited (${reason})`);
         this.lastExit = { code, signal };
         this.setState('stopped');
      });

      if (!this.options.readyPattern && !readyResolved) {
        readyResolved = true;
        this.setState('running');
        resolve();
      }
    });
  }

  async stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    if (!this.child?.pid) {
      this.setState('stopped');
      return;
    }

    logger.info(`Stopping ${this.options.name}...`);
    this.setState('stopping');
    await new Promise<void>((resolve, reject) => {
      treeKill(this.child!.pid!, signal, (error) => {
        if (error) {
          logger.error(`Failed to stop ${this.options.name}`, error);
          reject(error);
          return;
        }
        this.child = undefined;
        this.setState('stopped');
        resolve();
      });
    });
  }

  private setState(next: ProcessState) {
    if (this.state === next) {
      return;
    }
    this.state = next;
    this.emit('state', next);
  }

  private pushLog(line: string) {
    this.logBuffer.push(line);
    if (this.logBuffer.length > ManagedProcess.MAX_LOG_LINES) {
      this.logBuffer.shift();
    }
  }

  getInfo(): ProcessInfo {
    return {
      state: this.state,
      pid: this.child?.pid,
      lastExit: this.lastExit,
      logs: [...this.logBuffer],
    };
  }

  isRunning(): boolean {
    return this.state === 'running';
  }

  clearLogs(): void {
    this.logBuffer.length = 0;
  }

  writeInput(payload: string): void {
    if (!this.child || !this.child.stdin) {
      throw new Error(`${this.options.name} is not running or stdin unavailable`);
    }
    this.child.stdin.write(payload);
  }
}
