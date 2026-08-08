import { decodeQr, encodeQr } from '../../shared/qr-code.ts';
import generateWelcomeScreen from './generate-welcome-screen.ts';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const LOCALISATION_RELATIVE_PATH =
  'replace/GameData/Localisation/${modRootName}/INTERFACE_OUTGAME.csv';
const WELCOME_COMPONENT_OWNER_ID = 'ysm.ui.welcome-screen.component';
const STALE_LINK_TOKEN = '"${modTag}L9";"Obsolete link"';
const STALE_ALERT_TOKEN = '"${modTag}ALT";"Obsolete alert"';
const ACTIVE_LINK_TOKEN = '"${modTag}L1"';
const ACTIVE_ALERT_TITLE_TOKEN = '"${modTag}ALT"';
const ACTIVE_ALERT_BODY_TOKEN = '"${modTag}ALB"';

type WelcomeContext = Parameters<typeof generateWelcomeScreen>[0];
type WelcomeFile = Awaited<ReturnType<typeof generateWelcomeScreen>>[number];

/** The script emits the patched view plus one QR image per link. */
function pickWelcomeView(files: WelcomeFile[]): WelcomeFile {
  const view = files.find((file) => file.targetRelativePath.endsWith('.ndf'));
  if (!view) {
    throw new Error('Welcome-screen generation returned no NDF output.');
  }
  return view;
}

function pickQrImages(files: WelcomeFile[]): WelcomeFile[] {
  return files.filter((file) => file.targetRelativePath.endsWith('.png'));
}

/** Only the script's own block is under test; the rest of the file is vanilla WARNO. */
function extractGeneratedComponent(context: WelcomeContext, content: unknown): string {
  if (typeof content !== 'string') {
    return '';
  }
  const block = context.tools.ndf
    .listGeneratedBlocks(content)
    .find((candidate) => candidate.id === WELCOME_COMPONENT_OWNER_ID);
  return block?.innerText ?? '';
}

function isRenderedAs(component: string, elementName: string, descriptorType: string): boolean {
  return new RegExp(`${descriptorType}\\s*\\(\\s*ElementName = "${elementName}"`).test(component);
}

/** WARNO fails to load the whole UI if a list element sets `MagnifiableOffset`. */
function findListChildrenWithOffsets(component: string): string[] {
  return component
    .split('BUCKListElementDescriptor')
    .slice(1)
    .flatMap((element) => {
      const frameStart = element.indexOf('ComponentFrame = TUIFramePropertyRTTI');
      if (frameStart < 0) {
        return [];
      }
      const frame = element.slice(frameStart, element.indexOf(')', frameStart));
      if (!frame.includes('MagnifiableOffset')) {
        return [];
      }
      return [element.match(/ElementName = "([^"]+)"/)?.[1] ?? 'an unnamed element'];
    });
}

export default async function test(context: WelcomeContext) {
  const originalWelcomeContent = await context.readTarget(
    'GameData/UserInterface/Use/OutGame/UISpecificOutGameWelcomeView.ndf',
  );
  const originalLocalisationContent = await context.readModTextIfExists(LOCALISATION_RELATIVE_PATH);
  const seededLocalisationContent = `${originalLocalisationContent}${originalLocalisationContent.endsWith('\n') ? '' : '\n'}${STALE_LINK_TOKEN}\n${STALE_ALERT_TOKEN}\n`;
  const modTag = String(context.variables.modTag ?? 'MOD');
  const failures: string[] = [];
  const alertFailures: string[] = [];
  const sizingFailures: string[] = [];
  let output: WelcomeFile | undefined;
  let repeatedOutput: WelcomeFile | undefined;
  let alertOutput: WelcomeFile | undefined;
  let alertLongOutput: WelcomeFile | undefined;
  let linksOnlyOutput: WelcomeFile | undefined;
  let qrImages: WelcomeFile[] = [];
  let localisationContent = originalLocalisationContent;
  let alertLocalisationContent = originalLocalisationContent;

  try {
    await context.writeModTextIfChanged(LOCALISATION_RELATIVE_PATH, seededLocalisationContent);
    const firstFiles = await generateWelcomeScreen(context);
    output = pickWelcomeView(firstFiles);
    qrImages = pickQrImages(firstFiles);
    const firstOutput = output;
    repeatedOutput = pickWelcomeView(
      await generateWelcomeScreen({
        ...context,
        readTarget: async (targetPath) =>
          targetPath === firstOutput.targetRelativePath
            ? String(firstOutput.content)
            : context.readTarget(targetPath),
      }),
    );
    localisationContent = await context.readModTextIfExists(LOCALISATION_RELATIVE_PATH);
    // Generated rather than assumed: whether the mod config happens to configure an
    // alert must not decide what the sizing checks below are looking at.
    linksOnlyOutput = pickWelcomeView(
      await generateWelcomeScreen({
        ...context,
        variables: { ...context.variables, alert: undefined },
      }),
    );
    alertOutput = pickWelcomeView(
      await generateWelcomeScreen({
        ...context,
        variables: {
          ...context.variables,
          alert: {
            title: 'Closed Beta Notice',
            text: 'This build is experimental.\nExpect unfinished balance and UI.',
          },
        },
      }),
    );
    alertLongOutput = pickWelcomeView(
      await generateWelcomeScreen({
        ...context,
        variables: {
          ...context.variables,
          alert: {
            title: 'Closed Beta Notice',
            text: 'This build is experimental and may change often.\nPlease report UI regressions, gameplay issues, and localisation problems.\nLonger text should produce a taller modal instead of forcing the same fixed window height.',
          },
        },
      }),
    );
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

  const alertComponent = extractGeneratedComponent(context, alertOutput.content);
  const longAlertComponent = extractGeneratedComponent(context, alertLongOutput.content);
  const linksOnlyComponent = extractGeneratedComponent(context, linksOnlyOutput?.content);

  if (linksOnlyComponent.length === 0 || alertComponent.length === 0) {
    sizingFailures.push('Could not read back the generated welcome-screen component block.');
  }
  const linksOnlySizes = linksOnlyComponent.match(/MagnifiableWidthHeight/g) ?? [];
  if (linksOnlySizes.length > 0) {
    sizingFailures.push(
      `Expected every element to be sized from its content, found ${linksOnlySizes.length} declared MagnifiableWidthHeight values.`,
    );
  }
  // The `0.0` height and the Max fit style are what make the declared pair a floor
  // rather than a size.
  const alertSizes = alertComponent.match(/MagnifiableWidthHeight = \[[^\]]*\]/g) ?? [];
  if (alertSizes.length !== 1 || !/, 0\.0\]$/.test(alertSizes[0] ?? '')) {
    sizingFailures.push(
      `Expected the alert to declare exactly one minimum width and no other size, found ${JSON.stringify(alertSizes)}.`,
    );
  }
  if (!alertComponent.includes('FitStyle = ~/ContainerFitStyle/MaxBetweenUserDefinedAndContent')) {
    sizingFailures.push(
      'The alert declares a size without the Max fit style that makes it a minimum, so it is a fixed width.',
    );
  }
  // A hard-coded size would leak the text length into the layout; a content-driven one cannot.
  if (alertComponent !== longAlertComponent) {
    sizingFailures.push(
      'Alert length changed the generated layout, so the modal is not sized from its content.',
    );
  }
  for (const [label, marker] of [
    ['containers', 'FitStyle = ~/ContainerFitStyle/FitToContent'],
    ['lists', 'ChildFitToContent = true'],
    ['text', 'VerticalFitStyle = ~/FitStyle/FitToContent'],
    ['reveal image', 'ResizeMode = ~/TextureResizeMode/FitToContent'],
  ] as const) {
    if (!alertComponent.includes(marker)) {
      sizingFailures.push(`Expected the generated ${label} to fit their content (${marker}).`);
    }
  }
  // A button lights up under the pointer, so the visible frame must not be one. The
  // blocker inside it is the button, and it draws nothing for a hovered state to change.
  for (const panelName of [`MainMenuAlertPanel${modTag}`, `MainMenuLinkRevealPanel1${modTag}`]) {
    if (!isRenderedAs(alertComponent, panelName, 'BUCKContainerDescriptor')) {
      sizingFailures.push(
        `Expected ${panelName} to be a container so it never shows a hover state.`,
      );
    }
  }
  for (const blockerName of [
    `MainMenuAlertPanelBlocker${modTag}`,
    `MainMenuLinkRevealBlocker1${modTag}`,
  ]) {
    if (!isRenderedAs(alertComponent, blockerName, 'BUCKButtonDescriptor')) {
      sizingFailures.push(`Expected ${blockerName} to be a button that swallows clicks.`);
    }
    // A button hands its state down, and `loginBlanc` inverts when highlighted, so the
    // blocker has to stay an empty sibling.
    const start = alertComponent.indexOf(`ElementName = "${blockerName}"`);
    const nextElement = alertComponent.indexOf('ElementName = ', start + 1);
    const body = alertComponent.slice(start, nextElement < 0 ? undefined : nextElement);
    if (start >= 0 && body.includes('Components')) {
      sizingFailures.push(
        `${blockerName} wraps panel content, so hovering it will invert every label inside.`,
      );
    }
  }

  const listChildrenWithOffsets = findListChildrenWithOffsets(alertComponent);

  const qrFailures: string[] = [];
  const links = Array.isArray(context.variables.links) ? context.variables.links : [];
  if (qrImages.length !== links.length) {
    qrFailures.push(`Expected one QR image per link, got ${qrImages.length} for ${links.length}.`);
  }
  for (const [index, link] of links.entries()) {
    const url = String((link as { url?: unknown }).url ?? '');
    const image = qrImages[index];
    const expectedPath = `GameData/Assets/2D/Interface/Common/y-qr-${index + 1}.png`;
    if (image?.targetRelativePath !== expectedPath) {
      qrFailures.push(`Expected ${expectedPath}, got ${image?.targetRelativePath ?? '<missing>'}.`);
    }
    const bytes = image?.content;
    if (!(bytes instanceof Uint8Array) || PNG_SIGNATURE.some((byte, at) => bytes[at] !== byte)) {
      qrFailures.push(`QR image for ${url} is not a PNG.`);
    }
    // The whole point of the feature is that the code carries the link. Encoding it and
    // reading it back out of its own matrix is what says the symbol means what it should.
    try {
      const decoded = decodeQr(encodeQr(url));
      if (decoded !== url) {
        qrFailures.push(`QR code for ${url} decodes as ${JSON.stringify(decoded)}.`);
      }
    } catch (error) {
      qrFailures.push(`QR code for ${url} failed to encode: ${(error as Error).message}`);
    }
    if (!String(output.content).includes(`TextureToken = "Texture${modTag}_QR${index + 1}"`)) {
      qrFailures.push(`The reveal panel for ${url} does not draw Texture${modTag}_QR${index + 1}.`);
    }
    if (!String(output.content).includes(`MainMenuLinkRevealText${index + 1}${modTag}`)) {
      qrFailures.push(`The QR panel for ${url} is missing its link caption.`);
    }
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
      sizingFailures.length === 0
        ? {
            name: 'welcome-screen elements are sized from their content, not from declared sizes',
            status: 'passed' as const,
            details: ['no MagnifiableWidthHeight', 'alert layout independent of alert length'],
          }
        : {
            name: 'welcome-screen elements are sized from their content, not from declared sizes',
            status: 'failed' as const,
            reason:
              'The generated welcome screen declares its own widths or heights instead of letting the BUCK fit-to-content styles measure the text.',
            suggestion:
              'Keep only margins and padding in the welcome-screen layout constants, and size elements with ContainerFitStyle, ChildFitToContent, and the text fit styles.',
            details: sizingFailures,
          },
      listChildrenWithOffsets.length === 0
        ? {
            name: 'welcome-screen list elements leave the layout axis to their list',
            status: 'passed' as const,
            details: ['no MagnifiableOffset on a list element frame'],
          }
        : {
            name: 'welcome-screen list elements leave the layout axis to their list',
            status: 'failed' as const,
            reason:
              'A generated list element sets its own MagnifiableOffset. WARNO rejects the whole UI with a fatal Components.ndfbin load error when a list child claims the axis its list lays out along.',
            suggestion:
              'Move the spacing to the list itself (FirstMargin, InterItemMargin, LastMargin) or to a descriptor nested below the element, and leave MagnifiableOffset off the element frame.',
            details: listChildrenWithOffsets,
          },
      qrFailures.length === 0
        ? {
            name: 'every link gets a QR image that decodes back to its own URL',
            status: 'passed' as const,
            details: qrImages.map((image) => image.targetRelativePath),
          }
        : {
            name: 'every link gets a QR image that decodes back to its own URL',
            status: 'failed' as const,
            reason:
              'The generated QR codes do not match the configured links, are not valid PNGs, or are not drawn by the reveal panels.',
            suggestion:
              'Check the QR encoder in config/patch/shared/qr-code.ts and the texture tokens registered by the welcome-screen ymb.patch.yaml against the `links` entries in ymb.mod.yaml.',
            details: qrFailures,
          },
    ],
  };
}
