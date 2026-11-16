# ── Stage 1: Build WASM contract ──────────────────────────────────
FROM rust:1.79-slim AS builder
RUN rustup target add wasm32-unknown-unknown
WORKDIR /contract
COPY . .
RUN cargo build --release --target wasm32-unknown-unknown

# ── Stage 2: Minimal output ──────────────────────────────────────
FROM alpine:3.20 AS runtime
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app

COPY --from=builder /contract/target/wasm32-unknown-unknown/release/*.wasm ./

USER appuser

HEALTHCHECK --interval=60s --timeout=5s --retries=2 \
  CMD test -f /app/*.wasm || exit 1

CMD ["echo", "Contract WASM built successfully. Use 'docker cp' to extract the artifact."]
