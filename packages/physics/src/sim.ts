import { Box, Chain, Circle, Vec2, WheelJoint, World } from "planck";
import type { Body } from "planck";
import {
  ANTI_WHEELIE_END,
  ANTI_WHEELIE_START,
  CHECKPOINT_FRACTION,
  CRASH_FREEZE_TICKS,
  FINISH_FLAG_OFFSET,
  GRAVITY_X,
  GRAVITY_Y,
  HILL_ASSIST_MIN_SLOPE,
  KILL_FLOOR_DROP,
  LEAD_IN_METERS,
  POSITION_ITERATIONS,
  RUN_OUT_METERS,
  SIM_DT,
  STABILIZER_LEAN_FACTOR,
  TORQUE_CURVE_KNEE,
  VELOCITY_ITERATIONS,
} from "./constants";
import { createScoreState, resetScoreStreaks, updateScore } from "./scoring";
import { sweptCircleHitsTerrain, terrainSlopeAt, terrainYAt, wrapAngle } from "./terrain";
import { DEFAULT_TUNE, INPUT } from "./types";
import type {
  BikeTune,
  Checkpoint,
  Keymask,
  Sim,
  SimOptions,
  SimSnapshot,
  TrackInfo,
  TrackPoint,
} from "./types";

const ALL_INPUT_BITS =
  INPUT.THROTTLE | INPUT.BRAKE | INPUT.LEAN_LEFT | INPUT.LEAN_RIGHT | INPUT.JUMP;

/**
 * Vertical gap left between the lowest wheel and the highest terrain under the
 * bike at spawn/respawn, so the bike drops cleanly onto the track instead of
 * clipping through it. Must be generous enough to clear steep DEGEN sections.
 */
const SPAWN_CLEARANCE = 0.3;

/**
 * Highest terrain surface over [xLo, xHi] (piecewise-linear: the max is at an
 * endpoint or an interior vertex). Used to lift the spawn pose above the terrain
 * under the WHOLE bike footprint, not just under the chassis center.
 */
function maxTerrainBetween(terrain: readonly TrackPoint[], xLo: number, xHi: number): number {
  let m = Math.max(terrainYAt(terrain, xLo), terrainYAt(terrain, xHi));
  for (let i = 0; i < terrain.length; i++) {
    const [vx, vy] = terrain[i];
    if (vx > xLo && vx < xHi && vy > m) m = vy;
  }
  return m;
}

function buildTrackInfo(trackPoints: readonly TrackPoint[], tune: BikeTune): TrackInfo {
  if (trackPoints.length < 2) {
    throw new Error(`createSim requires at least 2 track points, got ${trackPoints.length}`);
  }
  for (let i = 0; i < trackPoints.length; i++) {
    const [x, y] = trackPoints[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`track point ${i} is not finite: [${x}, ${y}]`);
    }
    if (i > 0 && x <= trackPoints[i - 1][0]) {
      throw new Error(`track x must be strictly increasing (point ${i})`);
    }
  }

  const first = trackPoints[0];
  const last = trackPoints[trackPoints.length - 1];
  const terrain: TrackPoint[] = [
    [first[0] - LEAD_IN_METERS, first[1]],
    ...trackPoints.map((p): TrackPoint => [p[0], p[1]]),
    [last[0] + RUN_OUT_METERS, last[1]],
  ];

  let minY = Infinity;
  for (const [, y] of terrain) minY = Math.min(minY, y);

  const spawnX = first[0] - LEAD_IN_METERS / 2;
  const finishX = last[0] + FINISH_FLAG_OFFSET;
  // Chassis-center height above the highest terrain under the footprint that
  // still leaves both wheel bottoms SPAWN_CLEARANCE clear. Footprint half-width
  // covers the wheels (wheelbase/2) and the wider chassis box (chassisWidth/2).
  const footHalf = Math.max(tune.wheelbase / 2, tune.chassisWidth / 2);
  const chassisCenterAbove = tune.wheelRadius + tune.axleDropY + SPAWN_CLEARANCE;

  const checkpoints: Checkpoint[] = [];
  const span = finishX - spawnX;
  for (let x = spawnX; x < finishX; x += span * CHECKPOINT_FRACTION) {
    const ground = maxTerrainBetween(terrain, x - footHalf, x + footHalf);
    checkpoints.push({ x, y: ground + chassisCenterAbove });
  }

  return { terrain, spawnX, finishX, killY: minY - KILL_FLOOR_DROP, checkpoints };
}

/** Place chassis + wheels upright at (x, y = chassis center), all velocities zero. */
function setBikePose(sim: Sim, x: number, y: number): void {
  const { tune } = sim;
  const halfBase = tune.wheelbase / 2;
  sim.chassis.setTransform(new Vec2(x, y), 0);
  sim.rearWheel.setTransform(new Vec2(x - halfBase, y - tune.axleDropY), 0);
  sim.frontWheel.setTransform(new Vec2(x + halfBase, y - tune.axleDropY), 0);
  for (const body of [sim.chassis, sim.rearWheel, sim.frontWheel]) {
    body.setLinearVelocity(new Vec2(0, 0));
    body.setAngularVelocity(0);
  }
}

function isWheelGrounded(wheel: Body, ground: Body): boolean {
  for (let ce = wheel.getContactList(); ce; ce = ce.next ?? null) {
    if (ce.other === ground && ce.contact.isTouching()) return true;
  }
  return false;
}

function isHeadTouching(sim: Sim): boolean {
  for (let ce = sim.chassis.getContactList(); ce; ce = ce.next ?? null) {
    if (ce.other !== sim.ground) continue;
    const contact = ce.contact;
    if (!contact.isTouching()) continue;
    if (contact.getFixtureA() === sim.headFixture || contact.getFixtureB() === sim.headFixture) {
      return true;
    }
  }
  return false;
}

/**
 * Create a deterministic simulation over a frozen track polyline.
 * Body/fixture/joint creation order is fixed (ground → chassis → rear wheel →
 * front wheel → rear joint → front joint) — solver order depends on it.
 */
export function createSim(
  trackPoints: readonly TrackPoint[],
  tune?: Partial<BikeTune>,
  options: SimOptions = {},
): Sim {
  const fullTune: BikeTune = { ...DEFAULT_TUNE, ...tune };
  const track = buildTrackInfo(trackPoints, fullTune);
  const spawn = track.checkpoints[0];

  const world = new World({ gravity: new Vec2(GRAVITY_X, GRAVITY_Y) });

  const ground = world.createBody({ type: "static" });
  ground.createFixture({
    shape: new Chain(
      track.terrain.map(([x, y]) => new Vec2(x, y)),
      false,
    ),
    friction: fullTune.groundFriction,
  });

  const chassis = world.createBody({
    type: "dynamic",
    position: new Vec2(spawn.x, spawn.y),
    bullet: true,
  });
  chassis.createFixture({
    shape: new Box(fullTune.chassisWidth / 2, fullTune.chassisHeight / 2),
    density: fullTune.chassisDensity,
    friction: fullTune.chassisFriction,
  });
  const headFixture = chassis.createFixture({
    shape: new Circle(new Vec2(fullTune.headOffsetX, fullTune.headOffsetY), fullTune.headRadius),
    isSensor: true,
    density: 0,
  });

  const halfBase = fullTune.wheelbase / 2;
  const makeWheel = (x: number): Body => {
    const wheel = world.createBody({
      type: "dynamic",
      position: new Vec2(x, spawn.y - fullTune.axleDropY),
      bullet: true,
    });
    wheel.createFixture({
      shape: new Circle(fullTune.wheelRadius),
      density: fullTune.wheelDensity,
      friction: fullTune.wheelFriction,
    });
    return wheel;
  };
  const rearWheel = makeWheel(spawn.x - halfBase);
  const frontWheel = makeWheel(spawn.x + halfBase);

  const rearJoint = world.createJoint(
    new WheelJoint(
      {
        enableMotor: true,
        motorSpeed: 0,
        maxMotorTorque: 0,
        frequencyHz: fullTune.suspensionHz,
        dampingRatio: fullTune.suspensionDamping,
      },
      chassis,
      rearWheel,
      rearWheel.getPosition(),
      new Vec2(0, 1),
    ),
  );
  const frontJoint = world.createJoint(
    new WheelJoint(
      {
        enableMotor: false,
        motorSpeed: 0,
        maxMotorTorque: fullTune.frontBrakeTorque,
        frequencyHz: fullTune.suspensionHz,
        dampingRatio: fullTune.suspensionDamping,
      },
      chassis,
      frontWheel,
      frontWheel.getPosition(),
      new Vec2(0, 1),
    ),
  );
  if (!rearJoint || !frontJoint) throw new Error("failed to create wheel joints");

  const head = chassis.getWorldPoint(new Vec2(fullTune.headOffsetX, fullTune.headOffsetY));

  const sim: Sim = {
    world,
    tune: fullTune,
    track,
    parTimeMs: options.parTimeMs,
    ground,
    chassis,
    rearWheel,
    frontWheel,
    headFixture,
    rearJoint,
    frontJoint,
    tick: 0,
    prevKeymask: 0,
    attitude: 0,
    prevHeadX: head.x,
    prevHeadY: head.y,
    freezeTicks: 0,
    checkpointIndex: 0,
    score: createScoreState(),
    finished: false,
    finishTick: -1,
  };

  return sim;
}

/** Exact respawn at the last checkpoint: upright, zero velocity, motors idle. */
function respawn(sim: Sim): void {
  const cp = sim.track.checkpoints[sim.checkpointIndex];
  setBikePose(sim, cp.x, cp.y);
  sim.attitude = 0;
  sim.rearJoint.setMotorSpeed(0);
  sim.rearJoint.setMaxMotorTorque(0);
  sim.frontJoint.enableMotor(false);
  resetScoreStreaks(sim.score);
  const head = sim.chassis.getWorldPoint(new Vec2(sim.tune.headOffsetX, sim.tune.headOffsetY));
  sim.prevHeadX = head.x;
  sim.prevHeadY = head.y;
}

/**
 * Advance the simulation by exactly one fixed step at SIM_DT. The ONLY place
 * input handling, motor control, lean torque, jump, ground/crash detection,
 * and scoring happen. `keymask` is the input sampled for this step.
 */
export function stepSim(sim: Sim, keymask: Keymask): void {
  const { tune } = sim;

  const frozen = sim.freezeTicks > 0;
  if (frozen) {
    keymask = 0;
    sim.freezeTicks -= 1;
    if (sim.freezeTicks === 0) respawn(sim);
  }
  keymask &= ALL_INPUT_BITS;

  const throttle = (keymask & INPUT.THROTTLE) !== 0;
  const brake = (keymask & INPUT.BRAKE) !== 0;
  const leanDir =
    ((keymask & INPUT.LEAN_LEFT) !== 0 ? 1 : 0) - ((keymask & INPUT.LEAN_RIGHT) !== 0 ? 1 : 0);

  // Grounded state as of the last step's contacts — shared by the drive
  // shaping, wheelie boost, stabilizer, hill assist, and jump below. The whole
  // arcade layer is gated on it: fully airborne ticks run the exact pre-P2.1
  // code paths (locked air feel).
  const rearOnGround = isWheelGrounded(sim.rearWheel, sim.ground);
  const frontOnGround = isWheelGrounded(sim.frontWheel, sim.ground);
  const anyOnGround = rearOnGround || frontOnGround;

  // Terrain slope under the bike: slope under each wheel, direction-averaged.
  // pitchError > 0 = nose-up relative to the slope (riding +x).
  let groundSlope = 0;
  let pitchError = 0;
  if (anyOnGround) {
    const rearSlope = terrainSlopeAt(sim.track.terrain, sim.rearWheel.getPosition().x);
    const frontSlope = terrainSlopeAt(sim.track.terrain, sim.frontWheel.getPosition().x);
    groundSlope = Math.atan2(
      Math.sin(rearSlope) + Math.sin(frontSlope),
      Math.cos(rearSlope) + Math.cos(frontSlope),
    );
    pitchError = wrapAngle(sim.chassis.getAngle() - groundSlope);
  }

  // Speed as of the previous step's end — drives the low-speed launch assist.
  const preVel = sim.chassis.getLinearVelocity();
  const preSpeed = Math.sqrt(preVel.x * preVel.x + preVel.y * preVel.y);
  // Signed forward speed = velocity projected onto the chassis-forward axis
  // (robust on slopes/dips). >0 = moving forward.
  const fwdDir = sim.chassis.getWorldVector(new Vec2(1, 0));
  const forwardVel = preVel.x * fwdDir.x + preVel.y * fwdDir.y;
  // S/down reverses (vs brakes) when grounded and at/below crawl speed.
  const reversing = brake && anyOnGround && forwardVel <= tune.reverseEngageSpeed;

  // Drive / brake. S/down is context-aware: brake when moving forward, reverse
  // when crawling/stopped on the ground (grounded-only, low-speed-only, capped).
  if (brake) {
    if (reversing) {
      // Reverse: positive motor speed = backward (forward drive uses -maxOmega).
      // The reverse motor first decelerates any residual forward roll, then
      // backs up — so braking-to-stop smoothly rolls into reverse, no snap.
      sim.frontJoint.enableMotor(false);
      if (-forwardVel < tune.reverseMaxSpeed) {
        sim.rearJoint.setMotorSpeed(tune.reverseMotorSpeed);
        sim.rearJoint.setMaxMotorTorque(tune.reverseMotorTorque);
      } else {
        sim.rearJoint.setMotorSpeed(0);
        sim.rearJoint.setMaxMotorTorque(0); // at the reverse cap → coast
      }
    } else {
      // Forward braking (moving forward, or airborne) — unchanged behavior.
      sim.rearJoint.setMotorSpeed(0);
      sim.rearJoint.setMaxMotorTorque(tune.rearBrakeTorque);
      sim.frontJoint.enableMotor(true);
      sim.frontJoint.setMotorSpeed(0);
      sim.frontJoint.setMaxMotorTorque(tune.frontBrakeTorque);
    }
  } else {
    sim.frontJoint.enableMotor(false);
    if (throttle) {
      let motorTorque = tune.maxMotorTorque;
      if (anyOnGround) {
        // Torque curve: full punch up to the knee, then linear falloff to
        // torqueFalloffFloor at maxOmega — kills wheelie torque at speed.
        const spin = Math.min(1, Math.abs(sim.rearWheel.getAngularVelocity()) / tune.maxOmega);
        if (spin > TORQUE_CURVE_KNEE) {
          const t = (spin - TORQUE_CURVE_KNEE) / (1 - TORQUE_CURVE_KNEE);
          motorTorque *= 1 + (tune.torqueFalloffFloor - 1) * t;
        }
        // Anti-wheelie bias: pitching up past the slope tapers torque toward
        // antiWheelieFloor. Holding lean-back bypasses it — deliberate
        // wheelies keep full drive.
        if (leanDir <= 0 && pitchError > ANTI_WHEELIE_START) {
          const t = Math.min(
            1,
            (pitchError - ANTI_WHEELIE_START) / (ANTI_WHEELIE_END - ANTI_WHEELIE_START),
          );
          motorTorque *= 1 + (tune.antiWheelieFloor - 1) * t;
        }
        // Low-speed launch assist: extra torque ONLY from near-standstill so the
        // bike can break traction up a steep slope; scales linearly to ×1 at
        // launchSpeedThreshold and is exactly zero above it (no change to normal
        // riding, no new mid-ride wheelie behavior).
        if (preSpeed < tune.launchSpeedThreshold) {
          motorTorque *= 1 + (tune.launchBoost - 1) * (1 - preSpeed / tune.launchSpeedThreshold);
        }
      }
      sim.rearJoint.setMotorSpeed(-tune.maxOmega);
      sim.rearJoint.setMaxMotorTorque(motorTorque);
    } else {
      sim.rearJoint.setMotorSpeed(0);
      sim.rearJoint.setMaxMotorTorque(0); // freewheel
    }
  }

  // Lean: X-Moto attitude pattern — set while held, decay toward zero after.
  if (leanDir !== 0) sim.attitude = leanDir * tune.attitudeTorque;
  if (sim.attitude !== 0) {
    let applied = sim.attitude;
    // Wheelie recovery assist: holding lean-forward with the rear wheel down
    // and the front up gets boosted torque. Decay state is NOT boosted.
    if (leanDir < 0 && rearOnGround && !frontOnGround) {
      applied *= tune.wheelieRecoveryBoost;
    }
    sim.chassis.applyTorque(applied, true);
    sim.attitude *= tune.attitudeDecay;
    if (Math.abs(sim.attitude) < tune.attitudeMin) sim.attitude = 0;
  }

  // Grounded auto-stabilizer: PD torque pulling the chassis toward the local
  // terrain slope. Lean input keeps 30% authority so deliberate wheelies and
  // manuals stay possible — accidental ones don't. Off while fully airborne
  // and during the crash freeze (a downed bike must not right itself).
  if (anyOnGround && !frozen) {
    const gain = leanDir !== 0 ? STABILIZER_LEAN_FACTOR : 1;
    sim.chassis.applyTorque(
      gain *
        (-tune.stabilizerStrength * pitchError -
          tune.stabilizerDamping * sim.chassis.getAngularVelocity()),
      true,
    );
  }

  // Hill traction assist: throttling up a steep slope adds a force along the
  // surface cancelling hillAssist × the gravity component — the arcade cheat
  // that makes steep chart sections climbable. Zero downhill, zero in air.
  if (anyOnGround && throttle && groundSlope > HILL_ASSIST_MIN_SLOPE) {
    const totalMass = sim.chassis.getMass() + sim.rearWheel.getMass() + sim.frontWheel.getMass();
    const force = tune.hillAssist * totalMass * -GRAVITY_Y * Math.sin(groundSlope);
    sim.chassis.applyForce(
      new Vec2(force * Math.cos(groundSlope), force * Math.sin(groundSlope)),
      sim.chassis.getWorldCenter(),
      true,
    );
  }

  // Reverse incline traction assist: backing up a slope that descends in +x
  // (groundSlope < 0) adds a surface force up-slope in the BACKWARD direction —
  // the arcade cheat that lets the bike climb out of a steep V instead of the
  // rigid rear wheel slipping. A chassis body force is grip-independent, so wheel
  // micro-bounce no longer matters. Mirrors hillAssist; zero on flat/forward/air.
  const reverseHillMin = (tune.reverseHillMinSlopeDeg * Math.PI) / 180;
  if (reversing && groundSlope < -reverseHillMin) {
    const totalMass = sim.chassis.getMass() + sim.rearWheel.getMass() + sim.frontWheel.getMass();
    const force = tune.reverseHillAssist * totalMass * -GRAVITY_Y * Math.sin(-groundSlope);
    sim.chassis.applyForce(
      new Vec2(-force * Math.cos(groundSlope), -force * Math.sin(groundSlope)),
      sim.chassis.getWorldCenter(),
      true,
    );
  }

  // Jump: edge-triggered, needs ground contact (state as of the last step).
  const jumpPressed = (keymask & INPUT.JUMP) !== 0 && (sim.prevKeymask & INPUT.JUMP) === 0;
  if (jumpPressed && anyOnGround) {
    const up = sim.chassis.getWorldVector(new Vec2(0, 1));
    sim.chassis.applyLinearImpulse(
      new Vec2(up.x * tune.jumpImpulse, up.y * tune.jumpImpulse),
      sim.chassis.getWorldCenter(),
      true,
    );
  }

  const prevAngle = sim.chassis.getAngle();

  sim.world.step(SIM_DT, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
  sim.tick += 1;

  const pos = sim.chassis.getPosition();
  const angle = sim.chassis.getAngle();
  const vel = sim.chassis.getLinearVelocity();
  const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
  const head = sim.chassis.getWorldPoint(new Vec2(tune.headOffsetX, tune.headOffsetY));
  const rearGrounded = isWheelGrounded(sim.rearWheel, sim.ground);
  const frontGrounded = isWheelGrounded(sim.frontWheel, sim.ground);

  // Airborne spin cap: keeps flips controllable without touching grounded
  // dynamics. Applied post-step, so it shapes the next step's rotation.
  if (!rearGrounded && !frontGrounded) {
    const omega = sim.chassis.getAngularVelocity();
    if (omega > tune.chassisSpinCap) sim.chassis.setAngularVelocity(tune.chassisSpinCap);
    else if (omega < -tune.chassisSpinCap) sim.chassis.setAngularVelocity(-tune.chassisSpinCap);
  }

  const slope = terrainSlopeAt(sim.track.terrain, pos.x);
  const landingAligned =
    Math.abs(wrapAngle(angle - slope)) <= (tune.landingToleranceDeg * Math.PI) / 180;

  // Crash fires ONLY on head-vs-track contact (sensor touch or the swept head
  // circle) or falling into the void below killY. The chassis box and wheels
  // resting, grazing, or bottoming out on terrain at any angle is never a crash.
  let crashed = false;
  if (!frozen && !sim.finished) {
    if (
      isHeadTouching(sim) ||
      sweptCircleHitsTerrain(
        sim.track.terrain,
        sim.prevHeadX,
        sim.prevHeadY,
        head.x,
        head.y,
        tune.headRadius,
      ) ||
      pos.y < sim.track.killY
    ) {
      crashed = true;
    }
  }

  let finishedEvent = false;
  if (!frozen && !crashed) {
    const cps = sim.track.checkpoints;
    while (sim.checkpointIndex + 1 < cps.length && pos.x >= cps[sim.checkpointIndex + 1].x) {
      sim.checkpointIndex += 1;
    }
    if (!sim.finished && pos.x >= sim.track.finishX) {
      sim.finished = true;
      sim.finishTick = sim.tick;
      finishedEvent = true;
    }
  }

  if (!frozen && (!sim.finished || finishedEvent)) {
    updateScore(sim.score, {
      tick: sim.tick,
      rearGrounded,
      frontGrounded,
      angleDelta: angle - prevAngle,
      speed,
      landingAligned,
      crashed,
      finished: finishedEvent,
      timeMs: sim.tick * SIM_DT * 1000,
      parTimeMs: sim.parTimeMs,
    });
  }

  if (crashed) {
    sim.freezeTicks = CRASH_FREEZE_TICKS;
    sim.attitude = 0;
  }

  sim.prevHeadX = head.x;
  sim.prevHeadY = head.y;
  sim.prevKeymask = keymask;
}

/** Plain-data view for the renderer — no Planck objects leaked. */
export function getSnapshot(sim: Sim): SimSnapshot {
  const chassisPos = sim.chassis.getPosition();
  const rearPos = sim.rearWheel.getPosition();
  const frontPos = sim.frontWheel.getPosition();
  const head = sim.chassis.getWorldPoint(new Vec2(sim.tune.headOffsetX, sim.tune.headOffsetY));
  const rearGrounded = isWheelGrounded(sim.rearWheel, sim.ground);
  const frontGrounded = isWheelGrounded(sim.frontWheel, sim.ground);
  const s = sim.score;
  return {
    chassis: { x: chassisPos.x, y: chassisPos.y, angle: sim.chassis.getAngle() },
    rearWheel: { x: rearPos.x, y: rearPos.y, angle: sim.rearWheel.getAngle() },
    frontWheel: { x: frontPos.x, y: frontPos.y, angle: sim.frontWheel.getAngle() },
    head: { x: head.x, y: head.y },
    score: s.score,
    speedScore: s.speedScore,
    trickBonus: s.trickBonus,
    effectiveTimeMs: s.effectiveTimeMs,
    combo: s.combo,
    flips: s.flips,
    backflips: s.backflips,
    frontflips: s.frontflips,
    crashes: s.crashes,
    airTicks: s.airTicks,
    grounded: rearGrounded || frontGrounded,
    rearGrounded,
    frontGrounded,
    wheelieTicks: s.wheelieStreak,
    crashed: sim.freezeTicks > 0,
    finished: sim.finished,
    tick: sim.tick,
    simTime: sim.tick * SIM_DT,
  };
}

/** Static track facts (terrain polyline, spawn, finish, kill floor, checkpoints). */
export function getTrackInfo(sim: Sim): TrackInfo {
  return sim.track;
}
