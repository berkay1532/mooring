use soroban_sdk::String;

use crate::types::CardError;

/// Upper bound on the label length in bytes.
pub const MAX_LABEL_LEN: u32 = 32;

/// A label is 1..=32 bytes. Empty labels are rejected so a card is never nameless.
pub(crate) fn validate(label: &String) -> Result<(), CardError> {
    let len = label.len();
    if len == 0 || len > MAX_LABEL_LEN {
        return Err(CardError::InvalidLabel);
    }
    Ok(())
}
