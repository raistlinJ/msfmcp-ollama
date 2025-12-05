.DEFAULT_GOAL := help

NPM ?= npm
NODE ?= node
UV ?= uv

MSFMCP_PATH ?= $(or $(METASPLOIT_MCP_PATH),$(shell $(NODE) scripts/read-config-value.cjs metasploitMcpPath))
MSFMCP_HOST ?= $(or $(METASPLOIT_MCP_HOST),$(shell $(NODE) scripts/read-config-value.cjs metasploitMcpHost),127.0.0.1)
MSFMCP_PORT ?= $(or $(METASPLOIT_MCP_PORT),$(shell $(NODE) scripts/read-config-value.cjs metasploitMcpPort),8085)
METASPLOIT_MCP_TRANSPORT ?= $(or $(METASPLOIT_MCP_TRANSPORT),$(shell $(NODE) scripts/read-config-value.cjs metasploitMcpTransport),http)
HTTP_ARGS := $(if $(filter http,$(METASPLOIT_MCP_TRANSPORT)),--host $(MSFMCP_HOST) --port $(MSFMCP_PORT),)

.PHONY: help install build dev bridge start python-install python-serve clean

help:
	@echo "Available targets:"
	@echo "  install           Install Node dependencies"
	@echo "  build             Compile TypeScript (npm run build)"
	@echo "  dev               Start tsx watch mode"
	@echo "  bridge            Run the supervisor via tsx"
	@echo "  start             Run the compiled dist build"
	@echo "  python-install    Use uv to install Metasploit MCP Python deps"
	@echo "  python-serve      Run MetasploitMCP.py via uv"
	@echo "  clean             Remove node_modules and dist"

install:
	$(NPM) install

build:
	$(NPM) run build

dev:
	$(NPM) run dev

bridge:
	$(NPM) run bridge

start:
	$(NPM) start

python-install:
	@test -n "$(MSFMCP_PATH)" || (echo "Set METASPLOIT_MCP_PATH or update config/bridge.config.json" && exit 1)
	cd "$(MSFMCP_PATH)" && $(UV) sync

python-serve:
	@test -n "$(MSFMCP_PATH)" || (echo "Set METASPLOIT_MCP_PATH or update config/bridge.config.json" && exit 1)
	cd "$(MSFMCP_PATH)" && $(UV) run MetasploitMCP.py --transport $(METASPLOIT_MCP_TRANSPORT) $(HTTP_ARGS)

clean:
	rm -rf node_modules dist
