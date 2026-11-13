import assert from 'node:assert/strict';
import type { BuildScriptTest } from 'ymb/api';
import { findDuplicateModules } from './entity-modules.ts';

const test: BuildScriptTest = ({ tools: { ndf } }) => {
  const source = `
    Capacity is TCapaciteModuleDescriptor()
    export Entity_Example is TEntityDescriptor(
      ModulesDescriptors = [
        TCapaciteModuleDescriptor(),
        ~/Capacity,
        TDeploymentShiftModuleDescriptor(),
        TDeploymentShiftModuleDescriptor(),
        $/GFX/Weapon/BaseWeapon,
        $/GFX/Weapon/YsmWeapon,
      ]
    )
    export Descriptor_Unit_Base is TEntityDescriptor(
      ModulesDescriptors = [TCapaciteModuleDescriptor(), TCapaciteModuleDescriptor()]
    )
  `;
  assert.deepEqual(
    findDuplicateModules(
      ndf,
      source,
      (name) => name.startsWith('Entity_'),
      new Map([
        ['$/GFX/Weapon/BaseWeapon', 'TWeaponManagerModuleDescriptor'],
        ['$/GFX/Weapon/YsmWeapon', 'TWeaponManagerModuleDescriptor'],
      ]),
    ),
    [
      'Entity_Example: TCapaciteModuleDescriptor',
      'Entity_Example: TDeploymentShiftModuleDescriptor',
      'Entity_Example: TWeaponManagerModuleDescriptor',
    ],
  );
  assert.deepEqual(
    findDuplicateModules(
      ndf,
      `
    export Entity_Valid is TEntityDescriptor(
      ModulesDescriptors = [
        TCapaciteModuleDescriptor(),
        // TCapaciteModuleDescriptor(),
        TDeploymentShiftModuleDescriptor(),
        ~/FacingInfosModuleDescriptor,
      ]
    )
  `,
      (name) => name.startsWith('Entity_'),
    ),
    [],
  );
  return {
    results: [{ name: 'Entity module uniqueness includes resolved references', status: 'passed' }],
  };
};

export default test;
