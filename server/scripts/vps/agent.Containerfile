# SPEC-883 · ADR-0137 · image sesi agen untuk profil production (ADR-0117).
# Kredensial TIDAK pernah masuk image: sandboxArgv me-mount HANOMAN_AGENT_CREDENTIAL_DIR
# sebagai /agent-home:ro dan menyetel HOME=/agent-home.
FROM docker.io/library/node:22-bookworm-slim

# SPEC-909 · ADR-0146 · `curl` dipakai hook sesi untuk mengirim pertanyaan agen ke server.
# Tanpanya hook diam & `exit 0` — tak pernah memblokir agen, tapi juga tak pernah sampai.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates ripgrep curl && rm -rf /var/lib/apt/lists/*
RUN npm i -g @anthropic-ai/claude-code @openai/codex

WORKDIR /workspace
