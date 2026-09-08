.PHONY: build test fmt lint clean

build:
	cargo build -p mooring-card --target wasm32v1-none --release
	cargo build -p mooring-factory --target wasm32v1-none --release || true

test: build
	cargo test --workspace

fmt:
	cargo fmt --all

lint:
	cargo fmt --all -- --check
	cargo clippy --workspace --all-targets -- -D warnings

clean:
	cargo clean
