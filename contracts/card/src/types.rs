use soroban_sdk::{contracterror, contracttype, Address, BytesN};

/// Lifecycle state of a card.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum State {
    Active = 0,
    Frozen = 1,
    Cancelled = 2,
}

/// Immutable spending policy set at creation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Policy {
    /// Max total spend per period, in token base units.
    pub period_amount: i128,
    /// Period length in seconds.
    pub period_duration: u64,
    /// Max amount for a single payment, in token base units.
    pub max_per_tx: i128,
    /// Unix timestamp after which no payment is authorized.
    pub expiry: u64,
}

/// Mutable accounting for the current period.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Period {
    pub start: u64,
    pub spent: i128,
}

/// One ed25519 signature as encoded by stellar-sdk `authorizeEntry`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Sig {
    pub public_key: BytesN<32>,
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Owner,
    Signer,
    Token,
    Policy,
    Period,
    State,
    AllowCount,
    Allowed(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum CardError {
    BadSignature = 1,
    WrongContext = 2,
    Frozen = 3,
    Cancelled = 4,
    Expired = 5,
    NotAllowlisted = 6,
    OverPerTxCap = 7,
    OverBudget = 8,
    InvalidAmount = 9,
    AllowlistFull = 10,
    InvalidPolicy = 11,
    InvalidState = 12,
}
