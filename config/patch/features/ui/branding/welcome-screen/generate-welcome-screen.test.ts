import generateWelcomeScreen from './generate-welcome-screen.ts';

const LOCALISATION_RELATIVE_PATH =
  'replace/GameData/Localisation/${modRootName}/INTERFACE_OUTGAME.csv';
const STALE_LINK_TOKEN = '"${modTag}L9";"Obsolete link"';
const STALE_ALERT_TOKEN = '"${modTag}ALT";"Obsolete alert"';
const ACTIVE_LINK_TOKEN = '"${modTag}L1"';
const ACTIVE_ALERT_TITLE_TOKEN = '"${modTag}ALT"';
const ACTIVE_ALERT_BODY_TOKEN = '"${modTag}ALB"';
const LINK_REVEAL_BLOCKER_PREFIX = 'MainMenuLinkRevealBlocker';
const ALERT_PANEL_BLOCKER_PREFIX = 'MainMenuAlertPanelBlocker';

function extractAlertHeight(content: string, modTag: string): number | undefined {
  const match = content.match(
    new RegExp(
      `ElementName = "MainMenuAlert${modTag}"[\\s\\S]*?MagnifiableWidthHeight = \\[860\\.0, ([0-9.]+)\\]`,
    ),
  );
  const height = Number(match?.[1]);
  return Number.isFinite(height) ? height : undefined;
}

function extractAlertPartOffset(content: string, elementName: string): number | undefined {
  const match = content.match(
    new RegExp(
      `ElementName = "${elementName}"[\\s\\S]*?MagnifiableOffset = \\[0\\.0, ([0-9.]+)\\]`,
    ),
  );
  const offset = Number(match?.[1]);
  return Number.isFinite(offset) ? offset : undefined;
}

export default async function test(context: Parameters<typeof generateWelcomeScreen>[0]) {
  const originalWelcomeContent = await context.readTarget(
    'GameData/UserInterface/Use/OutGame/UISpecificOutGameWelcomeView.ndf',
  );
  const originalLocalisationContent = await context.readModTextIfExists(LOCALISATION_RELATIVE_PATH);
  const seededLocalisationContent = `${originalLocalisationContent}${originalLocalisationContent.endsWith('\n') ? '' : '\n'}${STALE_LINK_TOKEN}\n${STALE_ALERT_TOKEN}\n`;
  const modTag = String(context.variables.modTag ?? 'MOD');
  const failures: string[] = [];
  const alertFailures: string[] = [];
  let output: Awaited<ReturnType<typeof generateWelcomeScreen>> | undefined;
  let repeatedOutput: Awaited<ReturnType<typeof generateWelcomeScreen>> | undefined;
  let alertOutput: Awaited<ReturnType<typeof generateWelcomeScreen>> | undefined;
  let alertLongOutput: Awaited<ReturnType<typeof generateWelcomeScreen>> | undefined;
  let localisationContent = originalLocalisationContent;
  let alertLocalisationContent = originalLocalisationContent;

  try {
    await context.writeModTextIfChanged(LOCALISATION_RELATIVE_PATH, seededLocalisationContent);
    output = await generateWelcomeScreen(context);
    const firstOutput = output;
    repeatedOutput = await generateWelcomeScreen({
      ...context,
      readTarget: async (targetPath) =>
        targetPath === firstOutput.targetRelativePath
          ? String(firstOutput.content)
          : context.readTarget(targetPath),
    });
    localisationContent = await context.readModTextIfExists(LOCALISATION_RELATIVE_PATH);
    alertOutput = await generateWelcomeScreen({
      ...context,
      variables: {
        ...context.variables,
        alert: {
          title: 'Closed Beta Notice',
          text: 'This build is experimental.\nExpect unfinished balance and UI.',
        },
      },
    });
    alertLongOutput = await generateWelcomeScreen({
      ...context,
      variables: {
        ...context.variables,
        alert: {
          title: 'Closed Beta Notice',
          text: 'This build is experimental and may change often.\nPlease report UI regressions, gameplay issues, and localisation problems.\nLonger text should produce a taller modal instead of forcing the same fixed window height.',
        },
      },
    });
    alertLocalisationContent = await context.readModTextIfExists(LOCALISATION_RELATIVE_PATH);
  } finally {
    await context.writeModTextIfChanged(LOCALISATION_RELATIVE_PATH, originalLocalisationContent);
  }

  if (!output) {
    throw new Error('Welcome-screen generator did not return an output during the companion test.');
  }

  if (
    output.targetRelativePath !==
    'GameData/UserInterface/Use/OutGame/UISpecificOutGameWelcomeView.ndf'
  ) {
    failures.push(`Unexpected output target: ${output.targetRelativePath}`);
  }
  if (
    typeof output.content !== 'string' ||
    !output.content.includes(`MainMenuTitleBlock${modTag}`)
  ) {
    failures.push('Missing generated title block in the welcome-screen output.');
  }
  if (!repeatedOutput || repeatedOutput.content !== output.content) {
    failures.push('Welcome-screen generation is not idempotent when run on its own output.');
  }
  if ((String(output.content).match(/ysm\.ui\.welcome-screen\.component/g) ?? []).length !== 2) {
    failures.push('Expected exactly one generated welcome component block and its end marker.');
  }
  if (
    typeof output.content !== 'string' ||
    !output.content.includes(`${LINK_REVEAL_BLOCKER_PREFIX}1${modTag}`)
  ) {
    failures.push('Missing generated link reveal blocker button in the welcome-screen output.');
  }
  if (
    typeof output.content !== 'string' ||
    !output.content.includes('BackgroundBlockColorToken = "Black80"')
  ) {
    failures.push('Expected the generated reveal panel to use the darker panel background token.');
  }
  const insertionShape = context.tools.text.describeChanges(
    originalWelcomeContent,
    String(output.content),
  );
  if (!insertionShape.ok) {
    failures.push('The welcome-screen output diff exceeded the protected change budget.');
  } else if (
    insertionShape.edits.length !== 1 ||
    insertionShape.edits[0]?.start !== insertionShape.edits[0]?.end
  ) {
    failures.push(
      `Expected one insertion-only welcome-screen edit, received ${insertionShape.edits.length} edits.`,
    );
  }
  if (!localisationContent.includes(ACTIVE_LINK_TOKEN)) {
    failures.push(`Missing managed welcome-screen localisation token ${ACTIVE_LINK_TOKEN}.`);
  }
  if (localisationContent.includes(STALE_LINK_TOKEN)) {
    failures.push(`Stale managed welcome-screen token was not pruned: ${STALE_LINK_TOKEN}.`);
  }
  if (localisationContent.includes(STALE_ALERT_TOKEN)) {
    failures.push(`Stale managed alert token was not pruned: ${STALE_ALERT_TOKEN}.`);
  }

  if (!alertOutput) {
    throw new Error(
      'Welcome-screen alert generation did not return an output during the companion test.',
    );
  }
  if (!alertLongOutput) {
    throw new Error(
      'Welcome-screen long-alert generation did not return an output during the companion test.',
    );
  }
  if (
    typeof alertOutput.content !== 'string' ||
    !alertOutput.content.includes(`MainMenuAlert${modTag}`)
  ) {
    alertFailures.push('Missing generated alert modal in the welcome-screen output.');
  }
  if (
    typeof alertOutput.content !== 'string' ||
    !alertOutput.content.includes(`MainMenuAlertClose${modTag}`)
  ) {
    alertFailures.push('Missing generated alert close button in the welcome-screen output.');
  }
  if (
    typeof alertOutput.content !== 'string' ||
    !alertOutput.content.includes(`${ALERT_PANEL_BLOCKER_PREFIX}${modTag}`)
  ) {
    alertFailures.push('Missing generated alert blocker button in the welcome-screen output.');
  }
  if (
    typeof alertOutput.content !== 'string' ||
    !alertOutput.content.includes('BigLineAction = ~/BigLineAction/MultiLine')
  ) {
    alertFailures.push(
      'Expected the generated alert body to preserve multiline text instead of shrinking it.',
    );
  }
  if (
    typeof alertOutput.content !== 'string' ||
    !alertOutput.content.includes('TextFormatScript = nil')
  ) {
    alertFailures.push(
      'Expected the generated alert text to disable the default text formatter so case is preserved.',
    );
  }
  const shortAlertHeight =
    typeof alertOutput.content === 'string'
      ? extractAlertHeight(alertOutput.content, modTag)
      : undefined;
  const longAlertHeight =
    typeof alertLongOutput.content === 'string'
      ? extractAlertHeight(alertLongOutput.content, modTag)
      : undefined;
  if (!shortAlertHeight || !longAlertHeight || longAlertHeight <= shortAlertHeight) {
    alertFailures.push(
      'Expected longer alert content to generate a taller modal instead of reusing a fixed height.',
    );
  }
  const shortAlertBodyTop =
    typeof alertOutput.content === 'string'
      ? extractAlertPartOffset(alertOutput.content, `MainMenuAlertBody${modTag}`)
      : undefined;
  const shortAlertButtonTop =
    typeof alertOutput.content === 'string'
      ? extractAlertPartOffset(alertOutput.content, `MainMenuAlertClose${modTag}`)
      : undefined;
  if (
    !shortAlertBodyTop ||
    !shortAlertButtonTop ||
    shortAlertBodyTop <= 74 ||
    shortAlertButtonTop <= shortAlertBodyTop + 72
  ) {
    alertFailures.push(
      'Expected the generated alert body to keep visible spacing between the title and the close button.',
    );
  }
  if (!alertLocalisationContent.includes(ACTIVE_ALERT_TITLE_TOKEN)) {
    alertFailures.push(`Missing managed alert title token ${ACTIVE_ALERT_TITLE_TOKEN}.`);
  }
  if (!alertLocalisationContent.includes(ACTIVE_ALERT_BODY_TOKEN)) {
    alertFailures.push(`Missing managed alert body token ${ACTIVE_ALERT_BODY_TOKEN}.`);
  }
  if (
    !alertLocalisationContent.includes(
      'This build is experimental and may change often.\\nPlease report UI regressions, gameplay issues, and localisation problems.\\nLonger text should produce a taller modal instead of forcing the same fixed window height.',
    )
  ) {
    alertFailures.push(
      'Expected generated localisation to encode line breaks as literal `\\n` sequences.',
    );
  }

  return {
    results: [
      failures.length === 0
        ? {
            name: 'welcome-screen generation updates and prunes managed localisation tokens',
            status: 'passed' as const,
            details: [output.targetRelativePath, ACTIVE_LINK_TOKEN],
          }
        : {
            name: 'welcome-screen generation updates and prunes managed localisation tokens',
            status: 'failed' as const,
            reason:
              'The welcome-screen script did not produce the expected target path or clean up managed localisation tokens.',
            suggestion:
              'Update the welcome-screen generator and its localisation handling so managed tokens are refreshed and stale tokens are removed.',
            details: failures,
          },
      alertFailures.length === 0
        ? {
            name: 'welcome-screen alert renders a dismissible modal when alert text is configured',
            status: 'passed' as const,
            details: [
              alertOutput.targetRelativePath,
              ACTIVE_ALERT_TITLE_TOKEN,
              ACTIVE_ALERT_BODY_TOKEN,
            ],
          }
        : {
            name: 'welcome-screen alert renders a dismissible modal when alert text is configured',
            status: 'failed' as const,
            reason:
              'The welcome-screen script did not generate the expected alert modal or managed alert localisation tokens.',
            suggestion:
              'Update the alert rendering and localisation handling so configured alerts appear with a close button and alert tokens.',
            details: alertFailures,
          },
    ],
  };
}
