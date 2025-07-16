import fs from 'fs';

console.log('\n\n\nThis script will process all units and buildings in the game and create DivisionRules for YSM');
console.log('\n\n\nUpdated: July 17, 2025');
console.log('\n\n\n');

console.log('Looking for files...');

// ? Paths
const buildingsFile = fs.readFileSync('../GameData/Generated/Gameplay/Gfx/BuildingDescriptors.ndf', 'utf8');
const unitsFile = fs.readFileSync('../GameData/Generated/Gameplay/Gfx/UniteDescriptor.ndf', 'utf8');

if (!buildingsFile || !unitsFile) throw new Error('Required files not found.\nCheck the paths.');

console.log('\n\n\n');

console.log('Parsing buildings...');

/**
 * [ string, string[] ]
 * [ name, tags ]
 */
const buildings = [];
function parseBuildings() {
    const lines = buildingsFile.split('\n');
    for (const [i, line] of lines.entries()) {
        if (!line?.length) continue;

        if (line.match(/export Descriptor_Unit_.+ is TEntityDescriptor/g)) {
            if (lines[i - 1].match(/ysm ignore/g)) {
                console.log('Skipping ' + line.trim().split(' ')[1]);
                continue;
            }
            buildings.push([line.trim().split(' ')[1], []]);
        }
    }
}
parseBuildings();

console.log('\n\n\n');

console.log('Parsing units...');

/**
 * [ string, string[] ]
 * [ name, tags ]
 */
const units = [];

/**
 * { [string]: string[] }
 * [ [tag]: units ]
 */
const transports = {};

function parseUnits() {
    let name = '';

    let tags = [];
    let ignoreTags = true;

    let isInTransporter = false;
    let isInTags = false;

    function reset() {
        name = '';
        tags = [];
        ignoreTags = true;
        isInTransporter = false;
        isInTags = false;
    }

    function trim(s) {
        return s.replaceAll(/[",]+/g, '').replaceAll(' ', '');
    }

    const lines = unitsFile.split('\n');
    for (const [i, line] of lines.entries()) {
        if (!line?.length) continue;

        if (line.match(/export Descriptor_Unit_.+ is TEntityDescriptor/g)) {
            reset();
            if (lines[i - 1].match(/ysm ignore/g)) {
                console.log('Skipping ' + line.trim().split(' ')[1]);
                continue;
            }
            name = line.trim().split(' ')[1];
        } else if (name) {
            if (line[0] === ')') {
                if (!name) continue;
                units.push([name, ignoreTags ? [] : tags]);
                reset();
            } else if (isInTags) {
                if (line.match(/]/g)) isInTags = false;
                else tags.push(trim(line));
            } else if (isInTransporter) {
                if (line.match(/]/g)) isInTransporter = false;
                else {
                    const tag = trim(line);
                    if (!(tag in transports)) transports[tag] = [];
                    transports[tag].push(name);
                }
            } else if (line.match(/TTransportableModuleDescriptor/g)) ignoreTags = false;
            else if (line.match(/TransportableTagSet[\s]+=/g)) isInTransporter = true;
            else if (line.match(/TagSet =/g)) isInTags = true;
        }
    }
}
parseUnits();

console.log('\n\n\n');

console.log('Making rules...');

const unlimitedRules = [];
const limitedRules = [];

function addRule([name, tags]) {
    const availableTransports = [];
    tags.forEach((tag) => {
        transports[tag]?.forEach((name) => {
            name = `$/GFX/Unit/${name}`;
            if (!availableTransports.includes(name)) availableTransports.push(name);
        });
    });
    const availableTransportsString = availableTransports.sort().join(',') || '';

    const transportLine = availableTransportsString
        ? `\n        AvailableTransportList = [${availableTransportsString}]`
        : '';

    const unlimitedRule =
        '    TDeckUniteRule' +
        '\n    (' +
        `\n        UnitDescriptor = $/GFX/Unit/${name}` +
        '\n        AvailableWithoutTransport = True' +
        transportLine +
        '\n        MaxPackNumber = 70' +
        '\n        NumberOfUnitInPack = 999' +
        '\n        NumberOfUnitInPackXPMultiplier = [1.0, 1.0, 1.0, 1.0]' +
        '\n    )';

    const limitedRule =
        '    TDeckUniteRule' +
        '\n    (' +
        `\n        UnitDescriptor = $/GFX/Unit/${name}` +
        '\n        AvailableWithoutTransport = True' +
        transportLine +
        '\n        MaxPackNumber = 10' +
        '\n        NumberOfUnitInPack = 10' +
        '\n        NumberOfUnitInPackXPMultiplier = [1.0, 0.7, 0.4, 0.1]' +
        '\n    )';

    unlimitedRules.push(unlimitedRule);
    limitedRules.push(limitedRule);
}

buildings.forEach((building) => addRule(building));
units.forEach((unit) => addRule(unit));

console.log('\n\n\n');

console.log('Generating code...');

const txt =
    '\n\n\n\n// Updated by YSM (added) | DIVISION RULES' +
    '\n// YSM Tools/generateDivisionRules.js' +
    '\n\nDescriptor_Deck_Division_YSM_UNLIMITED is TDeckDivisionRule' +
    '\n(' +
    '\n    UnitRuleList = UnlimitedRuleListYSM' +
    '\n)' +
    '\nDescriptor_Deck_Division_YSM_LIMITED is TDeckDivisionRule' +
    '\n(' +
    '\n    UnitRuleList = LimitedRuleListYSM' +
    '\n)' +
    '\n\n\nUnlimitedRuleListYSM is' +
    '\n[' +
    '\n' +
    unlimitedRules.join(',\n') +
    '\n]' +
    '\n\nLimitedRuleListYSM is' +
    '\n[' +
    '\n' +
    limitedRules.join(',\n') +
    '\n]';

console.log('\n\n\n');

console.log('Saving to a txt file...');

fs.writeFileSync('./rules.txt', txt);

console.log('\n\n\n');

console.log('Done!');
console.log('Add generated code to the DivisionRules.ndf file');

console.log('\n');
