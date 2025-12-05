#!/usr/bin/env python3
"""Minimal interactive MCP + Ollama client for the Metasploit bridge."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import textwrap
from dataclasses import dataclass
from typing import Any, Awaitable, Callable
from urllib.parse import urlsplit, urlunsplit

import httpx
import mcp.types as types
from mcp import ClientSession
from mcp.client.sse import sse_client

JSONDict = dict[str, Any]
SessionFn = Callable[[ClientSession], Awaitable[Any]]


@dataclass(slots=True)
class ClientConfig:
    mcp_url: str
    health_url: str
    ollama_url: str
    ollama_model: str
    mcp_timeout: float
    mcp_sse_timeout: float
    ollama_timeout: float


class OllamaClient:
    """Thin wrapper around the Ollama chat HTTP API."""

    def __init__(self, base_url: str, model: str, timeout: float) -> None:
        self._chat_endpoint = base_url.rstrip("/") + "/api/chat"
        self._model = model
        self._timeout = timeout

    async def chat(self, prompt: str, *, system: str | None = None) -> str:
        payload: JSONDict = {
            "model": self._model,
            "messages": [],
            "stream": False,
        }
        if system:
            payload["messages"].append({"role": "system", "content": system})
        payload["messages"].append({"role": "user", "content": prompt})

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(self._chat_endpoint, json=payload)
            response.raise_for_status()
            data = response.json()
            message = data.get("message", {}).get("content")
            if not message:
                return json.dumps(data, indent=2)
            return message.strip()


def env_default(name: str, fallback: str) -> str:
    value = os.environ.get(name)
    return value if value else fallback


def default_mcp_url() -> str:
    url = os.environ.get("METASPLOIT_MCP_URL")
    if url:
        return url
    host = env_default("METASPLOIT_MCP_HOST", "127.0.0.1")
    port = env_default("METASPLOIT_MCP_PORT", "8085")
    return f"http://{host}:{port}/sse"


def default_health_url(mcp_url: str) -> str:
    parsed = urlsplit(mcp_url)
    return urlunsplit((parsed.scheme, parsed.netloc, "/healthz", "", ""))


def default_ollama_url() -> str:
    return env_default("OLLAMA_API_URL", "http://127.0.0.1:11434")


def default_ollama_model() -> str:
    return env_default("OLLAMA_MODEL", env_default("OLLMCP_MODEL", "gpt-oss:20b"))


def parse_json_arguments(raw: str | None) -> JSONDict:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive parsing helper
        raise SystemExit(f"Unable to parse JSON arguments: {exc}") from exc


async def with_mcp_session(config: ClientConfig, handler: SessionFn) -> Any:
    async with sse_client(
        config.mcp_url,
        timeout=config.mcp_timeout,
        sse_read_timeout=config.mcp_sse_timeout,
    ) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            return await handler(session)


def format_tool_result(result: types.CallToolResult) -> str:
    lines: list[str] = [f"status: {'error' if result.isError else 'ok'}"]
    if result.structuredContent:
        lines.append("structured:")
        lines.append(textwrap.indent(json.dumps(result.structuredContent, indent=2), "  "))
    if result.meta:
        lines.append("meta:")
        lines.append(textwrap.indent(json.dumps(result.meta, indent=2), "  "))

    for block in result.content:
        block_payload = block.model_dump(exclude_none=True)
        lines.append(textwrap.indent(json.dumps(block_payload, indent=2), "  "))

    return "\n".join(lines)


async def list_tools_once(config: ClientConfig) -> None:
    async def _list(session: ClientSession) -> None:
        listing = await session.list_tools()
        print(f"Discovered {len(listing.tools)} tool(s) at {config.mcp_url}:")
        for tool in listing.tools:
            description = tool.description or "(no description)"
            print(f"- {tool.name}: {description}")

    await with_mcp_session(config, _list)


async def call_tool_once(config: ClientConfig, name: str, arguments: JSONDict) -> None:
    async def _call(session: ClientSession) -> None:
        result = await session.call_tool(name, arguments)
        print(format_tool_result(result))

    await with_mcp_session(config, _call)


async def chat_once(config: ClientConfig, prompt: str) -> None:
    client = OllamaClient(config.ollama_url, config.ollama_model, config.ollama_timeout)
    try:
        reply = await client.chat(prompt)
        print(reply)
    except httpx.HTTPError as exc:
        raise SystemExit(f"Failed to reach Ollama at {config.ollama_url}: {exc}") from exc


async def fetch_health(config: ClientConfig) -> JSONDict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(config.health_url)
        response.raise_for_status()
        return response.json()


async def interactive_shell(config: ClientConfig) -> None:
    client = OllamaClient(config.ollama_url, config.ollama_model, config.ollama_timeout)

    async def _loop(session: ClientSession) -> None:
        print("Connected to Metasploit MCP over SSE. Type 'help' for commands.")
        while True:
            try:
                entry = await asyncio.to_thread(input, "bridge> ")
            except (EOFError, KeyboardInterrupt):
                print()
                break

            command = entry.strip()
            if not command:
                continue
            verb, _, tail = command.partition(" ")
            verb = verb.lower()

            if verb in {"quit", "exit"}:
                break
            if verb == "help":
                print(
                    textwrap.dedent(
                        """
                        Commands:
                          tools                Refresh and list advertised tools
                          call <name> [json]   Invoke a tool with optional JSON args
                          chat <message>       Send a free-form prompt to Ollama
                          plan <goal>          Ask Ollama to draft a plan using known tools
                          status               Hit the Metasploit MCP /healthz endpoint
                          help                 Show this message
                          exit                 Close the client
                        """
                    ).strip()
                )
                continue
            if verb == "tools":
                listing = await session.list_tools()
                for tool in listing.tools:
                    description = tool.description or "(no description)"
                    print(f"- {tool.name}: {description}")
                continue
            if verb == "call":
                if not tail:
                    print("Usage: call <tool_name> {\"optional\": \"json\"}")
                    continue
                name, _, raw_args = tail.partition(" ")
                args = parse_json_arguments(raw_args.strip() or None)
                try:
                    result = await session.call_tool(name, args)
                    print(format_tool_result(result))
                except Exception as exc:  # broad tool guard for operator ergonomics
                    print(f"Tool call failed: {exc}")
                continue
            if verb == "chat":
                if not tail:
                    print("Usage: chat <message>")
                    continue
                try:
                    reply = await client.chat(tail)
                    print(reply)
                except httpx.HTTPError as exc:
                    print(f"Ollama request failed: {exc}")
                continue
            if verb == "plan":
                if not tail:
                    print("Usage: plan <goal description>")
                    continue
                tools = await session.list_tools()
                summary_lines = [f"- {t.name}: {t.description or ''}" for t in tools.tools]
                system_prompt = "You are helping an operator decide which Metasploit MCP tools to call."
                prompt = textwrap.dedent(
                    f"""
                    Available tools:\n{os.linesep.join(summary_lines) or '- none advertised'}\n\n"""
                )
                prompt += f"Goal: {tail}\nSuggest concrete steps and relevant tool names."
                try:
                    reply = await client.chat(prompt, system=system_prompt)
                    print(reply)
                except httpx.HTTPError as exc:
                    print(f"Ollama request failed: {exc}")
                continue
            if verb == "status":
                try:
                    health = await fetch_health(config)
                    print(json.dumps(health, indent=2))
                except httpx.HTTPError as exc:
                    print(f"Health check failed: {exc}")
                continue

            print(f"Unknown command: {verb}. Try 'help'.")

    await with_mcp_session(config, _loop)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Interact with the Metasploit MCP server and Ollama")
    parser.add_argument("--mcp-url", dest="mcp_url", default=None, help="Full SSE URL (default: env/config)")
    parser.add_argument("--ollama-url", dest="ollama_url", default=None, help="Ollama base URL")
    parser.add_argument("--ollama-model", dest="ollama_model", default=None, help="Ollama model name")
    parser.add_argument("--mcp-timeout", type=float, default=15.0, help="HTTP timeout for MCP POSTs")
    parser.add_argument("--mcp-sse-timeout", type=float, default=300.0, help="How long to wait for SSE events")
    parser.add_argument("--ollama-timeout", type=float, default=120.0, help="Timeout for Ollama responses")
    parser.add_argument("--health-url", dest="health_url", default=None, help="Override for /healthz endpoint")

    subparsers = parser.add_subparsers(dest="command")
    parser.set_defaults(command="interactive")

    subparsers.add_parser("interactive", help="Start an interactive REPL (default)")

    subparsers.add_parser("list-tools", help="List available Metasploit MCP tools")

    call_parser = subparsers.add_parser("call-tool", help="Invoke a specific tool once and exit")
    call_parser.add_argument("name", help="Tool name to call")
    call_parser.add_argument("arguments", nargs="?", help="JSON object with tool arguments")

    chat_parser = subparsers.add_parser("chat", help="Send a prompt to Ollama and exit")
    chat_parser.add_argument("message", nargs="+", help="Prompt to forward to Ollama")

    return parser


def build_config(args: argparse.Namespace) -> ClientConfig:
    mcp_url = args.mcp_url or default_mcp_url()
    health_url = args.health_url or default_health_url(mcp_url)
    ollama_url = args.ollama_url or default_ollama_url()
    ollama_model = args.ollama_model or default_ollama_model()
    return ClientConfig(
        mcp_url=mcp_url,
        health_url=health_url,
        ollama_url=ollama_url,
        ollama_model=ollama_model,
        mcp_timeout=args.mcp_timeout,
        mcp_sse_timeout=args.mcp_sse_timeout,
        ollama_timeout=args.ollama_timeout,
    )


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    config = build_config(args)

    try:
        if args.command == "interactive":
            asyncio.run(interactive_shell(config))
        elif args.command == "list-tools":
            asyncio.run(list_tools_once(config))
        elif args.command == "call-tool":
            arguments = parse_json_arguments(getattr(args, "arguments", None))
            asyncio.run(call_tool_once(config, args.name, arguments))
        elif args.command == "chat":
            message = " ".join(args.message)
            asyncio.run(chat_once(config, message))
        else:  # pragma: no cover - argparse already constrains choices
            parser.error(f"Unknown command: {args.command}")
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(1)


if __name__ == "__main__":
    main()
