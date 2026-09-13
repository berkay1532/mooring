.PHONY: build test fmt lint clean bindings

build:
	cargo build -p mooring-card --target wasm32v1-none --release
	# mooring-factory enables soroban-sdk's experimental_spec_shaking_v2
	# feature (see contracts/factory/Cargo.toml) so its exported spec
	# includes the imported card::Policy type -- required for the stellar
	# CLI to interact with it at all. That feature requires building via
	# `stellar contract build` rather than plain `cargo build`.
	stellar contract build --package mooring-factory

test: build
	cargo test --workspace

fmt:
	cargo fmt --all

lint:
	cargo fmt --all -- --check
	cargo clippy --workspace --all-targets -- -D warnings

clean:
	cargo clean

bindings: build
	packages/contracts-ts/scripts/generate.sh
