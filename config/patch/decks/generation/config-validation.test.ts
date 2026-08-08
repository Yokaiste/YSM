import { type BuildScriptTestContext, type ScriptTestReport, ScriptToolError } from 'ymb/api';
import { buildDivisionContexts } from '../../shared/deck-generation/contexts.ts';
import { createDeckGenerationConfig } from '../../shared/deck-generation/generator/config.ts';

const BASE_CONFIG = {
  deckSlotCount: 80,
  unlimitedPackUnitCount: 999,
};

export default function test(context: BuildScriptTestContext): ScriptTestReport {
  const malformedCases: Array<{ label: string; config: Record<string, unknown> }> = [
    {
      label: 'non-array customDivisions',
      config: { ...BASE_CONFIG, customDivisions: { code: 'BROKEN' } },
    },
    {
      label: 'custom division missing its required code',
      config: {
        ...BASE_CONFIG,
        customDivisions: [{ name: 'Broken', unitPatterns: ['^Descriptor_Unit_'] }],
      },
    },
    {
      label: 'typoed division mode',
      config: {
        ...BASE_CONFIG,
        customDivisions: [
          {
            code: 'BROKEN',
            name: 'Broken',
            unitPatterns: ['^Descriptor_Unit_'],
            modes: ['Unlimted'],
          },
        ],
      },
    },
    {
      label: 'unknown top-level field',
      config: { ...BASE_CONFIG, contextGeneraton: {} },
    },
    {
      label: 'unknown policy field',
      config: {
        ...BASE_CONFIG,
        divisionPolicies: { countryBalanced: { includeModUnts: true } },
      },
    },
  ];
  const validationFailures: string[] = [];
  for (const malformed of malformedCases) {
    try {
      createDeckGenerationConfig(malformed.config, 'YSM', context.tools.values);
      validationFailures.push(`${malformed.label} was silently accepted.`);
    } catch (error) {
      if (!(error instanceof ScriptToolError)) {
        validationFailures.push(
          `${malformed.label} raised an unstructured error: ${error instanceof Error ? error.message : String(error)}.`,
        );
      }
    }
  }

  const explicitEmpty = createDeckGenerationConfig(
    {
      ...BASE_CONFIG,
      deckPreferredCountryIdsByCoalition: { NATO: [], ['__proto__']: ['MOD'] },
      customDivisions: [
        {
          code: 'VALID',
          name: 'Valid',
          unitPatterns: ['^Descriptor_Unit_'],
          modes: ['unlimited', 'BALANCED', 'Unlimited'],
        },
      ],
    },
    'YSM',
    context.tools.values,
  );
  const behaviorFailures = [
    explicitEmpty.deckPreferredCountryIdsByCoalition.NATO?.length === 0
      ? undefined
      : 'An explicit empty NATO preference list was replaced by the default country.',
    explicitEmpty.customDivisions[0]?.modes.join(',') === 'Unlimited,Balanced'
      ? undefined
      : 'Valid case-insensitive modes were not normalized and deduplicated.',
    Object.hasOwn(explicitEmpty.deckPreferredCountryIdsByCoalition, '__proto__') &&
    Reflect.get(explicitEmpty.deckPreferredCountryIdsByCoalition, '__proto__')?.[0] === 'MOD'
      ? undefined
      : 'A prototype-shaped coalition preference was discarded instead of remaining config data.',
  ].filter((failure): failure is string => failure !== undefined);

  const duplicateContextConfig = createDeckGenerationConfig(
    {
      ...BASE_CONFIG,
      contextGeneration: { countries: false, coalitions: false, allSides: false },
      customDivisions: [
        { code: 'DUPLICATE-CODE', name: 'First', unitPatterns: ['First'] },
        { code: 'DUPLICATE_CODE', name: 'Second', unitPatterns: ['Second'] },
      ],
    },
    'YSM',
    context.tools.values,
  );
  let duplicateContextRejected = false;
  try {
    buildDivisionContexts([], 'YSM', duplicateContextConfig);
  } catch (error) {
    duplicateContextRejected = String(error).includes('both resolve to descriptor code');
  }

  return {
    results: [
      validationFailures.length === 0
        ? {
            name: 'deck-generation config rejects malformed shapes, fields, and modes',
            status: 'passed',
          }
        : {
            name: 'deck-generation config rejects malformed shapes, fields, and modes',
            status: 'failed',
            reason: 'Malformed deck-generation config was accepted or reported without guidance.',
            suggestion:
              'Validate authored config before applying defaults or generating divisions.',
            details: validationFailures,
          },
      behaviorFailures.length === 0
        ? {
            name: 'deck-generation config preserves explicit empty lists and normalizes modes',
            status: 'passed',
          }
        : {
            name: 'deck-generation config preserves explicit empty lists and normalizes modes',
            status: 'failed',
            reason: 'Valid edge-case config did not retain its authored meaning.',
            suggestion:
              'Apply defaults only when a field is absent, not when it is explicitly empty.',
            details: behaviorFailures,
          },
      duplicateContextRejected
        ? {
            name: 'deck-generation rejects colliding sanitized context codes',
            status: 'passed',
          }
        : {
            name: 'deck-generation rejects colliding sanitized context codes',
            status: 'failed',
            reason: 'Two authored contexts can generate the same descriptor names.',
            suggestion:
              'Reject context codes that collide after identifier sanitization before rendering NDF output.',
          },
    ],
  };
}
