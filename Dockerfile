FROM node:22-bookworm

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps ./apps
COPY server ./server

RUN pnpm install --frozen-lockfile
# The workspace package names are "@Norie/server" and "@Norie/web"; pnpm filters
# are case-sensitive, so a lowercase filter matches nothing and the build fails.
RUN pnpm --filter @Norie/server build && pnpm --filter @Norie/web build

ENV NODE_ENV=production
ENV MUSIC_DIR=/music
ENV DATA_DIR=/data
ENV PORT=8787
ENV HOST=0.0.0.0

VOLUME ["/music", "/data"]
EXPOSE 8787

CMD ["pnpm", "--filter", "@Norie/server", "start"]
