import assert from 'node:assert/strict';
import type { BuildScriptTestContext } from 'ymb/api';
import renderWelcomeScreen from './generate-welcome-screen.ts';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WELCOME_COMPONENT_OWNER_ID = 'ysm.ui.welcome-screen.component';
const STALE_LINK_TOKEN = '"TESTL9";"Obsolete link"';
const STALE_ALERT_TOKEN = '"TESTALT";"Obsolete alert"';
const ACTIVE_LINK_TOKEN = '"TESTL1"';
const ACTIVE_ALERT_TITLE_TOKEN = '"TESTALT"';
const ACTIVE_ALERT_BODY_TOKEN = '"TESTALB"';

type WelcomeContext = Parameters<typeof renderWelcomeScreen>[0];
type WelcomeFile = Awaited<ReturnType<typeof renderWelcomeScreen>>[number];

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
  // biome-ignore lint/performance/useDomNodeTextContent: This is NDF data, not a DOM node.
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

export default async function test({ tools, builder }: BuildScriptTestContext) {
  let localisation = '"TOKEN";"REFTEXT"\n"UNRELATED";"Keep this row"\n';
  const context: WelcomeContext = {
    tools,
    builder,
    mod: { id: 'sample', name: 'Sample', rootPath: '.', configPath: '.' },
    variables: {
      modTag: 'TEST',
      modRootName: 'Fixture',
      author: 'Author',
      modVersion: '0',
      links: [
        { name: 'First', url: 'https://example.com/a' },
        { name: 'Second', url: 'https://example.com/b' },
      ],
    },
    readTarget: async (path) =>
      path.endsWith('.csv')
        ? localisation
        : `private UISpecificOutGameWelcomeDescriptor is BUCKContainerDescriptor(
    Components =
    [
        BUCKTextDescriptor(Text = "]") // Closing brackets in text are not list boundaries.
    ]
)
UISpecificOutGameWelcomeViewDescriptor is TUISpecificOutGameWelcomeViewDescriptor()
`,
  };
  const generateWelcomeScreen = async (input: WelcomeContext) => {
    const files = await renderWelcomeScreen(input);
    const csv = files.find((file) => file.targetRelativePath.endsWith('.csv'));
    assert.ok(csv, 'Localisation must be returned as a build output.');
    localisation = String(csv.content);
    return files;
  };
  const originalWelcomeContent = await context.readTarget(
    'GameData/UserInterface/Use/OutGame/UISpecificOutGameWelcomeView.ndf',
  );
  const originalLocalisationContent = localisation;
  const seededLocalisationContent = `${originalLocalisationContent}${originalLocalisationContent.endsWith('\n') ? '' : '\n'}${STALE_LINK_TOKEN}\n${STALE_LINK_TOKEN}\n${STALE_ALERT_TOKEN}\n`;
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
    localisation = seededLocalisationContent;
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
    localisationContent = localisation;
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
    alertLocalisationContent = localisation;
  } finally {
    localisation = originalLocalisationContent;
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
  if (typeof output.content !== 'string' || !output.content.includes(`MainMenuTitleBlockTEST`)) {
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
  const components = (content: string) => {
    const parent = context.tools.ndf.findNamedBlock(content, 'UISpecificOutGameWelcomeDescriptor');
    assert.ok(parent, 'The original welcome-screen container must remain present.');
    const value = context.tools.ndf.readField(parent.text, 'Components');
    assert.ok(value, 'The original Components field must remain present.');
    return context.tools.ndf.findCollectionEntries(value).map((entry) => entry.text.trim());
  };
  assert.equal(
    components(String(output.content)).length,
    components(originalWelcomeContent).length + 1,
    'The welcome component must be added inside the Components collection.',
  );
  assert.deepEqual(
    components(context.tools.ndf.stripGeneratedBlocks(String(output.content))),
    components(originalWelcomeContent),
  );
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
    !alertOutput.content.includes(`MainMenuAlertTEST`)
  ) {
    alertFailures.push('Missing generated alert modal in the welcome-screen output.');
  }
  if (
    typeof alertOutput.content !== 'string' ||
    !alertOutput.content.includes(`MainMenuAlertCloseTEST`)
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
  for (const panelName of [`MainMenuAlertPanelTEST`, `MainMenuLinkRevealPanel1TEST`]) {
    if (!isRenderedAs(alertComponent, panelName, 'BUCKContainerDescriptor')) {
      sizingFailures.push(
        `Expected ${panelName} to be a container so it never shows a hover state.`,
      );
    }
  }
  for (const blockerName of [`MainMenuAlertPanelBlockerTEST`, `MainMenuLinkRevealBlocker1TEST`]) {
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
    if (!String(output.content).includes(`TextureToken = "TextureTEST_QR${index + 1}"`)) {
      qrFailures.push(`The reveal panel for ${url} does not draw TextureTEST_QR${index + 1}.`);
    }
    if (!String(output.content).includes(`MainMenuLinkRevealText${index + 1}TEST`)) {
      qrFailures.push(`The QR panel for ${url} is missing its link caption.`);
    }
  }

  assert.deepEqual(
    failures,
    [],
    'welcome-screen generation updates and prunes managed localisation tokens',
  );
  assert.deepEqual(
    alertFailures,
    [],
    'welcome-screen alert renders a dismissible modal when alert text is configured',
  );
  assert.deepEqual(
    sizingFailures,
    [],
    'welcome-screen elements are sized from their content, not from declared sizes',
  );
  assert.deepEqual(
    listChildrenWithOffsets,
    [],
    'welcome-screen list elements leave the layout axis to their list',
  );
  assert.deepEqual(qrFailures, [], 'every link gets a QR image and its reveal panel');
  assert.ok(localisation.includes('"UNRELATED";"Keep this row"'));
  return { results: [{ name: 'Welcome-screen generation', status: 'passed' as const }] };
}
