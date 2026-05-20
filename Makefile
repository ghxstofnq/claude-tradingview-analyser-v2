# Build targets for the project.
#
# tv-dash is a Go (bubbletea) binary providing the live oversight TUI.
# It's a separate codebase from the Node CLI under cli/ — the Node side
# (`./bin/tv dash`) shells out to the compiled Go binary.
#
# One-time setup: `brew install go` (or any Go 1.22+).

GO ?= go
DASH_SRC := cmd/tv-dash
DASH_BIN := bin/tv-dash

.PHONY: dash dash-clean help

help:
	@echo "Targets:"
	@echo "  make dash        — compile bin/tv-dash from cmd/tv-dash/"
	@echo "  make dash-clean  — remove bin/tv-dash"

dash: $(DASH_BIN)

$(DASH_BIN): $(DASH_SRC)/main.go $(DASH_SRC)/go.mod
	@echo "→ compiling tv-dash (Go + bubbletea)"
	cd $(DASH_SRC) && $(GO) mod tidy
	cd $(DASH_SRC) && $(GO) build -o ../../$(DASH_BIN) .
	@echo "✓ built $(DASH_BIN)"
	@echo "Run: ./bin/tv dash"

dash-clean:
	rm -f $(DASH_BIN)
