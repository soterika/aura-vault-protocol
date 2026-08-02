# syntax=docker/dockerfile:1

FROM rust:1.91-slim AS builder

WORKDIR /app

RUN rustup target add wasm32v1-none

COPY aura-vault/Cargo.toml aura-vault/Cargo.toml

RUN mkdir -p aura-vault/src \
    && echo "fn main(){}" > aura-vault/src/lib.rs

RUN cargo build \
    --manifest-path aura-vault/Cargo.toml \
    --target wasm32v1-none \
    --release || true

COPY aura-vault/src aura-vault/src

RUN cargo build \
    --manifest-path aura-vault/Cargo.toml \
    --target wasm32v1-none \
    --release


FROM scratch AS wasm-artifact

COPY --from=builder \
/app/aura-vault/target/wasm32v1-none/release/aura_vault.wasm \
/aura_vault.wasm