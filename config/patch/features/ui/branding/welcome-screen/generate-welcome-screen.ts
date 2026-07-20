import type { BuildScriptContext, GeneratedScriptFile } from '../../../../../../../../src/types.ts';
import {
  parseLocalisation,
  removeLocalisationRow,
  renderLocalisation,
  upsertLocalisationRow,
} from '../../../../shared/deck-generation/generator/localisation.ts';
import type { LocalisationState } from '../../../../shared/deck-generation/generator/types.ts';

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
const SCRIPT_SOURCE_PATH =
  'mods/YSM/config/patch/features/ui/branding/welcome-screen/generate-welcome-screen.ts';
const WELCOME_COMPONENT_OWNER_ID = 'ysm.ui.welcome-screen.component';

const WELCOME_SCREEN_LAYOUT = {
  linksPerRow: 4,
  linkWidth: 200,
  linkHeight: 30,
  linkItemMargin: 10,
  linkRowSpacing: 4,
  linksTopOffset: 62,
  revealWidth: 620,
  revealHeight: 42,
  revealHiddenTop: -320,
  revealExtraTopGap: 8,
  titleHeight: 58,
  titleBlockWidth: 900,
  titleBlockTopOffset: 175,
  titleBlockBaseHeight: 60,
  titleBlockRevealBottomPadding: 42,
};

const WELCOME_SCREEN_TEXT = {
  linkButtonTextSize: '17',
  linkRevealTextSize: '20',
  titleTextSize: '42',
  creditsPrefix: 'Made with ♥ by',
};

const ALERT_LAYOUT = {
  width: 860,
  minHeight: 200,
  visibleOffsetY: 0,
  hiddenOffsetY: -900,
  titleTopOffset: 20,
  titleHeight: 50,
  bodyTopGap: 20,
  bodyMinHeight: 72,
  bodyLineHeight: 24,
  approxCharsPerLine: 68,
  buttonTopGap: 30,
  closeWidth: 180,
  closeHeight: 36,
  closeBottomOffset: 28,
};

const ALERT_TEXT = {
  titleSize: '28',
  bodySize: '18',
  closeSize: '18',
  closeLabel: 'OK',
};

function getString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function getLinks(value: unknown): WelcomeLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
    )
    .map((entry) => ({
      name: getString(entry.name),
      url: getString(entry.url),
    }));
}

function getAlert(value: unknown): WelcomeAlert | undefined {
  const config = asRecord(value);
  const text = getString(config.text).trim();
  if (text.length === 0) {
    return undefined;
  }

  return {
    title: getString(config.title).trim(),
    text,
    closeLabel: getString(config.closeLabel, ALERT_TEXT.closeLabel).trim() || ALERT_TEXT.closeLabel,
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
  return indent(content, size).split('\n');
}
function chunkIndices(total: number, maxPerRow: number): number[][] {
  const rows: number[][] = [];
  for (let index = 0; index < total; index += maxPerRow) {
    rows.push(
      Array.from({ length: Math.min(maxPerRow, total - index) }, (_, offset) => index + offset),
    );
  }
  return rows;
}

function getRowsHeight(rowCount: number, rowHeight: number, rowSpacing: number): number {
  if (rowCount === 0) {
    return 0;
  }

  return rowCount * rowHeight + Math.max(rowCount - 1, 0) * rowSpacing;
}

function getLinkRows(linkCount: number): number[][] {
  return chunkIndices(linkCount, WELCOME_SCREEN_LAYOUT.linksPerRow);
}

function estimateWrappedLineCount(text: string, maxCharsPerLine: number): number {
  const safeMaxChars = Math.max(1, maxCharsPerLine);
  return text.split('\n').reduce((total, rawLine) => {
    const line = rawLine.trim();
    if (line.length === 0) {
      return total + 1;
    }

    let lineCount = 1;
    let currentLineLength = 0;

    for (const segment of line.split(/\s+/)) {
      if (segment.length > safeMaxChars) {
        if (currentLineLength > 0) {
          lineCount += 1;
          currentLineLength = 0;
        }

        const wrappedSegments = Math.ceil(segment.length / safeMaxChars);
        lineCount += wrappedSegments - 1;
        currentLineLength = segment.length % safeMaxChars;
        continue;
      }

      const nextLength =
        currentLineLength === 0 ? segment.length : currentLineLength + 1 + segment.length;
      if (nextLength <= safeMaxChars) {
        currentLineLength = nextLength;
        continue;
      }

      lineCount += 1;
      currentLineLength = segment.length;
    }

    return total + lineCount;
  }, 0);
}

function getAlertBodyHeight(text: string): number {
  const lineCount = estimateWrappedLineCount(text, ALERT_LAYOUT.approxCharsPerLine);
  return Math.max(ALERT_LAYOUT.bodyMinHeight, lineCount * ALERT_LAYOUT.bodyLineHeight);
}

interface AlertDimensions {
  bodyHeight: number;
  bodyTopOffset: number;
  closeTopOffset: number;
  height: number;
}

function getAlertDimensions(alert: WelcomeAlert): AlertDimensions {
  const bodyTopOffset =
    ALERT_LAYOUT.titleTopOffset + ALERT_LAYOUT.titleHeight + ALERT_LAYOUT.bodyTopGap;
  const bodyHeight = getAlertBodyHeight(alert.text);
  const closeTopOffset = bodyTopOffset + bodyHeight + ALERT_LAYOUT.buttonTopGap;
  const height = Math.max(
    ALERT_LAYOUT.minHeight,
    closeTopOffset + ALERT_LAYOUT.closeHeight + ALERT_LAYOUT.closeBottomOffset,
  );

  return {
    bodyHeight,
    bodyTopOffset,
    closeTopOffset,
    height,
  };
}

interface TitleBlockMetrics {
  containerHeight: number;
  revealTop: number;
}

function getTitleBlockMetrics(links: WelcomeLink[]): TitleBlockMetrics {
  const buttonRows = getLinkRows(links.length);
  const buttonsDockHeight = getRowsHeight(
    buttonRows.length,
    WELCOME_SCREEN_LAYOUT.linkHeight,
    WELCOME_SCREEN_LAYOUT.linkRowSpacing,
  );
  const revealTop =
    WELCOME_SCREEN_LAYOUT.linksTopOffset +
    buttonsDockHeight +
    WELCOME_SCREEN_LAYOUT.revealExtraTopGap;

  return {
    revealTop,
    containerHeight:
      links.length > 0
        ? revealTop + WELCOME_SCREEN_LAYOUT.titleBlockRevealBottomPadding
        : WELCOME_SCREEN_LAYOUT.titleBlockBaseHeight,
  };
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

function renderLinkElement(modTag: string, index: number): string {
  const number = index + 1;
  return [
    'BUCKListElementDescriptor',
    '(',
    '    ComponentDescriptor = BUCKButtonDescriptor',
    '    (',
    `        ElementName = "MainMenuLink${number}${modTag}"`,
    '        ComponentFrame = TUIFramePropertyRTTI',
    '        (',
    `            MagnifiableWidthHeight = [${WELCOME_SCREEN_LAYOUT.linkWidth.toFixed(1)}, ${WELCOME_SCREEN_LAYOUT.linkHeight.toFixed(1)}]`,
    '        )',
    '        IsTogglable = true',
    '        DefaultToggleValue = false',
    '        CannotDeselect = false',
    '        HasBorder = true',
    '        BorderLineColorToken = "VertLogin"',
    '        BorderThicknessToken = "3"',
    '        HasBackground = true',
    '        BackgroundBlockColorToken = "loginBoutonBackground_vert"',
    '        LeftClickSound = SoundEvent_EnterMods',
    '        Components =',
    '        [',
    '            BUCKTextDescriptor',
    '            (',
    `                ElementName = "MainMenuLinkText${number}${modTag}"`,
    '                ComponentFrame = TUIFramePropertyRTTI',
    '                (',
    '                    RelativeWidthHeight = [1.0, 1.0]',
    '                )',
    '                ParagraphStyle = CenteredParagraphStyle',
    '                TextStyle = "TextStyleEcranMoniteur"',
    '                HorizontalFitStyle = ~/FitStyle/UserDefined',
    '                VerticalFitStyle = ~/FitStyle/UserDefined',
    '                TypefaceToken = "UISecondFont"',
    '                BigLineAction = ~/BigLineAction/ResizeFont',
    '                TextColor = "loginBlanc"',
    `                TextSize = "${WELCOME_SCREEN_TEXT.linkButtonTextSize}"`,
    '                TextDico = ~/LocalisationConstantes/dico_interface_outgame',
    `                TextToken = "${getLinkLabelToken(modTag, index)}"`,
    '            ),',
    '            BUCKSpecificHintableArea',
    '            (',
    `                ElementName = "MainMenuLinkHint${number}${modTag}"`,
    `                HintTitleToken = "${getLinkLabelToken(modTag, index)}"`,
    `                HintBodyToken = "${getLinkUrlToken(modTag, index)}"`,
    '                DicoToken = ~/LocalisationConstantes/dico_interface_outgame',
    '            )',
    '        ]',
    '    )',
    ')',
  ].join('\n');
}

function renderLinkRow(modTag: string, rowIndex: number, indices: number[]): string {
  const elements = indices.map((index) => renderLinkElement(modTag, index)).join(',\n');
  return [
    'BUCKListElementDescriptor',
    '(',
    '    ComponentDescriptor = BUCKListDescriptor',
    '    (',
    `        ElementName = "MainMenuLinkRow${rowIndex + 1}${modTag}"`,
    '        ComponentFrame = TUIFramePropertyRTTI',
    '        (',
    `            MagnifiableWidthHeight = [0.0, ${WELCOME_SCREEN_LAYOUT.linkHeight.toFixed(1)}]`,
    '            AlignementToAnchor = [0.5, 0.0]',
    '            AlignementToFather = [0.5, 0.0]',
    '        )',
    '        Axis = ~/ListAxis/Horizontal',
    '        BreadthComputationMode = ~/BreadthComputationMode/ComputeBreadthFromLargestChild',
    '        ChildFitToContent = true',
    `        InterItemMargin = TRTTILength(Magnifiable = ${WELCOME_SCREEN_LAYOUT.linkItemMargin.toFixed(1)})`,
    '        Elements =',
    '        [',
    indent(elements, 12),
    '        ]',
    '    )',
    ')',
  ].join('\n');
}

function renderLinksDock(modTag: string, links: WelcomeLink[]): string[] {
  if (links.length === 0) {
    return [];
  }

  const rows = getLinkRows(links.length);
  const totalHeight = getRowsHeight(
    rows.length,
    WELCOME_SCREEN_LAYOUT.linkHeight,
    WELCOME_SCREEN_LAYOUT.linkRowSpacing,
  );
  const elements = rows
    .map((indices, rowIndex) => renderLinkRow(modTag, rowIndex, indices))
    .join(',\n');

  return [
    '        BUCKListDescriptor',
    '        (',
    `            ElementName = "MainMenuLinks${modTag}"`,
    '            ComponentFrame = TUIFramePropertyRTTI',
    '            (',
    `                MagnifiableWidthHeight = [0.0, ${totalHeight.toFixed(1)}]`,
    `                MagnifiableOffset = [0.0, ${WELCOME_SCREEN_LAYOUT.linksTopOffset.toFixed(1)}]`,
    '                AlignementToAnchor = [0.5, 0.0]',
    '                AlignementToFather = [0.5, 0.0]',
    '            )',
    '            Axis = ~/ListAxis/Vertical',
    '            BreadthComputationMode = ~/BreadthComputationMode/ComputeBreadthFromLargestChild',
    '            ChildFitToContent = true',
    `            InterItemMargin = TRTTILength(Magnifiable = ${WELCOME_SCREEN_LAYOUT.linkRowSpacing.toFixed(1)})`,
    '            Elements =',
    '            [',
    indent(elements, 16),
    '            ]',
    '        ),',
  ];
}

function renderRevealPanel(modTag: string, index: number, revealTop: number): string {
  const number = index + 1;
  return [
    '        BUCKTranslationAnimatedContainerDescriptor',
    '        (',
    `            ElementName = "MainMenuLinkReveal${number}${modTag}"`,
    `            ButtonNameForTrigger = "MainMenuLink${number}${modTag}"`,
    '            FramePropertyBeforeAnimation = TUIFramePropertyRTTI',
    '            (',
    `                MagnifiableWidthHeight = [${WELCOME_SCREEN_LAYOUT.revealWidth.toFixed(1)}, ${WELCOME_SCREEN_LAYOUT.revealHeight.toFixed(1)}]`,
    `                MagnifiableOffset = [0.0, ${WELCOME_SCREEN_LAYOUT.revealHiddenTop.toFixed(1)}]`,
    '                AlignementToAnchor = [0.5, 0.0]',
    '                AlignementToFather = [0.5, 0.0]',
    '            )',
    '            AnimationTotalDuration = 0.15',
    '            FramePropertyAfterAnimation = TUIFramePropertyRTTI',
    '            (',
    `                MagnifiableWidthHeight = [${WELCOME_SCREEN_LAYOUT.revealWidth.toFixed(1)}, ${WELCOME_SCREEN_LAYOUT.revealHeight.toFixed(1)}]`,
    `                MagnifiableOffset = [0.0, ${revealTop.toFixed(1)}]`,
    '                AlignementToAnchor = [0.5, 0.0]',
    '                AlignementToFather = [0.5, 0.0]',
    '            )',
    '            Components =',
    '            [',
    '                BUCKContainerDescriptor',
    '                (',
    `                    ElementName = "MainMenuLinkRevealPanel${number}${modTag}"`,
    '                    ComponentFrame = TUIFramePropertyRTTI',
    '                    (',
    '                        RelativeWidthHeight = [1.0, 1.0]',
    '                    )',
    '                    HasBackground = true',
    '                    BackgroundBlockColorToken = "Black80"',
    '                    HasBorder = true',
    '                    BorderLineColorToken = "VertLogin"',
    '                    BorderThicknessToken = "2"',
    '                    Components =',
    '                    [',
    ...indentLines(renderModalBlocker(`MainMenuLinkRevealBlocker${number}${modTag}`), 24),
    '                        BUCKTextDescriptor',
    '                        (',
    `                            ElementName = "MainMenuLinkRevealText${number}${modTag}"`,
    '                            ComponentFrame = TUIFramePropertyRTTI',
    '                            (',
    '                                RelativeWidthHeight = [1.0, 1.0]',
    '                            )',
    '                            ParagraphStyle = TParagraphStyle',
    '                            (',
    '                                VerticalAlignment = ~/UIText_VerticalCenter',
    '                                Alignment = ~/UIText_Center',
    '                            )',
    '                            HorizontalFitStyle = ~/FitStyle/UserDefined',
    '                            VerticalFitStyle = ~/FitStyle/UserDefined',
    '                            BigLineAction = ~/BigLineAction/ResizeFont',
    '                            TextStyle = "Default"',
    '                            TypefaceToken = "UIMainFont"',
    '                            TextColor = "loginBlanc"',
    `                            TextSize = "${WELCOME_SCREEN_TEXT.linkRevealTextSize}"`,
    '                            TextDico = ~/LocalisationConstantes/dico_interface_outgame',
    `                            TextToken = "${getLinkUrlToken(modTag, index)}"`,
    '                            TextPadding = TRTTILength4(Magnifiable = [16.0, 0.0, 16.0, 0.0])',
    '                        )',
    '                    ]',
    '                )',
    '            ]',
    '        ),',
  ].join('\n');
}

function renderTitleElement(modTag: string): string[] {
  return [
    '        BUCKTextDescriptor',
    '        (',
    `            ElementName = "MainMenuTitle${modTag}"`,
    '            ComponentFrame = TUIFramePropertyRTTI',
    '            (',
    '                RelativeWidthHeight = [1.0, 0.0]',
    `                MagnifiableWidthHeight = [0.0, ${WELCOME_SCREEN_LAYOUT.titleHeight.toFixed(1)}]`,
    '                AlignementToAnchor = [0.5, 0.0]',
    '                AlignementToFather = [0.5, 0.0]',
    '            )',
    '            ParagraphStyle = TParagraphStyle',
    '            (',
    '                VerticalAlignment = ~/UIText_VerticalCenter',
    '                Alignment = ~/UIText_Center',
    '            )',
    '            TextColor = "ListeExcel/Cartouche"',
    `            TextSize  = "${WELCOME_SCREEN_TEXT.titleTextSize}"`,
    '            TextStyle = "Default"',
    '            TypefaceToken = "UIMainFont"',
    '            TextDico = ~/LocalisationConstantes/dico_interface_outgame',
    `            TextToken = "${getRuntimeToken(modTag, TOKEN_SUFFIXES.title)}"`,
    '            Components =',
    '            [',
    '                BUCKSpecificHintableArea',
    '                (',
    `                    HintTitleToken = "${getRuntimeToken(modTag, TOKEN_SUFFIXES.hoverTitle)}"`,
    '                    DicoToken = ~/LocalisationConstantes/dico_interface_outgame',
    '                ),',
    '            ]',
    '        ),',
  ];
}

function renderModalBlocker(elementName: string): string[] {
  return [
    'BUCKButtonDescriptor',
    '(',
    `    ElementName = "${elementName}"`,
    '    ComponentFrame = TUIFramePropertyRTTI',
    '    (',
    '        RelativeWidthHeight = [1.0, 1.0]',
    '    )',
    '    HasBackground = false',
    '    HasBorder = false',
    '),',
  ];
}

function renderAlertTitleText(modTag: string): string[] {
  return [
    'BUCKTextDescriptor',
    '(',
    `    ElementName = "MainMenuAlertTitle${modTag}"`,
    '    ComponentFrame = TUIFramePropertyRTTI',
    '    (',
    `        MagnifiableWidthHeight = [0.0, ${ALERT_LAYOUT.titleHeight.toFixed(1)}]`,
    `        MagnifiableOffset = [0.0, ${ALERT_LAYOUT.titleTopOffset.toFixed(1)}]`,
    '        RelativeWidthHeight = [1.0, 0.0]',
    '        AlignementToAnchor = [0.5, 0.0]',
    '        AlignementToFather = [0.5, 0.0]',
    '    )',
    '    ParagraphStyle = TParagraphStyle',
    '    (',
    '        VerticalAlignment = ~/UIText_VerticalCenter',
    '        Alignment = ~/UIText_Center',
    '    )',
    '    HorizontalFitStyle = ~/FitStyle/UserDefined',
    '    VerticalFitStyle = ~/FitStyle/UserDefined',
    '    BigLineAction = ~/BigLineAction/ResizeFont',
    '    TextStyle = "Default"',
    '    TypefaceToken = "UIMainFont"',
    '    TextColor = "loginBlanc"',
    `    TextSize = "${ALERT_TEXT.titleSize}"`,
    '    TextDico = ~/LocalisationConstantes/dico_interface_outgame',
    `    TextToken = "${getRuntimeToken(modTag, TOKEN_SUFFIXES.alertTitle)}"`,
    '    TextFormatScript = nil',
    '),',
  ];
}

function renderAlertBodyText(modTag: string, alertDimensions: AlertDimensions): string[] {
  return [
    'BUCKTextDescriptor',
    '(',
    `    ElementName = "MainMenuAlertBody${modTag}"`,
    '    ComponentFrame = TUIFramePropertyRTTI',
    '    (',
    `        MagnifiableWidthHeight = [0.0, ${alertDimensions.bodyHeight.toFixed(1)}]`,
    `        MagnifiableOffset = [0.0, ${alertDimensions.bodyTopOffset.toFixed(1)}]`,
    '        RelativeWidthHeight = [1.0, 0.0]',
    '        AlignementToAnchor = [0.5, 0.0]',
    '        AlignementToFather = [0.5, 0.0]',
    '    )',
    '    ParagraphStyle = TParagraphStyle',
    '    (',
    '        VerticalAlignment = ~/UIText_VerticalCenter',
    '        Alignment = ~/UIText_Left',
    '        Balanced = true',
    '        BigWordAction = ~/BigWordAction/BigWordNewLine',
    '    )',
    '    HorizontalFitStyle = ~/FitStyle/UserDefined',
    '    VerticalFitStyle = ~/FitStyle/UserDefined',
    '    BigLineAction = ~/BigLineAction/MultiLine',
    '    TextStyle = "Default"',
    '    TypefaceToken = "UIMainFont"',
    '    TextColor = "loginBlanc"',
    `    TextSize = "${ALERT_TEXT.bodySize}"`,
    '    TextDico = ~/LocalisationConstantes/dico_interface_outgame',
    `    TextToken = "${getRuntimeToken(modTag, TOKEN_SUFFIXES.alertBody)}"`,
    '    TextFormatScript = nil',
    '    TextPadding = TRTTILength4(Magnifiable = [34.0, 0.0, 34.0, 0.0])',
    '),',
  ];
}

function renderAlertCloseButton(
  modTag: string,
  closeButtonName: string,
  alertDimensions: AlertDimensions,
): string[] {
  return [
    'BUCKButtonDescriptor',
    '(',
    `    ElementName = "${closeButtonName}"`,
    '    ComponentFrame = TUIFramePropertyRTTI',
    '    (',
    `        MagnifiableWidthHeight = [${ALERT_LAYOUT.closeWidth.toFixed(1)}, ${ALERT_LAYOUT.closeHeight.toFixed(1)}]`,
    `        MagnifiableOffset = [0.0, ${alertDimensions.closeTopOffset.toFixed(1)}]`,
    '        AlignementToAnchor = [0.5, 0.0]',
    '        AlignementToFather = [0.5, 0.0]',
    '    )',
    '    IsTogglable = true',
    '    DefaultToggleValue = false',
    '    CannotDeselect = false',
    '    HasBorder = true',
    '    BorderLineColorToken = "VertLogin"',
    '    BorderThicknessToken = "3"',
    '    HasBackground = true',
    '    BackgroundBlockColorToken = "loginBoutonBackground_vert"',
    '    LeftClickSound = SoundEvent_EnterMods',
    '    Components =',
    '    [',
    '        BUCKTextDescriptor',
    '        (',
    `            ElementName = "MainMenuAlertCloseText${modTag}"`,
    '            ComponentFrame = TUIFramePropertyRTTI',
    '            (',
    '                RelativeWidthHeight = [1.0, 1.0]',
    '            )',
    '            ParagraphStyle = CenteredParagraphStyle',
    '            TextStyle = "Default"',
    '            HorizontalFitStyle = ~/FitStyle/UserDefined',
    '            VerticalFitStyle = ~/FitStyle/UserDefined',
    '            TypefaceToken = "UISecondFont"',
    '            BigLineAction = ~/BigLineAction/ResizeFont',
    '            TextColor = "loginBlanc"',
    `            TextSize = "${ALERT_TEXT.closeSize}"`,
    '            TextDico = ~/LocalisationConstantes/dico_interface_outgame',
    `            TextToken = "${getRuntimeToken(modTag, TOKEN_SUFFIXES.alertClose)}"`,
    '            TextFormatScript = nil',
    '        )',
    '    ]',
    ')',
  ];
}

function renderAlertModal(modTag: string, alert: WelcomeAlert | undefined): string[] {
  if (!alert) {
    return [];
  }

  const closeButtonName = `MainMenuAlertClose${modTag}`;
  const alertDimensions = getAlertDimensions(alert);
  return [
    '        BUCKTranslationAnimatedContainerDescriptor',
    '        (',
    `            ElementName = "MainMenuAlert${modTag}"`,
    `            ButtonNameForTrigger = "${closeButtonName}"`,
    '            FramePropertyBeforeAnimation = TUIFramePropertyRTTI',
    '            (',
    `                MagnifiableWidthHeight = [${ALERT_LAYOUT.width.toFixed(1)}, ${alertDimensions.height.toFixed(1)}]`,
    `                MagnifiableOffset = [0.0, ${ALERT_LAYOUT.visibleOffsetY.toFixed(1)}]`,
    '                AlignementToAnchor = [0.5, 0.5]',
    '                AlignementToFather = [0.5, 0.5]',
    '            )',
    '            AnimationTotalDuration = 0.20',
    '            FramePropertyAfterAnimation = TUIFramePropertyRTTI',
    '            (',
    `                MagnifiableWidthHeight = [${ALERT_LAYOUT.width.toFixed(1)}, ${alertDimensions.height.toFixed(1)}]`,
    `                MagnifiableOffset = [0.0, ${ALERT_LAYOUT.hiddenOffsetY.toFixed(1)}]`,
    '                AlignementToAnchor = [0.5, 0.5]',
    '                AlignementToFather = [0.5, 0.5]',
    '            )',
    '            Components =',
    '            [',
    '                BUCKContainerDescriptor',
    '                (',
    `                    ElementName = "MainMenuAlertPanel${modTag}"`,
    '                    ComponentFrame = TUIFramePropertyRTTI',
    '                    (',
    '                        RelativeWidthHeight = [1.0, 1.0]',
    '                    )',
    '                    HasBackground = true',
    '                    BackgroundBlockColorToken = "Black80"',
    '                    HasBorder = true',
    '                    BorderLineColorToken = "VertLogin"',
    '                    BorderThicknessToken = "3"',
    '                    Components =',
    '                    [',
    ...indentLines(renderModalBlocker(`MainMenuAlertPanelBlocker${modTag}`), 24),
    ...indentLines(renderAlertTitleText(modTag), 24),
    ...indentLines(renderAlertBodyText(modTag, alertDimensions), 24),
    ...indentLines(renderAlertCloseButton(modTag, closeButtonName, alertDimensions), 24),
    '                    ]',
    '                )',
    '            ]',
    '        ),',
  ];
}

function renderTitleBlock(modTag: string, links: WelcomeLink[]): string[] {
  const { containerHeight, revealTop } = getTitleBlockMetrics(links);

  return [
    '        BUCKContainerDescriptor',
    '        (',
    `            ElementName = "MainMenuTitleBlock${modTag}"`,
    '            ComponentFrame = TUIFramePropertyRTTI',
    '            (',
    `                MagnifiableWidthHeight = [${WELCOME_SCREEN_LAYOUT.titleBlockWidth.toFixed(1)}, ${containerHeight.toFixed(1)}]`,
    `                MagnifiableOffset = [0.0, ${WELCOME_SCREEN_LAYOUT.titleBlockTopOffset.toFixed(1)}]`,
    '                AlignementToAnchor = [0.5, 0.0]',
    '                AlignementToFather = [0.5, 0.0]',
    '            )',
    '            Components =',
    '            [',
    ...indentLines(renderTitleElement(modTag), 16),
    ...indentLines(renderLinksDock(modTag, links), 16),
    ...links.flatMap((_, index) => indentLines(renderRevealPanel(modTag, index, revealTop), 16)),
    '            ]',
    '        ),',
  ];
}

function renderWelcomeComponent(
  modTag: string,
  links: WelcomeLink[],
  alert: WelcomeAlert | undefined,
): string {
  const lines = [
    'BUCKContainerDescriptor',
    '(',
    `    ElementName = "MainMenuWelcomeRoot${modTag}"`,
    '    ComponentFrame = TUIFramePropertyRTTI',
    '    (',
    '        RelativeWidthHeight = [1.0, 1.0]',
    '    )',
    '    Components =',
    '    [',
    ...renderTitleBlock(modTag, links),
    ...renderAlertModal(modTag, alert),
    '    ]',
    ')',
  ];

  return lines.join('\n');
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

export default async function generateWelcomeScreen(
  context: WelcomeScreenContext,
): Promise<GeneratedScriptFile> {
  const modTag = getString(context.variables.modTag, 'MOD');
  const modVersion = getString(context.variables.modVersion, '1.0');
  const author = getString(context.variables.author, '');
  const modName = context.mod.config.name;
  const links = getLinks(context.variables.links);
  const alert = getAlert(context.variables.alert);

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
  return generatedOutput;
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
