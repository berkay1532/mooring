#![no_std]

use soroban_sdk::{contract, contractimpl, Env};

#[cfg(test)]
mod test;

#[contract]
pub struct Card;

#[contractimpl]
impl Card {
    /// Temporary smoke entrypoint; replaced in Task 2.
    pub fn version(_env: Env) -> u32 {
        1
    }
}
