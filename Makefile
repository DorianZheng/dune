SHELL := /bin/bash
PNPM := corepack pnpm
CLEAN_DIRS := .release packages/backend/dist packages/frontend/dist packages/shared/dist packages/frontend/.vite packages/frontend/playwright-report packages/frontend/test-results test-results coverage
CLEAN_FILES := packages/backend/.port

.PHONY: help deploy install env build test check run clean

help: ## Show available commands
	@printf "Available targets:\n"
	@printf "  make deploy  Install dependencies, create .env if missing, and build\n"
	@printf "  make test    Run the backend test suite\n"
	@printf "  make check   Run the pre-PR validation gate (build + test)\n"
	@printf "  make run     Start the app with the built production assets\n"
	@printf "  make clean   Remove build and dev artifacts (keeps data/)\n"
	@printf "  make help    Show this help message\n"

deploy: install env build ## Bootstrap a fresh local clone

install: ## Install project dependencies
	@corepack enable >/dev/null 2>&1 || true
	@$(PNPM) install --frozen-lockfile

env: ## Create .env from .env.example if missing
	@if [ ! -f .env ]; then cp .env.example .env; fi

build: ## Build all packages
	@$(PNPM) build

test: ## Run the backend test suite
	@$(PNPM) test

check: ## Run the required pre-PR validation gate
	@$(PNPM) check

run: ## Run the built app
	@$(PNPM) start

clean: ## Remove build and dev artifacts but keep runtime data
	@node -e "const fs=require('fs'); for (const path of '$(CLEAN_DIRS)'.split(' ')) fs.rmSync(path,{recursive:true,force:true}); for (const path of '$(CLEAN_FILES)'.split(' ')) fs.rmSync(path,{force:true});"
	@find . \( -path './.git' -o -path './node_modules' -o -path './data' -o -path './.claude' -o -path './.codex' \) -prune -o -type f \( -name '.DS_Store' -o -name '*.log' \) -delete
