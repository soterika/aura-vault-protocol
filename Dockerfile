# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────────────────────
FROM rust:1.78-slim AS builder

WORKDIR /app

# Install wasm target
RUN rustup target add wasm32-unknown-unknown

# Cache dependencies separately from source
COPY aura-vault/Cargo.toml aura-vault/Cargo.toml
RUN mkdir -p aura-vault/src && echo "fn main(){}" > aura-vault/src/lib.rs
RUN cargo build --manifest-path aura-vault/Cargo.toml --target wasm32-unknown-unknown --release || true

# Build real source
COPY aura-vault/src aura-vault/src
RUN cargo build --manifest-path aura-vault/Cargo.toml --target wasm32-unknown-unknown --release

# ── Artifact stage ────────────────────────────────────────────────────────────
FROM scratch AS wasm-artifact
COPY --from=builder /app/aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm /aura_vault.wasm
