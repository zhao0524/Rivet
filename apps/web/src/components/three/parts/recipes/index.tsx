import type { ComponentType } from 'react';
import { kindForCatalogPreset } from '../materials';
import type { PartCatalogItem, PartSide, PlanComponentOccurrence, RecipeProps, Size3 } from '../types';
import { CasterRecipe } from './Caster';
import { ChassisRecipe } from './Chassis';
import { Esp32BoardRecipe } from './Esp32Board';
import { GenericPartRecipe, UnknownPartRecipe } from './Fallback';
import { MotorDriverBoardRecipe } from './MotorDriverBoard';
import { BatteryPackRecipe, UsbPowerBankRecipe } from './PowerPack';
import { TTMotorRecipe } from './TTMotor';
import { UltrasonicSensorRecipe } from './UltrasonicSensor';
import { WheelRecipe } from './Wheel';

export type RecipeId =
  | 'chassis_2wd'
  | 'tt_motor'
  | 'wheel'
  | 'caster'
  | 'esp32_devkit'
  | 'tb6612_driver'
  | 'ultrasonic_sensor'
  | 'battery_pack'
  | 'usb_power_bank'
  | 'generic'
  | 'unknown';

export const RECIPES: Record<RecipeId, ComponentType<RecipeProps>> = {
  chassis_2wd: ChassisRecipe,
  tt_motor: TTMotorRecipe,
  wheel: WheelRecipe,
  caster: CasterRecipe,
  esp32_devkit: Esp32BoardRecipe,
  tb6612_driver: MotorDriverBoardRecipe,
  ultrasonic_sensor: UltrasonicSensorRecipe,
  battery_pack: BatteryPackRecipe,
  usb_power_bank: UsbPowerBankRecipe,
  generic: (props) => <GenericPartRecipe {...props} kind={kindForCatalogPreset(props.catalogItem?.physical?.material_preset)} />,
  unknown: UnknownPartRecipe,
};

/** Explicit catalog_id → recipe bindings; take precedence over category matching. */
export const CATALOG_RECIPES: Readonly<Record<string, RecipeId>> = {};

export const UNKNOWN_PART_SIZE: Size3 = { x: 20, y: 20, z: 20 };

const CATEGORY_RECIPES: ReadonlyArray<[RegExp, RecipeId]> = [
  [/chassis|frame|base_plate/, 'chassis_2wd'],
  [/motor_driver|driver|h_bridge/, 'tb6612_driver'],
  [/motor/, 'tt_motor'],
  [/wheel|tire|tyre/, 'wheel'],
  [/caster/, 'caster'],
  [/controller|microcontroller|mcu|board/, 'esp32_devkit'],
  [/distance|ultrasonic|range|sonar/, 'ultrasonic_sensor'],
];

export function resolveRecipe(component: PlanComponentOccurrence, item: PartCatalogItem | undefined): RecipeId {
  if (!item) return 'unknown';
  const explicit = CATALOG_RECIPES[item.catalog_id];
  if (explicit) return explicit;
  const category = `${item.identity?.category ?? ''}`.toLowerCase();
  const role = `${component.role ?? ''}`.toLowerCase();
  for (const probe of [category, role]) {
    if (!probe) continue;
    if (/power|battery/.test(probe)) return powerVariant(item, component);
    const hit = CATEGORY_RECIPES.find(([re]) => re.test(probe));
    if (hit) return hit[1];
  }
  return 'generic';
}

function powerVariant(item: PartCatalogItem, component: PlanComponentOccurrence): RecipeId {
  const text = `${item.catalog_id} ${item.identity?.model ?? ''} ${component.attached_to_mount_id ?? ''}`.toLowerCase();
  if (/usb|bank|controller/.test(text)) return 'usb_power_bank';
  const s = item.physical?.dimensions_mm;
  if (s && s.y < 0.4 * Math.min(s.x, s.z)) return 'usb_power_bank';
  return 'battery_pack';
}

/** Left/right from mount or instance naming, otherwise from the sign of the pose X (x is rover-right). */
export function resolveSide(component: PlanComponentOccurrence): PartSide {
  const text = `${component.attached_to_mount_id ?? ''} ${component.instance_id}`.toLowerCase();
  if (/left/.test(text)) return 'left';
  if (/right/.test(text)) return 'right';
  const x = component.pose.position_mm[0];
  if (x < -1e-6) return 'left';
  if (x > 1e-6) return 'right';
  return 'center';
}

export function resolveSize(item: PartCatalogItem | undefined): Size3 {
  const d = item?.physical?.dimensions_mm;
  if (d && [d.x, d.y, d.z].every((v) => Number.isFinite(v) && v > 0)) return { x: d.x, y: d.y, z: d.z };
  return UNKNOWN_PART_SIZE;
}
