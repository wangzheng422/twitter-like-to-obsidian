VERSION := $(shell node -p "require('./manifest.json').version")
PACKAGE := dist/twitter-likes-to-obsidian-v$(VERSION).zip
TAG ?= v$(VERSION)

.PHONY: help validate package release clean

help:
	@echo "Targets:"
	@echo "  make validate           Check extension JavaScript syntax"
	@echo "  make package            Build Chrome Store/GitHub release zip"
	@echo "  make release TAG=$(TAG) Create GitHub release and upload package"
	@echo "  make clean              Remove packaged artifacts"

validate:
	@node --check background.js
	@node --check content.js
	@node --check popup.js
	@node --check lib/article.js
	@node --check lib/dedup.js
	@node --check lib/extractor.js
	@node --check lib/markdown.js
	@node --check lib/obsidian-api.js
	@node --check lib/queue.js
	@node --check lib/tweet-detail.js
	@node --check lib/video.js
	@node --check scripts/package-extension.js

package: validate
	@node scripts/package-extension.js

release: package
	@command -v gh >/dev/null || { echo "GitHub CLI is required: https://cli.github.com/"; exit 1; }
	@gh release create "$(TAG)" "$(PACKAGE)" --title "$(TAG)" --notes "Release $(TAG)"

clean:
	@rm -rf dist
