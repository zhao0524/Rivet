import type { AssemblyPlan, DimensionsByCatalogId } from '../types';

// Copied from docs/implementation.md Appendix A.2 (`rover_obstacle_v1`), trimmed to the
// fields this module reads. Synthetic, not sourced hardware. Replace with an import of
// `fixtures/plans/rover_obstacle_v1.json` once fixtures/ is merged.
const roverPlanJson = {
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
      }
    }
  ],
  "assembly_steps": [
    {
      "step": 1,
      "title": "Mount the chassis",
      "instance_ids": [
        "chassis-1"
      ],
      "instructions": "Mount the chassis; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 2,
      "title": "Attach the motors",
      "instance_ids": [
        "motor-left-1",
        "motor-right-1"
      ],
      "instructions": "Attach the motors; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 3,
      "title": "Install the wheels and caster",
      "instance_ids": [
        "wheel-left-1",
        "wheel-right-1",
        "caster-1"
      ],
      "instructions": "Install the wheels and caster; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 4,
      "title": "Place controller and driver",
      "instance_ids": [
        "controller-1",
        "driver-1"
      ],
      "instructions": "Place controller and driver; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 5,
      "title": "Mount the sensor",
      "instance_ids": [
        "sensor-1"
      ],
      "instructions": "Mount the sensor; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 6,
      "title": "Position the power supplies",
      "instance_ids": [
        "power-motor-1",
        "power-control-1"
      ],
      "instructions": "Position the power supplies; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 7,
      "title": "Inspect wiring",
      "instance_ids": [
        "controller-1",
        "driver-1",
        "sensor-1"
      ],
      "instructions": "Inspect wiring; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 8,
      "title": "Review assembly",
      "instance_ids": [
        "chassis-1",
        "controller-1"
      ],
      "instructions": "Review assembly; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    }
  ]
};

export const roverPlan: AssemblyPlan = roverPlanJson;

// Appendix A.1 `physical.dimensions_mm`.
export const roverDimensions: DimensionsByCatalogId = {
  "demo.chassis_2wd": {
    "x": 140,
    "y": 12,
    "z": 180
  },
  "demo.tt_motor": {
    "x": 65,
    "y": 24,
    "z": 22
  },
  "demo.wheel": {
    "x": 65,
    "y": 18,
    "z": 65
  },
  "demo.caster": {
    "x": 28,
    "y": 28,
    "z": 28
  },
  "demo.esp32": {
    "x": 55,
    "y": 8,
    "z": 28
  },
  "demo.tb6612": {
    "x": 30,
    "y": 7,
    "z": 25
  },
  "demo.range": {
    "x": 22,
    "y": 8,
    "z": 16
  },
  "demo.motor_power": {
    "x": 58,
    "y": 24,
    "z": 60
  },
  "demo.controller_power": {
    "x": 45,
    "y": 14,
    "z": 40
  }
};
