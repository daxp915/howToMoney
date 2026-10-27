# syntax=docker/dockerfile:1
# bookworm-slim rather than alpine: @node-rs/argon2 ships prebuilt glibc
# binaries, and musl builds are a recurring source of install failures.
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
# RELEASE (the deploy writes the git sha into it; there is no git on the NAS)
# names the Sentry release. The Sentry token that uploads source maps is a
# BuildKit secret (docker-compose.prod.yml), never an ARG: BuildKit prints a
# RUN line with its ARGs filled in, which put the token in the build log once.
# Absent (laptop, CI), the build simply uploads nothing.
RUN test -s RELEASE || echo dev > RELEASE
RUN --mount=type=secret,id=sentry_auth_token     SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null)" npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/RELEASE ./RELEASE

USER node
EXPOSE 3000

# The worker container overrides this with `npm run worker`.
CMD ["node", "build/index.js"]
