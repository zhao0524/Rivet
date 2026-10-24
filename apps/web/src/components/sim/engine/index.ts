/**
 * Rivet rover simulation engine: a simplified 2D differential-drive kinematic approximation.
 * Not a physics model and not a hardware safety certification. No React/Canvas/UI here.
 */
export * from "./types";
export { FIXED_DT_S, FIXED_STEP_HZ, MAX_FRAME_DT_S, SimConfigError, resolveSimParams, type SimParams } from "./params";
export { DEFAULT_SENSOR_RAY_COUNT, raycastFrontSensor, sensorRayAngles } from "./sensor";
export { bodyVelocity, integratePose, type BodyVelocity } from "./kinematics";
export { decideBehavior } from "./behavior";
export { arenaWalls, normalizeAngle } from "./geometry";
export { advanceSimulation, applySimEvent, getSnapshot, initSimulation, stepSimulation } from "./simulation";
