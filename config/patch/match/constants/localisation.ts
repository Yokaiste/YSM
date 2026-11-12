import type { BuildScript } from 'ymb/api';
import { mergeFeatureLocalisation } from '../../shared/localisation.ts';

const localise: BuildScript = (context) => mergeFeatureLocalisation(context, 'INTERFACE_OUTGAME');
export default localise;
