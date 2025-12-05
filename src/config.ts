import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const bool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

type FileConfig = Partial<{
  msfUser: string;
  msfPassword: string;
  msfHost: string;
  msfPort: number;
  msfRpcSsl: boolean;
  msfrpcdPath: string;
  autoStartMsfrpcd: boolean;
  metasploitMcpPath: string;
  metasploitMcpPython: string;
  metasploitMcpExtraArgs: string[] | string;
  metasploitMcpHost: string;
  metasploitMcpPort: number;
  metasploitMcpTransport: 'http' | 'stdio';
  autoStartMetasploitMcp: boolean;
  payloadSaveDir: string;
  ollmcpCommand: string;
  ollamaApiUrl: string;
  ollmcpModel: string;
  autoStartOllmcp: boolean;
  extraOllmcpArgs: string[] | string;
  ollamaServeCommand: string;
  ollamaServeArgs: string[] | string;
  autoStartOllama: boolean;
}>;

const ConfigSchema = z.object({
  msfUser: z.string().default('msf'),
  msfPassword: z.string().default('changeme'),
  msfHost: z.string().default('127.0.0.1'),
  msfPort: z.number().int().default(55553),
  msfRpcSsl: z.boolean().default(false),
  msfrpcdPath: z.string().default('msfrpcd'),
  autoStartMsfrpcd: z.boolean().default(true),
  metasploitMcpPath: z.string(),
  metasploitMcpPython: z.string().default('python3'),
  metasploitMcpExtraArgs: z.array(z.string()).default([]),
  metasploitMcpHost: z.string().default('127.0.0.1'),
  metasploitMcpPort: z.number().int().default(8085),
  metasploitMcpTransport: z.enum(['http', 'stdio']).default('http'),
  payloadSaveDir: z.string(),
  ollmcpCommand: z.string().default('ollmcp'),
  ollamaApiUrl: z.string().default('http://127.0.0.1:11434'),
  ollmcpModel: z.string().default('gpt-oss:20b'),
  autoStartMetasploitMcp: z.boolean().default(true),
  autoStartOllmcp: z.boolean().default(false),
  extraOllmcpArgs: z.array(z.string()).default([]),
  ollamaServeCommand: z.string().default('ollama'),
  ollamaServeArgs: z.array(z.string()).default(['serve']),
  autoStartOllama: z.boolean().default(false),
});

const defaultMcpPath = path.join(process.cwd(), 'MetasploitMCP');
const defaultPayloadDir = path.join(os.homedir(), 'payloads');
const defaultConfigPath = process.env.BRIDGE_CONFIG_PATH ?? path.join(process.cwd(), 'config', 'bridge.config.json');
export const configFilePath = defaultConfigPath;

const loadFileConfig = (filePath: string): FileConfig => {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    if (!rawContent.trim()) {
      return {};
    }
    return JSON.parse(rawContent) as FileConfig;
  } catch (error) {
    console.warn(`Failed to read config file at ${filePath}. Falling back to env/defaults.`, error);
    return {};
  }
};

const parseCsv = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const fromArraySources = (envValue: string | undefined, fileValue?: string[] | string) => {
  if (envValue) {
    return parseCsv(envValue);
  }
  if (Array.isArray(fileValue)) {
    return fileValue;
  }
  if (typeof fileValue === 'string') {
    return parseCsv(fileValue);
  }
  return undefined;
};

const fromNumberSources = (envValue: string | undefined, fileValue?: number) => {
  if (envValue === undefined) {
    return fileValue;
  }
  const parsed = Number(envValue);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const fromStringSources = (envValue: string | undefined, fileValue?: string, fallback?: string) => {
  return envValue ?? fileValue ?? fallback;
};

const fromBooleanSources = (envValue: string | undefined, fileValue: boolean | undefined, fallback: boolean) => {
  if (envValue !== undefined) {
    return bool(envValue, fallback);
  }
  if (typeof fileValue === 'boolean') {
    return fileValue;
  }
  return fallback;
};

const fileConfig = loadFileConfig(defaultConfigPath);

const raw = {
  msfUser: fromStringSources(process.env.MSF_USER, fileConfig.msfUser),
  msfPassword: fromStringSources(process.env.MSF_PASSWORD, fileConfig.msfPassword),
  msfHost: fromStringSources(process.env.MSF_HOST, fileConfig.msfHost),
  msfPort: fromNumberSources(process.env.MSF_PORT, fileConfig.msfPort),
  msfRpcSsl: fromBooleanSources(process.env.MSF_RPC_SSL, fileConfig.msfRpcSsl, false),
  msfrpcdPath: fromStringSources(process.env.MSFRPCD_PATH, fileConfig.msfrpcdPath),
  autoStartMsfrpcd: fromBooleanSources(process.env.MSFRPCD_AUTO_START, fileConfig.autoStartMsfrpcd, true),
  metasploitMcpPath: fromStringSources(process.env.METASPLOIT_MCP_PATH, fileConfig.metasploitMcpPath, defaultMcpPath),
  metasploitMcpPython: fromStringSources(process.env.METASPLOIT_MCP_PY, fileConfig.metasploitMcpPython),
  metasploitMcpHost: fromStringSources(process.env.METASPLOIT_MCP_HOST, fileConfig.metasploitMcpHost),
  metasploitMcpPort: fromNumberSources(process.env.METASPLOIT_MCP_PORT, fileConfig.metasploitMcpPort),
  metasploitMcpTransport: (process.env.METASPLOIT_MCP_TRANSPORT as 'http' | 'stdio' | undefined) ?? fileConfig.metasploitMcpTransport,
  metasploitMcpExtraArgs: fromArraySources(process.env.METASPLOIT_MCP_EXTRA_ARGS, fileConfig.metasploitMcpExtraArgs),
  payloadSaveDir: fromStringSources(process.env.PAYLOAD_SAVE_DIR, fileConfig.payloadSaveDir, defaultPayloadDir),
  ollmcpCommand: fromStringSources(process.env.OLLMCP_COMMAND, fileConfig.ollmcpCommand),
  ollamaApiUrl: fromStringSources(process.env.OLLAMA_API_URL, fileConfig.ollamaApiUrl),
  ollmcpModel: fromStringSources(process.env.OLLMCP_MODEL, fileConfig.ollmcpModel),
  autoStartMetasploitMcp: fromBooleanSources(process.env.METASPLOIT_MCP_AUTO_START, fileConfig.autoStartMetasploitMcp, true),
  autoStartOllmcp: fromBooleanSources(process.env.OLLMCP_AUTO_START, fileConfig.autoStartOllmcp, false),
  extraOllmcpArgs: fromArraySources(process.env.OLLMCP_EXTRA_ARGS, fileConfig.extraOllmcpArgs),
  ollamaServeCommand: fromStringSources(process.env.OLLAMA_SERVE_COMMAND, fileConfig.ollamaServeCommand),
  ollamaServeArgs: fromArraySources(process.env.OLLAMA_SERVE_ARGS, fileConfig.ollamaServeArgs),
  autoStartOllama: fromBooleanSources(process.env.OLLAMA_AUTO_START, fileConfig.autoStartOllama, false),
};

export type AppConfig = z.infer<typeof ConfigSchema>;

export const config: AppConfig = ConfigSchema.parse(raw);
