/**
 * Test-local copy of the synthetic Appendix A fixtures (docs/implementation.md A.1/A.2), reduced to the
 * fields this module reads. Replace with imports from `fixtures/` once the shared bootstrap lands.
 */
import type { PartCatalogItem, PartPlan } from '../types';

export const roverCatalog: PartCatalogItem[] = [
  {
    "catalog_id": "demo.chassis_2wd",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "2WD Chassis",
      "sku": null,
      "category": "chassis"
    },
    "physical": {
      "dimensions_mm": {
        "x": 140,
        "y": 12,
        "z": 180
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "polymer"
    }
  },
  {
    "catalog_id": "demo.tt_motor",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Gear Motor",
      "sku": null,
      "category": "motor"
    },
    "physical": {
      "dimensions_mm": {
        "x": 65,
        "y": 24,
        "z": 22
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "metal"
    }
  },
  {
    "catalog_id": "demo.wheel",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Rubber Wheel",
      "sku": null,
      "category": "wheel"
    },
    "physical": {
      "dimensions_mm": {
        "x": 65,
        "y": 18,
        "z": 65
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "rubber"
    }
  },
  {
    "catalog_id": "demo.caster",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Rear Caster",
      "sku": null,
      "category": "caster"
    },
    "physical": {
      "dimensions_mm": {
        "x": 28,
        "y": 28,
        "z": 28
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "metal"
    }
  },
  {
    "catalog_id": "demo.esp32",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "ESP32 Board",
      "sku": null,
      "category": "controller"
    },
    "physical": {
      "dimensions_mm": {
        "x": 55,
        "y": 8,
        "z": 28
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "pcb"
    }
  },
  {
    "catalog_id": "demo.tb6612",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Motor Driver",
      "sku": null,
      "category": "motor_driver"
    },
    "physical": {
      "dimensions_mm": {
        "x": 30,
        "y": 7,
        "z": 25
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "pcb"
    }
  },
  {
    "catalog_id": "demo.range",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Front Range Sensor",
      "sku": null,
      "category": "distance_sensor"
    },
    "physical": {
      "dimensions_mm": {
        "x": 22,
        "y": 8,
        "z": 16
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "pcb"
    }
  },
  {
    "catalog_id": "demo.motor_power",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Motor Supply",
      "sku": null,
      "category": "power_supply"
    },
    "physical": {
      "dimensions_mm": {
        "x": 58,
        "y": 24,
        "z": 60
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "polymer"
    }
  },
  {
    "catalog_id": "demo.controller_power",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Controller Supply",
      "sku": null,
      "category": "power_supply"
    },
    "physical": {
      "dimensions_mm": {
        "x": 45,
        "y": 14,
        "z": 40
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "polymer"
    }
  }
];

export const roverPlan: PartPlan = {
  "schema_version": "1.0",
  "build_id": "rivet-synthetic-rover-fixture",
  "revision": 1,
  "components": [
    {
      "instance_id": "chassis-1",
      "catalog_id": "demo.chassis_2wd",
      "role": "chassis",
      "parent_instance_id": null,
      "attached_to_mount_id": null,
      "own_mount_id": null,
      "pose": {
        "position_mm": [
          0,
          10,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#343942"
      }
    },
    {
      "instance_id": "motor-left-1",
      "catalog_id": "demo.tt_motor",
      "role": "motor",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "motor_left",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          -56,
          20,
          25
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#A6A9AE"
      }
    },
    {
      "instance_id": "motor-right-1",
      "catalog_id": "demo.tt_motor",
      "role": "motor",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "motor_right",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          56,
          20,
          25
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#A6A9AE"
      }
    },
    {
      "instance_id": "wheel-left-1",
      "catalog_id": "demo.wheel",
      "role": "wheel",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "wheel_left",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          -78,
          20,
          25
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#26292B"
      }
    },
    {
      "instance_id": "wheel-right-1",
      "catalog_id": "demo.wheel",
      "role": "wheel",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "wheel_right",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          78,
          20,
          25
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#26292B"
      }
    },
    {
      "instance_id": "caster-1",
      "catalog_id": "demo.caster",
      "role": "caster",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "caster_rear",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          0,
          2,
          -62
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#C1C8CC"
      }
    },
    {
      "instance_id": "controller-1",
      "catalog_id": "demo.esp32",
      "role": "controller",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "controller_deck",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          -25,
          29,
          -15
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#1C5746"
      }
    },
    {
      "instance_id": "driver-1",
      "catalog_id": "demo.tb6612",
      "role": "motor_driver",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "driver_deck",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          28,
          29,
          -10
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#1C5746"
      }
    },
    {
      "instance_id": "sensor-1",
      "catalog_id": "demo.range",
      "role": "distance_sensor",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "front_sensor",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          0,
          35,
          81
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#1C5746"
      }
    },
    {
      "instance_id": "power-motor-1",
      "catalog_id": "demo.motor_power",
      "role": "power_supply",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "power_deck",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          0,
          27,
          -46
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#4B5563"
      }
    },
    {
      "instance_id": "power-control-1",
      "catalog_id": "demo.controller_power",
      "role": "power_supply",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "power_usb",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          0,
          42,
          -35
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#4B5563"
      }
    }
  ]
};
