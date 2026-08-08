import type { BuildScriptContext, BuildScriptValueTools, GeneratedScriptFile } from 'ymb/api';
import type { LocalisationState } from '../../shared/localisation.ts';
import {
  parseLocalisation,
  removeLocalisationRow,
  renderLocalisation,
  upsertLocalisationRow,
} from '../../shared/localisation.ts';
import { encodeMonochromePng } from '../../shared/png.ts';
import { encodeQr, renderQrPixels } from '../../shared/qr-code.ts';

interface WelcomeLink {
  name: string;
  url: string;
}

interface WelcomeAlert {
  title: string;
  text: string;
  closeLabel: string;
}

const MOD_TAG_EXPRESSION = '${modTag}';
const TARGET_RELATIVE_PATH = 'GameData/UserInterface/Use/OutGame/UISpecificOutGameWelcomeView.ndf';
const LOCALISATION_RELATIVE_PATH =
  'replace/GameData/Localisation/${modRootName}/INTERFACE_OUTGAME.csv';
const DESCRIPTOR_HEADER = 'private UISpecificOutGameWelcomeDescriptor is BUCKContainerDescriptor';
const VIEW_DESCRIPTOR_HEADER =
  '\nUISpecificOutGameWelcomeViewDescriptor is TUISpecificOutGameWelcomeViewDescriptor';
const SCRIPT_SOURCE_PATH = 'mods/YSM/config/patch/ui/welcome-screen/generate-welcome-screen.ts';
const WELCOME_COMPONENT_OWNER_ID = 'ysm.ui.welcome-screen.component';

// Nothing here is a width or a height: BUCK fit-to-content sizes every element, so
// only the spacing between them is a decision this script makes.
const WELCOME_SCREEN_LAYOUT = {
  // Gap between the top of the screen and the mod title.
  titleTopMargin: 175,
  // Gap under the title, before the link row.
  titleBottomMargin: 8,
  // Padding inside every link button.
  linkTextPaddingX: 18,
  linkTextPaddingY: 6,
  // Gap between two link buttons.
  linkItemMargin: 10,
  // Gap under the link row, before the revealed QR panel.
  revealTopMargin: 8,
  // Gap between the QR code and the link caption under it, and under the caption.
  revealCaptionTopMargin: 10,
  revealCaptionBottomMargin: 12,
  revealCaptionPaddingX: 16,
  // How far above its slot the panel parks while hidden. Far enough that no part of a
  // QR code of any version is still on screen at any menu resolution.
  revealHiddenOffsetY: -1000,
};

const WELCOME_SCREEN_TEXT = {
  linkButtonTextSize: '17',
  linkRevealTextSize: '15',
  titleTextSize: '42',
  creditsPrefix: 'Made with ♥ by',
};

// Both the image resolution and how big the code appears. Four modules of quiet
// zone is the specification minimum, and scanners rely on it.
const QR_CODE = {
  modulePixels: 10,
  quietZoneModules: 4,
};

const QR_ASSET_DIRECTORY = 'GameData/Assets/2D/Interface/Common';
/** Byte-mode capacity of version 6 at error correction level M. */
const QR_MAX_URL_BYTES = 106;

const ALERT_LAYOUT = {
  visibleOffsetY: 0,
  hiddenOffsetY: -900,
  // A floor, not a size: a two-word notice measures narrower than its own OK button.
  minWidth: 300,
  // Padding between the modal border and its first and last element.
  contentTopMargin: 30,
  contentBottomMargin: 30,
  // Gap under the alert title, and under the alert body.
  titleBottomMargin: 18,
  bodyBottomMargin: 30,
  // Padding on either side of the alert title and body text.
  textPaddingX: 40,
  // Padding inside the close button. Wide enough that the button reads as the modal's
  // main action rather than a chip sitting under the text.
  closeTextPaddingX: 90,
  closeTextPaddingY: 10,
};

const ALERT_TEXT = {
  titleSize: '28',
  bodySize: '18',
  closeSize: '18',
  closeLabel: 'OK',
};

const TOP_CENTER_ANCHOR = ['AlignementToAnchor = [0.5, 0.0]', 'AlignementToFather = [0.5, 0.0]'];
const MIDDLE_CENTER_ANCHOR = ['AlignementToAnchor = [0.5, 0.5]', 'AlignementToFather = [0.5, 0.5]'];
const TEXT_DICO = 'TextDico = ~/LocalisationConstantes/dico_interface_outgame';
const FIT_TEXT_TO_CONTENT = [
  'HorizontalFitStyle = ~/FitStyle/FitToContent',
  'VerticalFitStyle = ~/FitStyle/FitToContent',
  'BigLineAction = ~/BigLineAction/MultiLine',
];
const FIT_CONTAINER_TO_CONTENT = 'FitStyle = ~/ContainerFitStyle/FitToContent';

/** One generated PNG per link, and the token `ymb.patch.yaml` registers it under. */
function getQrAssetName(index: number): string {
  return `y-qr-${index + 1}.png`;
}

function getQrTextureToken(modTag: string, index: number): string {
  return `Texture${modTag}_QR${index + 1}`;
}

function getString(
  values: BuildScriptValueTools,
  value: unknown,
  label: string,
  fallback = '',
): string {
  return value === undefined ? fallback : values.string(value, label);
}

function getLinks(values: BuildScriptValueTools, value: unknown): WelcomeLink[] {
  if (value === undefined) {
    return [];
  }
  const entries = Array.isArray(value) ? value : values.stringArray(value, 'links');
  return entries
    .map((entry, index) => values.record(entry, `links[${index}]`))
    .map((entry, index) => ({
      name: getString(values, entry.name, `links[${index}].name`),
      url: getString(values, entry.url, `links[${index}].url`),
    }));
}

function getAlert(values: BuildScriptValueTools, value: unknown): WelcomeAlert | undefined {
  if (value === undefined) return undefined;
  const config = values.record(value, 'alert');
  const text = getString(values, config.text, 'alert.text').trim();
  if (text.length === 0) {
    return undefined;
  }

  return {
    title: getString(values, config.title, 'alert.title').trim(),
    text,
    closeLabel:
      getString(values, config.closeLabel, 'alert.closeLabel', ALERT_TEXT.closeLabel).trim() ||
      ALERT_TEXT.closeLabel,
  };
}

function toBase36Index(index: number): string {
  return Math.max(0, index).toString(36).toUpperCase();
}

function buildRuntimeToken(modTag: string, suffix: string): string {
  const token = `${modTag}${suffix}`;
  if (token.length > 10) {
    throw new Error(`Generated token "${token}" exceeds 10 characters.`);
  }
  return token;
}

function buildTemplateToken(suffix: string): string {
  return `${MOD_TAG_EXPRESSION}${suffix}`;
}

const TOKEN_SUFFIXES = {
  title: 'TIT',
  hoverTitle: 'MT',
  alertTitle: 'ALT',
  alertBody: 'ALB',
  alertClose: 'ALC',
} as const;

const MANAGED_WELCOME_TOKEN_PATTERN = '(?:TIT|MT|MI|ALT|ALB|ALC|L[0-9A-Z]{1,5}|U[0-9A-Z]{1,5})?';

type TokenSuffix = (typeof TOKEN_SUFFIXES)[keyof typeof TOKEN_SUFFIXES];

function getLinkTokenSuffix(prefix: 'L' | 'U', index: number): string {
  return `${prefix}${toBase36Index(index + 1)}`;
}

function getRuntimeToken(modTag: string, suffix: TokenSuffix): string {
  return buildRuntimeToken(modTag, suffix);
}

function getRuntimeLinkToken(modTag: string, prefix: 'L' | 'U', index: number): string {
  return buildRuntimeToken(modTag, getLinkTokenSuffix(prefix, index));
}

function getLinkLabelToken(modTag: string, index: number): string {
  return getRuntimeLinkToken(modTag, 'L', index);
}

function getLinkUrlToken(modTag: string, index: number): string {
  return getRuntimeLinkToken(modTag, 'U', index);
}

function getTemplateLinkToken(prefix: 'L' | 'U', index: number): string {
  return buildTemplateToken(getLinkTokenSuffix(prefix, index));
}

function getTemplateLinkLabelToken(index: number): string {
  return getTemplateLinkToken('L', index);
}

function getTemplateLinkUrlToken(index: number): string {
  return getTemplateLinkToken('U', index);
}
function getTemplateToken(suffix: TokenSuffix): string {
  return buildTemplateToken(suffix);
}

function indent(text: string, size: number): string {
  const prefix = ' '.repeat(size);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join('\n');
}

function indentLines(text: string | string[], size: number): string[] {
  const content = Array.isArray(text) ? text.join('\n') : text;
  if (content.length === 0) {
    return [];
  }
  return indent(content, size).split('\n');
}

function findMatchingBracket(text: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    if (character === '[') {
      depth += 1;
      continue;
    }
    if (character !== ']') {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return index;
    }
  }

  throw new Error('Failed to locate the end of the welcome-screen component list.');
}

function findWelcomeComponentsAnchor(content: string): number {
  const match = /(^[ \t]*Components\s*=\s*\r?\n^[ \t]*\[)/m.exec(content);
  return match?.index ?? -1;
}

function insertWelcomeComponent(
  content: string,
  renderedComponent: string,
  ndf: BuildScriptContext['tools']['ndf'],
): string {
  const generatedBlock = `${indent(
    ndf
      .renderGeneratedBlock({
        ownerId: WELCOME_COMPONENT_OWNER_ID,
        title: 'YSM welcome screen component',
        sourcePath: SCRIPT_SOURCE_PATH,
        // Keep the separator inside the owned block. A marker comment after an
        // unseparated entry would hide the collection boundary from NDF parsing.
        blocks: [`${renderedComponent},`],
      })
      .trimEnd(),
    8,
  )}\n`;
  if (ndf.listGeneratedBlocks(content).some((block) => block.id === WELCOME_COMPONENT_OWNER_ID)) {
    return ndf.upsertGeneratedBlock(content, generatedBlock, WELCOME_COMPONENT_OWNER_ID);
  }

  const descriptorStart = content.indexOf(DESCRIPTOR_HEADER);
  if (descriptorStart < 0) {
    throw new Error('Failed to locate `UISpecificOutGameWelcomeDescriptor`.');
  }

  const descriptorEnd = content.indexOf(VIEW_DESCRIPTOR_HEADER, descriptorStart);
  if (descriptorEnd < 0) {
    throw new Error('Failed to locate `UISpecificOutGameWelcomeViewDescriptor`.');
  }

  const descriptorContent = content.slice(descriptorStart, descriptorEnd);
  const componentsStart = findWelcomeComponentsAnchor(descriptorContent);
  if (componentsStart < 0) {
    throw new Error('Failed to locate the welcome-screen components array.');
  }

  const listOpenIndex = descriptorContent.indexOf('[', componentsStart);
  const listCloseIndex = findMatchingBracket(descriptorContent, listOpenIndex);
  const listCloseLineStart = descriptorContent.lastIndexOf('\n', listCloseIndex);
  const insertionIndex = listCloseLineStart >= 0 ? listCloseLineStart + 1 : listCloseIndex;
  const injectedDescriptor =
    descriptorContent.slice(0, insertionIndex) +
    generatedBlock +
    descriptorContent.slice(insertionIndex);

  return `${content.slice(0, descriptorStart)}${injectedDescriptor}${content.slice(descriptorEnd)}`;
}

function getTemplateWelcomeTokens(links: WelcomeLink[], alert: WelcomeAlert | undefined): string[] {
  const tokens = [
    getTemplateToken(TOKEN_SUFFIXES.title),
    getTemplateToken(TOKEN_SUFFIXES.hoverTitle),
  ];
  for (const [index] of links.entries()) {
    tokens.push(getTemplateLinkLabelToken(index), getTemplateLinkUrlToken(index));
  }
  if (alert) {
    tokens.push(
      getTemplateToken(TOKEN_SUFFIXES.alertTitle),
      getTemplateToken(TOKEN_SUFFIXES.alertBody),
      getTemplateToken(TOKEN_SUFFIXES.alertClose),
    );
  }
  return tokens;
}

function upsertTemplateTokenRow(
  localisationState: LocalisationState,
  suffix: TokenSuffix,
  value: string,
): void {
  upsertLocalisationRow(localisationState, getTemplateToken(suffix), value);
}

function pruneWelcomeTokens(
  localisationState: LocalisationState,
  modTag: string,
  activeTokens: Set<string>,
  escapeRegExp: (value: string) => string,
): void {
  const managedTemplatePattern = new RegExp(`^\\$\\{modTag\\}${MANAGED_WELCOME_TOKEN_PATTERN}$`);
  const managedRuntimePattern = new RegExp(
    `^${escapeRegExp(modTag)}${MANAGED_WELCOME_TOKEN_PATTERN}$`,
  );
  const tokensToRemove = Array.from(localisationState.lineIndexByToken.keys()).filter(
    (token) =>
      !activeTokens.has(token) &&
      (managedTemplatePattern.test(token) || managedRuntimePattern.test(token)),
  );

  for (const token of tokensToRemove) {
    removeLocalisationRow(localisationState, token);
  }
}

function upsertWelcomeLocalisationRows(
  localisationState: LocalisationState,
  modName: string,
  modVersion: string,
  author: string,
  links: WelcomeLink[],
  alert: WelcomeAlert | undefined,
): void {
  upsertLocalisationRow(localisationState, MOD_TAG_EXPRESSION, modName);
  upsertTemplateTokenRow(localisationState, TOKEN_SUFFIXES.title, `${modName} ${modVersion}`);
  upsertTemplateTokenRow(
    localisationState,
    TOKEN_SUFFIXES.hoverTitle,
    `${WELCOME_SCREEN_TEXT.creditsPrefix} ${author}`.trim(),
  );

  for (const [index, link] of links.entries()) {
    upsertLocalisationRow(localisationState, getTemplateLinkLabelToken(index), link.name);
    upsertLocalisationRow(localisationState, getTemplateLinkUrlToken(index), link.url);
  }

  if (alert) {
    upsertTemplateTokenRow(localisationState, TOKEN_SUFFIXES.alertTitle, alert.title);
    upsertTemplateTokenRow(localisationState, TOKEN_SUFFIXES.alertBody, alert.text);
    upsertTemplateTokenRow(localisationState, TOKEN_SUFFIXES.alertClose, alert.closeLabel);
  }
}

function updateLocalisation(
  localisationContent: string,
  modTag: string,
  modName: string,
  modVersion: string,
  author: string,
  links: WelcomeLink[],
  alert: WelcomeAlert | undefined,
  escapeRegExp: (value: string) => string,
): string {
  const localisationState = parseLocalisation(localisationContent);
  const activeTokens = new Set([MOD_TAG_EXPRESSION, ...getTemplateWelcomeTokens(links, alert)]);

  pruneWelcomeTokens(localisationState, modTag, activeTokens, escapeRegExp);
  upsertWelcomeLocalisationRows(localisationState, modName, modVersion, author, links, alert);

  return renderLocalisation(localisationState);
}

function magnifiable(value: number): string {
  return value.toFixed(1);
}

function renderOffsetY(value: number): string {
  return `MagnifiableOffset = [0.0, ${magnifiable(value)}]`;
}

function renderTextPadding(x: number, top: number, bottom: number): string {
  return `TextPadding = TRTTILength4(Magnifiable = [${magnifiable(x)}, ${magnifiable(top)}, ${magnifiable(x)}, ${magnifiable(bottom)}])`;
}

function renderMargin(
  name: 'FirstMargin' | 'InterItemMargin' | 'LastMargin',
  value: number,
): string {
  return `${name} = TRTTILength(Magnifiable = ${magnifiable(value)})`;
}

function renderFrame(properties: string[]): string[] {
  if (properties.length === 0) {
    return ['ComponentFrame = TUIFramePropertyRTTI()'];
  }
  return ['ComponentFrame = TUIFramePropertyRTTI', '(', ...indentLines(properties, 4), ')'];
}

function renderAnimationFrame(name: string, properties: string[]): string[] {
  return [`${name} = TUIFramePropertyRTTI`, '(', ...indentLines(properties, 4), ')'];
}

/** Appends the collection separator every block needs when it sits in an NDF list. */
function joinBlocks(blocks: string[][]): string[] {
  return blocks.flatMap((block) =>
    block.length === 0 ? block : [...block.slice(0, -1), `${block.at(-1)},`],
  );
}

function renderCollection(name: 'Components' | 'Elements', blocks: string[][]): string[] {
  return [`${name} =`, '[', ...indentLines(joinBlocks(blocks), 4), ']'];
}

function renderStandardButton(
  elementName: string,
  frame: string[],
  components: string[][],
): string[] {
  return [
    'BUCKButtonDescriptor',
    '(',
    `    ElementName = "${elementName}"`,
    ...indentLines(renderFrame(frame), 4),
    `    ${FIT_CONTAINER_TO_CONTENT}`,
    '    IsTogglable = true',
    '    DefaultToggleValue = false',
    '    CannotDeselect = false',
    '    HasBorder = true',
    '    BorderLineColorToken = "VertLogin"',
    '    BorderThicknessToken = "3"',
    '    HasBackground = true',
    '    BackgroundBlockColorToken = "loginBoutonBackground_vert"',
    '    LeftClickSound = SoundEvent_EnterMods',
    ...indentLines(renderCollection('Components', components), 4),
    ')',
  ];
}

function renderStandardText(args: {
  elementName: string;
  alignment: 'Center' | 'Left';
  textSize: string;
  textToken: string;
  padding: string;
}): string[] {
  return [
    'BUCKTextDescriptor',
    '(',
    `    ElementName = "${args.elementName}"`,
    ...indentLines(renderFrame(TOP_CENTER_ANCHOR), 4),
    '    ParagraphStyle = TParagraphStyle',
    '    (',
    '        VerticalAlignment = ~/UIText_VerticalCenter',
    `        Alignment = ~/UIText_${args.alignment}`,
    '    )',
    ...indentLines(FIT_TEXT_TO_CONTENT, 4),
    '    TextStyle = "Default"',
    '    TypefaceToken = "UIMainFont"',
    '    TextColor = "loginBlanc"',
    `    TextSize = "${args.textSize}"`,
    `    ${TEXT_DICO}`,
    `    TextToken = "${args.textToken}"`,
    '    TextFormatScript = nil',
    `    ${args.padding}`,
    ')',
  ];
}

function renderListElement(component: string[]): string[] {
  const [head, ...rest] = component;
  return [
    'BUCKListElementDescriptor',
    '(',
    `    ComponentDescriptor = ${head ?? ''}`,
    ...indentLines(rest, 4),
    ')',
  ];
}

function renderList(options: {
  elementName: string;
  axis: 'Vertical' | 'Horizontal';
  frame: string[];
  margins?: string[];
  elements: string[][];
}): string[] {
  return [
    'BUCKListDescriptor',
    '(',
    `    ElementName = "${options.elementName}"`,
    ...indentLines(renderFrame(options.frame), 4),
    `    Axis = ~/ListAxis/${options.axis}`,
    '    BreadthComputationMode = ~/BreadthComputationMode/ComputeBreadthFromLargestChild',
    '    ChildFitToContent = true',
    ...indentLines(options.margins ?? [], 4),
    ...indentLines(renderCollection('Elements', options.elements.map(renderListElement)), 4),
    ')',
  ];
}

function renderLinkText(modTag: string, index: number): string[] {
  return [
    'BUCKTextDescriptor',
    '(',
    `    ElementName = "MainMenuLinkText${index + 1}${modTag}"`,
    ...indentLines(renderFrame(MIDDLE_CENTER_ANCHOR), 4),
    '    ParagraphStyle = CenteredParagraphStyle',
    '    TextStyle = "TextStyleEcranMoniteur"',
    ...indentLines(FIT_TEXT_TO_CONTENT, 4),
    '    TypefaceToken = "UISecondFont"',
    '    TextColor = "loginBlanc"',
    `    TextSize = "${WELCOME_SCREEN_TEXT.linkButtonTextSize}"`,
    `    ${TEXT_DICO}`,
    `    TextToken = "${getLinkLabelToken(modTag, index)}"`,
    `    ${renderTextPadding(
      WELCOME_SCREEN_LAYOUT.linkTextPaddingX,
      WELCOME_SCREEN_LAYOUT.linkTextPaddingY,
      WELCOME_SCREEN_LAYOUT.linkTextPaddingY,
    )}`,
    ')',
  ];
}

function renderLinkElement(modTag: string, index: number): string[] {
  const number = index + 1;
  return renderStandardButton(
    `MainMenuLink${number}${modTag}`,
    [],
    [
      renderLinkText(modTag, index),
      [
        'BUCKSpecificHintableArea',
        '(',
        `    ElementName = "MainMenuLinkHint${number}${modTag}"`,
        `    HintTitleToken = "${getLinkLabelToken(modTag, index)}"`,
        `    HintBodyToken = "${getLinkUrlToken(modTag, index)}"`,
        '    DicoToken = ~/LocalisationConstantes/dico_interface_outgame',
        ')',
      ],
    ],
  );
}

/** Every link stays on one row, however many there are, and the row grows to fit them. */
function renderLinksDock(modTag: string, links: WelcomeLink[]): string[] {
  return renderList({
    elementName: `MainMenuLinks${modTag}`,
    axis: 'Horizontal',
    frame: TOP_CENTER_ANCHOR,
    margins: [renderMargin('InterItemMargin', WELCOME_SCREEN_LAYOUT.linkItemMargin)],
    elements: links.map((_, index) => renderLinkElement(modTag, index)),
  });
}

/**
 * Swallows clicks so they do not reach the menu behind. It must stay a sibling of
 * the content, not wrap it: a button hands its state down, and `loginBlanc` is white
 * at rest and near-black when highlighted.
 */
function renderClickBlocker(elementName: string): string[] {
  return [
    'BUCKButtonDescriptor',
    '(',
    `    ElementName = "${elementName}"`,
    ...indentLines(renderFrame(['RelativeWidthHeight = [1.0, 1.0]']), 4),
    '    HasBackground = false',
    '    HasBorder = false',
    ')',
  ];
}

/** A plain container has no hovered state, so the border keeps its drawn colour. */
function renderRevealPanel(modTag: string, index: number): string[] {
  const number = index + 1;
  return [
    'BUCKContainerDescriptor',
    '(',
    `    ElementName = "MainMenuLinkRevealPanel${number}${modTag}"`,
    ...indentLines(renderFrame(TOP_CENTER_ANCHOR), 4),
    `    ${FIT_CONTAINER_TO_CONTENT}`,
    '    HasBackground = true',
    '    BackgroundBlockColorToken = "Black80"',
    '    HasBorder = true',
    '    BorderLineColorToken = "VertLogin"',
    '    BorderThicknessToken = "2"',
    ...indentLines(
      renderCollection('Components', [
        renderClickBlocker(`MainMenuLinkRevealBlocker${number}${modTag}`),
        renderList({
          elementName: `MainMenuLinkRevealContent${number}${modTag}`,
          axis: 'Vertical',
          frame: TOP_CENTER_ANCHOR,
          elements: [renderRevealImage(modTag, index), renderRevealCaption(modTag, index)],
        }),
      ]),
      4,
    ),
    ')',
  ];
}

/**
 * `FitToContent` takes the image at its own pixel size. The code sits flush against
 * the border: its quiet zone is the margin, and covering it stops it scanning.
 */
function renderRevealImage(modTag: string, index: number): string[] {
  return [
    'BUCKTextureDescriptor',
    '(',
    `    ElementName = "MainMenuLinkRevealImage${index + 1}${modTag}"`,
    ...indentLines(renderFrame(TOP_CENTER_ANCHOR), 4),
    `    TextureToken = "${getQrTextureToken(modTag, index)}"`,
    '    ResizeMode = ~/TextureResizeMode/FitToContent',
    '    TextureFrame = TUIFramePropertyRTTI()',
    ')',
  ];
}

/** The link itself under the code, for anyone who would rather type it than scan it. */
function renderRevealCaption(modTag: string, index: number): string[] {
  return renderStandardText({
    elementName: `MainMenuLinkRevealText${index + 1}${modTag}`,
    alignment: 'Center',
    textSize: WELCOME_SCREEN_TEXT.linkRevealTextSize,
    textToken: getLinkUrlToken(modTag, index),
    padding: renderTextPadding(
      WELCOME_SCREEN_LAYOUT.revealCaptionPaddingX,
      WELCOME_SCREEN_LAYOUT.revealCaptionTopMargin,
      WELCOME_SCREEN_LAYOUT.revealCaptionBottomMargin,
    ),
  });
}

function renderRevealAnimation(modTag: string, index: number): string[] {
  const number = index + 1;
  return [
    'BUCKTranslationAnimatedContainerDescriptor',
    '(',
    `    ElementName = "MainMenuLinkReveal${number}${modTag}"`,
    `    ButtonNameForTrigger = "MainMenuLink${number}${modTag}"`,
    ...indentLines(
      renderAnimationFrame('FramePropertyBeforeAnimation', [
        renderOffsetY(WELCOME_SCREEN_LAYOUT.revealHiddenOffsetY),
        ...TOP_CENTER_ANCHOR,
      ]),
      4,
    ),
    '    AnimationTotalDuration = 0.15',
    ...indentLines(
      renderAnimationFrame('FramePropertyAfterAnimation', [
        renderOffsetY(WELCOME_SCREEN_LAYOUT.revealTopMargin),
        ...TOP_CENTER_ANCHOR,
      ]),
      4,
    ),
    ...indentLines(renderCollection('Components', [renderRevealPanel(modTag, index)]), 4),
    ')',
  ];
}

/**
 * A zero-size anchor the reveal panels hang off, so hiding one never resizes the
 * title block. It sets no offset -- a vertical list owns its children's `y` axis and
 * the game refuses a layout where a child claims it back.
 */
function renderRevealSlot(modTag: string, links: WelcomeLink[]): string[] {
  return [
    'BUCKContainerDescriptor',
    '(',
    `    ElementName = "MainMenuLinkRevealSlot${modTag}"`,
    ...indentLines(renderFrame(TOP_CENTER_ANCHOR), 4),
    ...indentLines(
      renderCollection(
        'Components',
        links.map((_, index) => renderRevealAnimation(modTag, index)),
      ),
      4,
    ),
    ')',
  ];
}

function renderTitleElement(modTag: string): string[] {
  return [
    'BUCKTextDescriptor',
    '(',
    `    ElementName = "MainMenuTitle${modTag}"`,
    ...indentLines(renderFrame(TOP_CENTER_ANCHOR), 4),
    '    ParagraphStyle = TParagraphStyle',
    '    (',
    '        VerticalAlignment = ~/UIText_VerticalCenter',
    '        Alignment = ~/UIText_Center',
    '    )',
    ...indentLines(FIT_TEXT_TO_CONTENT, 4),
    '    TextColor = "ListeExcel/Cartouche"',
    `    TextSize  = "${WELCOME_SCREEN_TEXT.titleTextSize}"`,
    '    TextStyle = "Default"',
    '    TypefaceToken = "UIMainFont"',
    `    ${TEXT_DICO}`,
    `    TextToken = "${getRuntimeToken(modTag, TOKEN_SUFFIXES.title)}"`,
    `    ${renderTextPadding(0, 0, WELCOME_SCREEN_LAYOUT.titleBottomMargin)}`,
    ...indentLines(
      renderCollection('Components', [
        [
          'BUCKSpecificHintableArea',
          '(',
          `    HintTitleToken = "${getRuntimeToken(modTag, TOKEN_SUFFIXES.hoverTitle)}"`,
          '    DicoToken = ~/LocalisationConstantes/dico_interface_outgame',
          ')',
        ],
      ]),
      4,
    ),
    ')',
  ];
}

function renderTitleBlock(modTag: string, links: WelcomeLink[]): string[] {
  const elements = [renderTitleElement(modTag)];
  if (links.length > 0) {
    elements.push(renderLinksDock(modTag, links), renderRevealSlot(modTag, links));
  }

  return renderList({
    elementName: `MainMenuTitleBlock${modTag}`,
    axis: 'Vertical',
    frame: [renderOffsetY(WELCOME_SCREEN_LAYOUT.titleTopMargin), ...TOP_CENTER_ANCHOR],
    elements,
  });
}

function renderAlertTitleText(modTag: string): string[] {
  return renderStandardText({
    elementName: `MainMenuAlertTitle${modTag}`,
    alignment: 'Center',
    textSize: ALERT_TEXT.titleSize,
    textToken: getRuntimeToken(modTag, TOKEN_SUFFIXES.alertTitle),
    padding: renderTextPadding(ALERT_LAYOUT.textPaddingX, 0, ALERT_LAYOUT.titleBottomMargin),
  });
}

function renderAlertBodyText(modTag: string): string[] {
  return renderStandardText({
    elementName: `MainMenuAlertBody${modTag}`,
    alignment: 'Left',
    textSize: ALERT_TEXT.bodySize,
    textToken: getRuntimeToken(modTag, TOKEN_SUFFIXES.alertBody),
    padding: renderTextPadding(ALERT_LAYOUT.textPaddingX, 0, ALERT_LAYOUT.bodyBottomMargin),
  });
}

function renderAlertCloseButton(modTag: string, closeButtonName: string): string[] {
  return renderStandardButton(closeButtonName, TOP_CENTER_ANCHOR, [
    [
      'BUCKTextDescriptor',
      '(',
      `    ElementName = "MainMenuAlertCloseText${modTag}"`,
      ...indentLines(renderFrame(MIDDLE_CENTER_ANCHOR), 4),
      '    ParagraphStyle = CenteredParagraphStyle',
      '    TextStyle = "Default"',
      ...indentLines(FIT_TEXT_TO_CONTENT, 4),
      '    TypefaceToken = "UISecondFont"',
      '    TextColor = "loginBlanc"',
      `    TextSize = "${ALERT_TEXT.closeSize}"`,
      `    ${TEXT_DICO}`,
      `    TextToken = "${getRuntimeToken(modTag, TOKEN_SUFFIXES.alertClose)}"`,
      '    TextFormatScript = nil',
      `    ${renderTextPadding(
        ALERT_LAYOUT.closeTextPaddingX,
        ALERT_LAYOUT.closeTextPaddingY,
        ALERT_LAYOUT.closeTextPaddingY,
      )}`,
      ')',
    ],
  ]);
}

/**
 * `MaxBetweenUserDefinedAndContent` reads the declared pair as a floor, so height
 * stays content-driven and width only holds the modal open for a short notice.
 */
function renderAlertPanel(modTag: string, closeButtonName: string): string[] {
  return [
    'BUCKContainerDescriptor',
    '(',
    `    ElementName = "MainMenuAlertPanel${modTag}"`,
    ...indentLines(
      renderFrame([
        `MagnifiableWidthHeight = [${magnifiable(ALERT_LAYOUT.minWidth)}, 0.0]`,
        ...MIDDLE_CENTER_ANCHOR,
      ]),
      4,
    ),
    '    FitStyle = ~/ContainerFitStyle/MaxBetweenUserDefinedAndContent',
    '    HasBackground = true',
    // Opaque: the menu art showing through 80% black made the notice hard to read.
    '    BackgroundBlockColorToken = "DarkestGray"',
    '    HasBorder = true',
    '    BorderLineColorToken = "VertLogin"',
    '    BorderThicknessToken = "3"',
    ...indentLines(
      renderCollection('Components', [
        renderClickBlocker(`MainMenuAlertPanelBlocker${modTag}`),
        renderList({
          elementName: `MainMenuAlertContent${modTag}`,
          axis: 'Vertical',
          frame: TOP_CENTER_ANCHOR,
          margins: [
            renderMargin('FirstMargin', ALERT_LAYOUT.contentTopMargin),
            renderMargin('LastMargin', ALERT_LAYOUT.contentBottomMargin),
          ],
          elements: [
            renderAlertTitleText(modTag),
            renderAlertBodyText(modTag),
            renderAlertCloseButton(modTag, closeButtonName),
          ],
        }),
      ]),
      4,
    ),
    ')',
  ];
}

function renderAlertModal(modTag: string): string[] {
  const closeButtonName = `MainMenuAlertClose${modTag}`;
  return [
    'BUCKTranslationAnimatedContainerDescriptor',
    '(',
    `    ElementName = "MainMenuAlert${modTag}"`,
    `    ButtonNameForTrigger = "${closeButtonName}"`,
    ...indentLines(
      renderAnimationFrame('FramePropertyBeforeAnimation', [
        renderOffsetY(ALERT_LAYOUT.visibleOffsetY),
        ...MIDDLE_CENTER_ANCHOR,
      ]),
      4,
    ),
    '    AnimationTotalDuration = 0.20',
    ...indentLines(
      renderAnimationFrame('FramePropertyAfterAnimation', [
        renderOffsetY(ALERT_LAYOUT.hiddenOffsetY),
        ...MIDDLE_CENTER_ANCHOR,
      ]),
      4,
    ),
    ...indentLines(renderCollection('Components', [renderAlertPanel(modTag, closeButtonName)]), 4),
    ')',
  ];
}

function renderWelcomeComponent(
  modTag: string,
  links: WelcomeLink[],
  alert: WelcomeAlert | undefined,
): string {
  const components = [renderTitleBlock(modTag, links)];
  if (alert) {
    components.push(renderAlertModal(modTag));
  }

  return [
    'BUCKContainerDescriptor',
    '(',
    `    ElementName = "MainMenuWelcomeRoot${modTag}"`,
    ...indentLines(renderFrame(['RelativeWidthHeight = [1.0, 1.0]']), 4),
    ...indentLines(renderCollection('Components', components), 4),
    ')',
  ].join('\n');
}

type WelcomeScreenContext = Pick<
  BuildScriptContext,
  | 'mod'
  | 'tools'
  | 'variables'
  | 'resolvePath'
  | 'readTarget'
  | 'readModTextIfExists'
  | 'writeModTextIfChanged'
>;

/** One PNG per link, named and tokenised the way `ymb.patch.yaml` registers them. */
function renderQrAssets(links: WelcomeLink[]): GeneratedScriptFile[] {
  return links.map((link, index) => ({
    targetRelativePath: `${QR_ASSET_DIRECTORY}/${getQrAssetName(index)}`,
    content: encodeMonochromePng(renderQrPixels(encodeQr(link.url), QR_CODE)),
  }));
}

export default async function generateWelcomeScreen(
  context: WelcomeScreenContext,
): Promise<GeneratedScriptFile[]> {
  const modTag = getString(context.tools.values, context.variables.modTag, 'modTag', 'MOD');
  const modVersion = getString(
    context.tools.values,
    context.variables.modVersion,
    'modVersion',
    '1.0',
  );
  const author = getString(context.tools.values, context.variables.author, 'author');
  const modName = context.mod.name;
  const links = getLinks(context.tools.values, context.variables.links);
  const alert = getAlert(context.tools.values, context.variables.alert);

  const [welcomeViewContent, localisationContent] = await Promise.all([
    context.readTarget(TARGET_RELATIVE_PATH),
    context.readModTextIfExists(LOCALISATION_RELATIVE_PATH),
  ]);

  await context.tools.assert.all([
    {
      name: 'welcome-screen configuration is valid',
      suggestion:
        'Fix the welcome-screen variables in the mod config so every generated token stays within WARNO limits.',
      run: () => validateWelcomeConfiguration(context, modTag, links, alert),
    },
    {
      name: 'welcome-screen target layout still contains expected anchors',
      suggestion:
        'Update the welcome-screen injection anchors if WARNO changed `UISpecificOutGameWelcomeView.ndf` in a game update.',
      run: () => validateWelcomeTargetLayout(context, welcomeViewContent),
    },
  ]);

  const generatedOutput = {
    targetRelativePath: TARGET_RELATIVE_PATH,
    content: insertWelcomeComponent(
      welcomeViewContent,
      renderWelcomeComponent(modTag, links, alert),
      context.tools.ndf,
    ),
  };
  context.tools.ndf.assertValid(generatedOutput.content, TARGET_RELATIVE_PATH);
  const nextLocalisationContent = updateLocalisation(
    localisationContent,
    modTag,
    modName,
    modVersion,
    author,
    links,
    alert,
    context.tools.text.escapeRegExp,
  );
  await context.writeModTextIfChanged(LOCALISATION_RELATIVE_PATH, nextLocalisationContent);
  return [generatedOutput, ...renderQrAssets(links)];
}

function validateWelcomeConfiguration(
  context: WelcomeScreenContext,
  modTag: string,
  links: WelcomeLink[],
  alert: WelcomeAlert | undefined,
): void {
  context.tools.assert.ok(modTag.trim().length > 0, {
    reason:
      'The `modTag` variable is empty, so the welcome-screen script cannot build localisation tokens.',
    suggestion: 'Set a non-empty `modTag` value in the YSM mod variables.',
  });
  context.tools.assert.ok(modTag.length <= 7, {
    reason: 'The `modTag` variable is too long for the welcome-screen runtime token format.',
    suggestion:
      'Use a shorter `modTag` so `${modTag}TIT`, `${modTag}MT`, and link tokens stay within WARNO token limits.',
    details: [`Current modTag: ${modTag}`, `Current modTag length: ${modTag.length}`],
  });

  for (const [index, link] of links.entries()) {
    context.tools.assert.ok(link.name.trim().length > 0, {
      reason: `Welcome-screen link #${index + 1} is missing a display name.`,
      suggestion: 'Set a non-empty `name` value for every `links` entry.',
      details: [`Link URL: ${link.url || '<empty>'}`],
    });
    context.tools.assert.ok(link.url.trim().length > 0, {
      reason: `Welcome-screen link #${index + 1} is missing a URL.`,
      suggestion: 'Set a non-empty `url` value for every `links` entry.',
      details: [`Link name: ${link.name || '<empty>'}`],
    });
    context.tools.assert.ok(new TextEncoder().encode(link.url).length <= QR_MAX_URL_BYTES, {
      reason: `Welcome-screen link #${index + 1} is too long to fit in a QR code.`,
      suggestion:
        'Shorten the URL, or put it behind a link shortener. The generator encodes at error correction level M, which tops out at 106 bytes.',
      details: [`Link name: ${link.name || '<empty>'}`, `URL length: ${link.url.length}`],
    });
  }

  if (alert) {
    context.tools.assert.ok(alert.title.trim().length > 0, {
      reason: 'The `alert.title` value is required when `alert.text` is set.',
      suggestion: 'Set a non-empty `title` inside the `alert` config block.',
      details: [`Alert text length: ${alert.text.length}`],
    });
  }
}

function validateWelcomeTargetLayout(
  context: WelcomeScreenContext,
  welcomeViewContent: string,
): void {
  context.tools.assert.textPresent(welcomeViewContent, {
    reason: `Welcome-screen target file was empty or missing: \`${TARGET_RELATIVE_PATH}\`.`,
    suggestion:
      'Restore the target file from the current WARNO build and update the script if the path changed.',
    absolutePath: context.resolvePath(TARGET_RELATIVE_PATH),
  });
  context.tools.assert.textIncludes(welcomeViewContent, DESCRIPTOR_HEADER, {
    reason:
      'The welcome-screen container descriptor anchor was not found in the current WARNO file.',
    suggestion:
      'Update the script anchor for `UISpecificOutGameWelcomeDescriptor` after the WARNO UI layout change.',
    absolutePath: context.resolvePath(TARGET_RELATIVE_PATH),
  });
  context.tools.assert.textIncludes(welcomeViewContent, VIEW_DESCRIPTOR_HEADER, {
    reason: 'The welcome-screen view descriptor anchor was not found in the current WARNO file.',
    suggestion:
      'Update the script anchor for `UISpecificOutGameWelcomeViewDescriptor` after the WARNO UI layout change.',
    absolutePath: context.resolvePath(TARGET_RELATIVE_PATH),
  });
  context.tools.assert.ok(findWelcomeComponentsAnchor(welcomeViewContent) >= 0, {
    reason: 'The welcome-screen component list anchor was not found in the current WARNO file.',
    suggestion:
      'Update the script anchor for the `Components` array after the WARNO UI layout change.',
    absolutePath: context.resolvePath(TARGET_RELATIVE_PATH),
  });
}
