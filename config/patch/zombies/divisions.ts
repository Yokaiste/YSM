/** Zombie content; the deck compositor supplies the shared capacity and identity context. */
export function hordeDivisions(modTag: string) {
  return ['NATO', 'PACT'].map((coalition, index) => ({
    code: index === 0 ? 'ZOMBIE_HORDE_BLUE' : 'ZOMBIE_HORDE_RED',
    name: `${modTag} Zombie Horde`,
    divisionName: '{name}',
    deckName: '{name}',
    description:
      'Overrun the front with an undead army. Keep the pressure on and close the distance.',
    countryId: modTag,
    coalition,
    skipIfEmpty: true,
    tags: ['ZOMBIES', 'HORDE'],
    modes: ['Unlimited'],
    emblemTexture: `Texture${modTag}_Division_HORDE`,
    unitPatterns: ['^Descriptor_Unit_YZ_'],
  }));
}
