mod analysis;
mod cards;
mod combat;
pub mod config;
mod contexts;
#[cfg(test)]
mod corpus;
mod data;
mod engine;
mod focus;
mod metrics;
mod parse;
mod premade;
mod render;
mod roles;
mod rules;
mod scoring;
mod selection;
mod serializer;
mod similarity;
pub mod store;
mod transport;
mod weapons;
pub use engine::generate;
pub mod checks;

mod cache;
