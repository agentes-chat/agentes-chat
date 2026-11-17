# The MCP sandbox (ADR 0190, addendum): the stdio MCP programs a workspace connects run here, apart from the app,
# with Node (npx), Bun (bunx), Python (pip, venv, uvx) and build tools (make, gcc, git), as the unprivileged `node`.
FROM oven/bun:1.4.4 AS bun
FROM ghcr.io/astral-sh/uv:0.9.9 AS uv
FROM node:24.11.1-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl git python-is-python3 python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s bun /usr/local/bin/bunx
COPY --from=uv /uv /uvx /usr/local/bin/
COPY bridge.ts /opt/mcp-sandbox/bridge.ts

USER node
WORKDIR /home/node
ENV HOME=/home/node PORT=7070
EXPOSE 7070
CMD ["bun", "/opt/mcp-sandbox/bridge.ts"]
