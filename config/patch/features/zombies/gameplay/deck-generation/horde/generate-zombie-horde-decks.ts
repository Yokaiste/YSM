import type { BuildScript } from 'ymb/api';

// Core coordinates both generators so their shared WARNO sources are parsed once. Keeping this
// selected script boundary preserves the horde patch's independent identity and companion tests.
const verifyZombieHordeGeneration: BuildScript = async () => [];

export default verifyZombieHordeGeneration;
