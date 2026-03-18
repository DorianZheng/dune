SHELL := /bin/bash
PNPM := corepack pnpm
CLEAN_DIRS := .release packages/backend/dist packages/frontend/dist packages/shared/dist packages/electron/dist packages/frontend/.vite packages/frontend/playwright-report packages/frontend/test-results test-results coverage
CLEAN_FILES := packages/backend/.port

.PHONY: help deploy install env build test check clean dev package package-mac package-linux package-win resolve-deps

help: ## Show available commands
	@printf "Available targets:\n"
	@printf "  make deploy         Install dependencies, create .env if missing, and build\n"
	@printf "  make build          Build all packages\n"
	@printf "  make test           Run the backend test suite\n"
	@printf "  make check          Pre-PR validation gate (build + test)\n"
	@printf "  make dev            Start dev servers with hot reload + Electron\n"
	@printf "  make package        Build installable app for the current platform\n"
	@printf "  make package-mac    Build .dmg for macOS\n"
	@printf "  make package-linux  Build .AppImage/.deb for Linux\n"
	@printf "  make package-win    Build .exe installer for Windows\n"
	@printf "  make clean          Remove build and dev artifacts (keeps data/)\n"
	@printf "  make help           Show this help message\n"

deploy: ## Bootstrap a fresh local clone
	@$(MAKE) install
	@$(MAKE) env
	@$(MAKE) build

install: ## Install project dependencies
	@corepack enable >/dev/null 2>&1 || true
	@$(PNPM) install --frozen-lockfile

env: ## Create .env from .env.example if missing
	@if [ ! -f .env ]; then cp .env.example .env; fi

build: ## Build all packages
	@$(PNPM) --filter @dune/shared build
	@$(PNPM) --filter @dune/backend build
	@$(PNPM) --filter @dune/frontend build
	@$(PNPM) --filter @dune/electron build

test: ## Run the backend test suite
	@$(PNPM) --filter @dune/backend test

check: ## Run the required pre-PR validation gate
	@$(MAKE) build
	@$(MAKE) test

dev: env ## Start dev servers with hot reload + Electron
	@node scripts/dev.mjs

resolve-deps:
	@node packages/electron/scripts/resolve-backend-deps.mjs packages/backend .release/_backend_deps

package: build resolve-deps ## Build installable app for the current platform
	@$(PNPM) --dir packages/electron dist

package-mac: build resolve-deps ## Build .dmg for macOS (current arch)
	@$(PNPM) --dir packages/electron dist:mac -- --$(shell uname -m | sed 's/x86_64/x64/')

package-linux: build resolve-deps ## Build .AppImage/.deb for Linux
	@$(PNPM) --dir packages/electron dist:linux

package-win: build resolve-deps ## Build .exe installer for Windows
	@$(PNPM) --dir packages/electron dist:win

clean: ## Remove build and dev artifacts but keep runtime data
	@node -e "const fs=require('fs'); for (const path of '$(CLEAN_DIRS)'.split(' ')) fs.rmSync(path,{recursive:true,force:true}); for (const path of '$(CLEAN_FILES)'.split(' ')) fs.rmSync(path,{force:true});"
	@find . \( -path './.git' -o -path './node_modules' -o -path './data' -o -path './.claude' -o -path './.codex' \) -prune -o -type f \( -name '.DS_Store' -o -name '*.log' \) -delete
