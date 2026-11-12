/** Zombie content; the deck compositor supplies the shared capacity and identity context. */
export function hordeDivisions(modTag: string) {
  return ['NATO', 'PACT'].map((coalition, index) => ({
    code: index === 0 ? 'ZOMBIE_HORDE_BLUE' : 'ZOMBIE_HORDE_RED',
    name: `${modTag} Zombie Horde`,
    divisionName: '{name}',
    deckName: '{name}',
    description: 'An undead horde that overwhelms its enemies through relentless numbers.',
    countryId: modTag,
    coalition,
    skipIfEmpty: true,
    tags: ['ZOMBIES', 'HORDE'],
    modes: ['Unlimited'],
    emblemTexture: `Texture${modTag}_Division_HORDE`,
    unitPatterns: ['^Descriptor_Unit_YZ_'],
  }));
}
