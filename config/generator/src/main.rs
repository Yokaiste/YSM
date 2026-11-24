mod compatibility;
mod decks;
mod entities;
mod localisation;
mod sandbox;
mod ui;
mod zombies;

use ymb_sdk::{GeneratorEntry, TestEntry};

fn main() {
    ymb_sdk::run(
        &[
            GeneratorEntry {
                name: "specialties",
                generate: compatibility::specialties,
            },
            GeneratorEntry {
                name: "decks",
                generate: decks::generate,
            },
            GeneratorEntry {
                name: "welcome_screen",
                generate: ui::welcome::generate,
            },
            GeneratorEntry {
                name: "dark_theme",
                generate: ui::dark_theme::generate,
            },
            GeneratorEntry {
                name: "localisation",
                generate: localisation::seed,
            },
            GeneratorEntry {
                name: "match_constants",
                generate: localisation::match_constants,
            },
            GeneratorEntry {
                name: "cheat_units",
                generate: sandbox::cheat_units,
            },
            GeneratorEntry {
                name: "supply_units",
                generate: sandbox::supply_units,
            },
            GeneratorEntry {
                name: "supply_buildings",
                generate: sandbox::supply_buildings,
            },
            GeneratorEntry {
                name: "nuclear_planes",
                generate: sandbox::nuclear_planes,
            },
            GeneratorEntry {
                name: "zombie_units",
                generate: zombies::units,
            },
            GeneratorEntry {
                name: "zombie_ammunition",
                generate: zombies::ammunition,
            },
        ],
        &[
            TestEntry {
                name: "deck_config",
                run: decks::config::checks,
            },
            TestEntry {
                name: "roster_policy",
                run: decks::checks::roster,
            },
            TestEntry {
                name: "scoring",
                run: decks::checks::scoring,
            },
            TestEntry {
                name: "decks",
                run: decks::checks::decks,
            },
            TestEntry {
                name: "deck_render",
                run: decks::checks::render,
            },
            TestEntry {
                name: "identity_stores",
                run: decks::store::checks,
            },
            TestEntry {
                name: "welcome_screen",
                run: ui::welcome::checks,
            },
            TestEntry {
                name: "qr",
                run: ui::qr::qr_checks,
            },
            TestEntry {
                name: "png",
                run: ui::qr::png_checks,
            },
            TestEntry {
                name: "dark_theme",
                run: ui::dark_theme::checks,
            },
            TestEntry {
                name: "localisation",
                run: localisation::checks,
            },
            TestEntry {
                name: "entity_modules",
                run: entities::checks,
            },
            TestEntry {
                name: "zombie_units",
                run: zombies::unit_checks,
            },
            TestEntry {
                name: "zombie_ammunition",
                run: zombies::ammunition_checks,
            },
        ],
    );
}
