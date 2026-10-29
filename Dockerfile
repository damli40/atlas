# H1 (D52): the hosted Atlas image, built by Fly's remote builder (`fly deploy --remote-only`; no Docker needed locally).
#
# What is in it, in plain words:
# - Node v25.8.1 (the same Node as E4's Modal sandbox image and Dami's Mac), from nodejs.org, checked against its
#   published SHA-256 before it is unpacked.
# - pnpm 12.4.1, checked against the npm registry's published sha512 before it is installed.
# - The app: the server and runners (run by tsx), the built page (vite build -> dist/), and only the production
#   node_modules.
# - Foundry's anvil v1.8.6 (the Moonwell fork runner forks Base with it), checked against the release's SHA-256.
# - No Python: on this host every pasted run, TypeScript or Python, goes to a throwaway Modal sandbox
#   (ATLAS_EXECUTOR=modal). The server refuses to start on Linux with any other executor (server/hosting.ts).
# - No Muse Code: `muse exec` needs macOS sandbox-exec, so the fixer asks the muse-spark-1.3 chat instead.
# - The server runs as the non-root user "atlas". The entrypoint starts as root only to hand the volume's folder to
#   that user (a fresh Fly volume is owned by root), then drops to it for good (tools/fly-entrypoint.sh).
#
# Every base and download is pinned: the Debian image by digest, every file by checksum.

ARG DEBIAN_IMAGE=debian:trixie-20261020-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad

# ── stage 1: Node and pnpm ──────────────────────────────────────────────────────────────────────
FROM ${DEBIAN_IMAGE} AS node
ARG NODE_VERSION=v25.8.1
ARG NODE_SHA256=8c13c85f73b1f8e57d5fff0732b3f25880910aafa6d5c811073a2ec7fcd45b4c
ARG PNPM_VERSION=12.4.1
ARG PNPM_SHA512=LoHjmdc/6DkNqyXgaqeIq3pZCCSNL1o3D4K0gRR6ano2e/gEj5pv22Rg8hpm8FQt7bi5TKLIcjWWdBkgsWVtTA==
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils libatomic1 \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" \
 && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner \
 && rm /tmp/node.tar.xz \
 && node --version
RUN curl -fsSLo /tmp/pnpm.tgz "https://registry.npmjs.org/pnpm/-/pnpm-${PNPM_VERSION}.tgz" \
 && node -e "const h=require('crypto').createHash('sha512').update(require('fs').readFileSync('/tmp/pnpm.tgz')).digest('base64'); if (h !== process.argv[1]) { console.error('pnpm tarball checksum mismatch'); process.exit(1) }" "${PNPM_SHA512}" \
 && npm install -g /tmp/pnpm.tgz \
 && rm /tmp/pnpm.tgz \
 && pnpm --version

# ── stage 2: anvil ──────────────────────────────────────────────────────────────────────────────
FROM node AS anvil
ARG FOUNDRY_VERSION=v1.8.6
ARG FOUNDRY_SHA256=58850106984038f3a7200f38a4182c8cb423d3a4f4c7848eacbc2453e6bc35fc
RUN curl -fsSLo /tmp/foundry.tgz "https://github.com/foundry-rs/foundry/releases/download/${FOUNDRY_VERSION}/foundry_${FOUNDRY_VERSION}_linux_amd64.tar.gz" \
 && echo "${FOUNDRY_SHA256}  /tmp/foundry.tgz" | sha256sum -c - \
 && mkdir -p /out \
 && tar -xzf /tmp/foundry.tgz -C /out anvil \
 && /out/anvil --version

# ── stage 3: the built page ─────────────────────────────────────────────────────────────────────
FROM node AS page
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec vite build && test -f dist/index.html

# ── stage 4: production node_modules only ───────────────────────────────────────────────────────
FROM node AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ── stage 5: what runs ──────────────────────────────────────────────────────────────────────────
FROM ${DEBIAN_IMAGE}
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libatomic1 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 atlas \
 && useradd --system --uid 10001 --gid atlas --home-dir /home/atlas --create-home --shell /usr/sbin/nologin atlas
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=anvil /out/anvil /usr/local/bin/anvil
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=page /build/dist ./dist
RUN install -m 0755 tools/fly-entrypoint.sh /usr/local/bin/atlas-entrypoint \
 && install -m 0755 tools/atlas-invites.sh /usr/local/bin/atlas-invites \
 && chown -R root:root /app && chmod -R a+rX,go-w /app \
 && node --version && anvil --version \
 && test "$(setpriv --reuid=atlas --regid=atlas --init-groups --no-new-privs --inh-caps=-all --bounding-set=-all id -u)" = "10001"
ENV NODE_ENV=production \
    PORT=8080 \
    HOME=/home/atlas
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/atlas-entrypoint"]
CMD ["node", "--import", "tsx", "server/host.ts"]
