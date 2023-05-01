// Copyright (C) 2021-2022 Prosopo (UK) Ltd.
// This file is part of provider <https://github.com/prosopo-io/provider>.
//
// provider is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// provider is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with provider.  If not, see <http://www.gnu.org/licenses/>.
#![cfg_attr(not(feature = "std"), no_std)]

use ink;

#[ink::contract]
pub mod dapp {
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;

    #[ink(storage)]
    pub struct Dapp {
        /// Total token supply.
        total_supply: Balance,
        /// Mapping from owner to number of owned token.
        balances: Mapping<AccountId, Balance>,
        /// Amount of tokens to drip feed via the faucet function
        faucet_amount: Balance,
        /// Token holder who initially receives all tokens
        token_holder: AccountId,
        /// Record of transfers
        transfers: Vec<Transfer>,
    }

    /// Event emitted when a token transfer occurs.
    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub struct Transfer {
        from: AccountId,
        to: AccountId,
        value: Balance,
    }

    /// Error types.
    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum Error {
        /// Returned if not enough balance to fulfill a request is available.
        InsufficientBalance,
        /// Returned if the user has not completed a captcha
        UserNotHuman,
        /// Returned if the transfer event is not recorded
        RecordTransferFailed,
    }

    impl Dapp {
        /// Creates a new contract with the specified initial supply and loads an instance of the
        /// `prosopo` contract
        #[ink(constructor, payable)]
        pub fn new(initial_supply: Balance, faucet_amount: Balance) -> Self {
            let caller = Self::env().caller();
            let mut balances = Mapping::new();
            balances.insert(&caller, &initial_supply);
            let transfers = Vec::new();
            Self {
                total_supply: initial_supply,
                balances,
                faucet_amount,
                token_holder: caller,
                transfers,
            }
        }

        /// Faucet function for sending tokens to humans
        #[ink(message)]
        pub fn faucet(&mut self, accountid: AccountId) -> Result<(), Error> {
            let token_holder = self.token_holder;
            self.transfer_from_to(&token_holder, &accountid, self.faucet_amount)?;
            self.record_transfer(token_holder, accountid, self.faucet_amount);

            Ok(())
        }

        /// Faucet function for sending tokens to humans that includes a call to another function
        #[ink(message)]
        pub fn faucet_with_store(&mut self, accountid: AccountId) -> Result<(), Error> {
            let token_holder = self.token_holder;
            self.transfer_from_to(&token_holder, &accountid, self.faucet_amount)?;
            // record transfer or return error
            self.transfers
                .push(Transfer{from: token_holder, to: accountid, value: self.faucet_amount});
            ink::env::debug_println!("From {:?} To {:?} Timestamp {:?}", &token_holder, &accountid, self.env().block_timestamp());
            Ok(())
        }

        /// Sub call
        #[ink(message)]
        pub fn record_transfer(
            &mut self,
            from: AccountId,
            to: AccountId,
            value: Balance,
        ) -> Result<(), Error> {
            self.transfers.push(Transfer{from, to, value});
            ink::env::debug_println!("From {:?} To {:?} Timestamp {:?}", from, to, self.env().block_timestamp());
            Ok(())
        }

        /// Transfers `value` amount of tokens from the caller's account to account `to`.
        ///
        /// On success a `Transfer` event is emitted.
        ///
        /// # Errors
        ///
        /// Returns `InsufficientBalance` error if there are not enough tokens on
        /// the caller's account balance.
        #[ink(message)]
        pub fn transfer(&mut self, to: AccountId, value: Balance) -> Result<(), Error> {
            let from = self.env().caller();
            self.transfer_from_to(&from, &to, value)
        }

        /// Transfers `value` amount of tokens from the caller's account to account `to`.
        ///
        /// On success a `Transfer` event is emitted.
        ///
        /// # Errors
        ///
        /// Returns `InsufficientBalance` error if there are not enough tokens on
        /// the caller's account balance.
        fn transfer_from_to(
            &mut self,
            from: &AccountId,
            to: &AccountId,
            value: Balance,
        ) -> Result<(), Error> {
            let from_balance = self.balance_of_impl(from);
            if from_balance < value {
                return Err(Error::InsufficientBalance);
            }

            self.balances.insert(from, &(from_balance - value));
            let to_balance = self.balance_of_impl(to);
            self.balances.insert(to, &(to_balance + value));
            Ok(())
        }

        /// Returns the account balance for the specified `owner`.
        ///
        /// Returns `0` if the account is non-existent.
        #[ink(message)]
        pub fn balance_of(&self, owner: AccountId) -> Balance {
            self.balance_of_impl(&owner)
        }

        /// Returns the account balance for the specified `owner`.
        ///
        /// Returns `0` if the account is non-existent.
        ///
        /// # Note
        ///
        /// Prefer to call this method over `balance_of` since this
        /// works using references which are more efficient in Wasm.
        #[inline]
        fn balance_of_impl(&self, owner: &AccountId) -> Balance {
            self.balances.get(owner).unwrap_or_default()
        }

        /// Terminates the contract and transfers the remaining balance to the recipient.
        #[ink(message)]
        pub fn terminate(&self, recipient: AccountId) {
            ink::env::terminate_contract::<ink::env::DefaultEnvironment>(recipient);
        }
    }
}
