import type * as RAPIER from '@dimforge/rapier3d-simd-compat';
import {AVATAR_PHYSICS_CONFIG} from '../constants';
import {RoomObstacle} from '../scene/LofiRoomEnvironment';
import {RoomPropId} from '../types';

export type RapierModule = typeof RAPIER;
export type DynamicPropId = Extract<RoomPropId, 'toy_ball' | 'floor_cushion' | 'plush_die'>;

export interface DynamicPropPhysicsState {
  id: DynamicPropId;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  initialPosition: {x: number; y: number; z: number};
}

export interface CharacterPhysicsStepInput {
  desiredVx: number;
  desiredVz: number;
  yaw: number;
  seated: boolean;
  ignoreObstacleId: string | null;
  leftHandWorld: {x: number; y: number; z: number};
  rightHandWorld: {x: number; y: number; z: number};
}

export interface CharacterPhysicsState {
  x: number;
  footY: number;
  z: number;
  vx: number;
  vz: number;
  verticalVelocity: number;
  grounded: boolean;
  weightKg: number;
  compressionY: number;
  leanPitch: number;
  leanRoll: number;
}

const STATIC_FURNITURE_HEIGHTS: Record<string, number> = {
  desk: 0.74,
  desk_chair: 0.85,
  nightstand: 0.52,
  bed: 0.45,
};

/**
 * Rapier3D physics backend integrated with MotionBricksEngine:
 * - KinematicCharacterController (46kg character mass, obstacle sliding, dynamic impulse transfer)
 * - Gravity (-9.81 m/s^2), jump impulses, landing impact spring-damper compression, and inertia lean
 * - Static floor, perimeter walls, and furniture colliders (filtered during chair/bed seating)
 * - Kinematic hand colliders so VRM Arm IK physically bats/pushes dynamic bedroom props
 * - Dynamic rigid bodies for interactive bedroom props (`toy_ball`, `floor_cushion`, `plush_die`)
 */
export class MotionBricksPhysics {
  readonly rapier: RapierModule;
  readonly world: RAPIER.World;

  private readonly characterController: RAPIER.KinematicCharacterController;
  private readonly charBody: RAPIER.RigidBody;
  private readonly charCollider: RAPIER.Collider;

  private readonly leftHandBody: RAPIER.RigidBody;
  private readonly leftHandCollider: RAPIER.Collider;
  private readonly rightHandBody: RAPIER.RigidBody;
  private readonly rightHandCollider: RAPIER.Collider;

  private readonly staticBodies: RAPIER.RigidBody[] = [];
  private readonly obstacleColliderTags = new Map<number, string>();
  private readonly dynamicProps = new Map<DynamicPropId, DynamicPropPhysicsState>();

  private vx = 0;
  private vz = 0;
  private verticalVelocity = 0;
  private grounded = true;
  private snapEnabled = true;

  // Weight spring-damper & inertia lean state
  private compressionY = 0;
  private compressionVel = 0;
  private leanPitch = 0;
  private leanRoll = 0;
  private lastJumpAt = -10;
  private disposed = false;

  readonly state: CharacterPhysicsState;

  constructor(
    rapierModule: unknown,
    worldInstance: unknown,
    obstacles: RoomObstacle[] = [],
    initialPos: {x: number; y: number; z: number} = {x: -0.08, y: 0, z: -1.28}
  ) {
    this.rapier = rapierModule as RapierModule;
    this.world = worldInstance as RAPIER.World;

    const R = this.rapier;
    const cfg = AVATAR_PHYSICS_CONFIG;

    this.state = {
      x: initialPos.x,
      footY: initialPos.y,
      z: initialPos.z,
      vx: 0,
      vz: 0,
      verticalVelocity: 0,
      grounded: true,
      weightKg: cfg.massKg,
      compressionY: 0,
      leanPitch: 0,
      leanRoll: 0,
    };

    // 1. Static room floor + walls + furniture colliders
    this.buildStaticEnvironment(obstacles);

    // 2. Avatar kinematic character capsule + 46kg Rapier KinematicCharacterController
    const charDesc = R.RigidBodyDesc.kinematicPositionBased().setTranslation(
      initialPos.x,
      initialPos.y + cfg.characterCenterOffsetY,
      initialPos.z
    );
    this.charBody = this.world.createRigidBody(charDesc);
    const charColDesc = R.ColliderDesc.capsule(cfg.capsuleHalfHeight, cfg.capsuleRadius)
      .setFriction(0.35)
      .setRestitution(0.0);
    this.charCollider = this.world.createCollider(charColDesc, this.charBody);

    this.characterController = this.world.createCharacterController(0.02);
    this.characterController.setUp({x: 0, y: 1, z: 0});
    this.characterController.setCharacterMass(cfg.massKg);
    this.characterController.setApplyImpulsesToDynamicBodies(true);
    this.characterController.setSlideEnabled(true);
    this.characterController.enableAutostep(0.05, 0.12, false);
    this.characterController.enableSnapToGround(0.015);
    this.characterController.setMaxSlopeClimbAngle((45 * Math.PI) / 180);

    // 3. Kinematic hand colliders driven by MotionBricks Arm IK world positions
    const lHandDesc = R.RigidBodyDesc.kinematicPositionBased().setTranslation(
      initialPos.x + 0.24,
      initialPos.y + 0.92,
      initialPos.z
    );
    this.leftHandBody = this.world.createRigidBody(lHandDesc);
    this.leftHandCollider = this.world.createCollider(
      R.ColliderDesc.ball(cfg.handColliderRadius).setDensity(2.2).setRestitution(0.35),
      this.leftHandBody
    );

    const rHandDesc = R.RigidBodyDesc.kinematicPositionBased().setTranslation(
      initialPos.x - 0.24,
      initialPos.y + 0.92,
      initialPos.z
    );
    this.rightHandBody = this.world.createRigidBody(rHandDesc);
    this.rightHandCollider = this.world.createCollider(
      R.ColliderDesc.ball(cfg.handColliderRadius).setDensity(2.2).setRestitution(0.35),
      this.rightHandBody
    );

    // 4. Dynamic interactive bedroom props
    this.buildDynamicProps();
  }

  private buildStaticEnvironment(obstacles: RoomObstacle[]): void {
    const R = this.rapier;

    // Floor slab with top face at exact y = 0.0
    const floorBody = this.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(0, -0.05, -1.65)
    );
    this.world.createCollider(
      R.ColliderDesc.cuboid(2.2, 0.05, 2.2).setFriction(0.78).setRestitution(0.25),
      floorBody
    );
    this.staticBodies.push(floorBody);

    // Room perimeter walls so props bounce cleanly inside the compact bedroom
    const wallSpecs: Array<{
      x: number;
      y: number;
      z: number;
      hx: number;
      hy: number;
      hz: number;
    }> = [
      {x: 0, y: 1.2, z: -3.14, hx: 1.75, hy: 1.25, hz: 0.05}, // back wall
      {x: -1.58, y: 1.2, z: -1.65, hx: 0.05, hy: 1.25, hz: 1.6}, // left wall
      {x: 1.58, y: 1.2, z: -1.65, hx: 0.05, hy: 1.25, hz: 1.6}, // right wall
      {x: 0, y: 1.2, z: -0.22, hx: 1.75, hy: 1.25, hz: 0.05}, // invisible front rail keeping balls inside room
    ];
    for (const w of wallSpecs) {
      const wb = this.world.createRigidBody(
        R.RigidBodyDesc.fixed().setTranslation(w.x, w.y, w.z)
      );
      this.world.createCollider(
        R.ColliderDesc.cuboid(w.hx, w.hy, w.hz).setRestitution(0.55).setFriction(0.4),
        wb
      );
      this.staticBodies.push(wb);
    }

    // Furniture obstacle colliders
    for (const obs of obstacles) {
      const cx = (obs.minX + obs.maxX) * 0.5;
      const cz = (obs.minZ + obs.maxZ) * 0.5;
      const hx = Math.max(0.05, (obs.maxX - obs.minX) * 0.5);
      const hz = Math.max(0.05, (obs.maxZ - obs.minZ) * 0.5);
      const h = STATIC_FURNITURE_HEIGHTS[obs.id] ?? 0.7;

      const body = this.world.createRigidBody(
        R.RigidBodyDesc.fixed().setTranslation(cx, h * 0.5, cz)
      );
      const col = this.world.createCollider(
        R.ColliderDesc.cuboid(hx, h * 0.5, hz).setFriction(0.55).setRestitution(0.25),
        body
      );
      this.obstacleColliderTags.set(col.handle, obs.id);
      this.staticBodies.push(body);
    }
  }

  private buildDynamicProps(): void {
    const R = this.rapier;

    // 1. Starry pastel yarn/toy ball on the left rug
    const ballPos = {x: -0.34, y: 0.11, z: -1.02};
    const ballBody = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(ballPos.x, ballPos.y, ballPos.z)
        .setLinearDamping(0.38)
        .setAngularDamping(0.45)
        .setCanSleep(false)
    );
    const ballCol = this.world.createCollider(
      R.ColliderDesc.ball(0.085)
        .setDensity(1.35)
        .setRestitution(0.74)
        .setFriction(0.42),
      ballBody
    );
    this.dynamicProps.set('toy_ball', {
      id: 'toy_ball',
      body: ballBody,
      collider: ballCol,
      initialPosition: ballPos,
    });

    // 2. Plush tufted floor cushion near the bed corner (clear of avatar spawn capsule)
    const cushionPos = {x: 0.54, y: 0.06, z: -1.14};
    const cushionBody = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(cushionPos.x, cushionPos.y, cushionPos.z)
        .setLinearDamping(2.4)
        .setAngularDamping(2.8)
    );
    const cushionCol = this.world.createCollider(
      R.ColliderDesc.cuboid(0.19, 0.055, 0.19)
        .setDensity(1.7)
        .setRestitution(0.12)
        .setFriction(0.88),
      cushionBody
    );
    this.dynamicProps.set('floor_cushion', {
      id: 'floor_cushion',
      body: cushionBody,
      collider: cushionCol,
      initialPosition: cushionPos,
    });

    // 3. Soft six-sided plush die near front center rug
    const diePos = {x: -0.14, y: 0.09, z: -0.82};
    const dieBody = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(diePos.x, diePos.y, diePos.z)
        .setLinearDamping(0.75)
        .setAngularDamping(0.85)
    );
    const dieCol = this.world.createCollider(
      R.ColliderDesc.cuboid(0.072, 0.072, 0.072)
        .setDensity(1.4)
        .setRestitution(0.42)
        .setFriction(0.62),
      dieBody
    );
    this.dynamicProps.set('plush_die', {
      id: 'plush_die',
      body: dieBody,
      collider: dieCol,
      initialPosition: diePos,
    });
  }

  /**
   * Applies an immediate vertical jump impulse (real gravity pulls the 46kg avatar back down).
   */
  triggerJump(impulse = AVATAR_PHYSICS_CONFIG.jumpImpulse): boolean {
    if (this.disposed) return false;
    const now = performance.now() * 0.001;
    if (!this.grounded && now - this.lastJumpAt < 0.25) return false;
    this.lastJumpAt = now;
    this.verticalVelocity = impulse;
    this.grounded = false;
    // Slight pre-jump crouch knee compression
    this.compressionVel = -0.65;
    if (this.snapEnabled) {
      this.characterController.disableSnapToGround();
      this.snapEnabled = false;
    }
    return true;
  }

  /**
   * Fires a subtle weight-settle compression impulse when sitting onto the chair or bed.
   */
  triggerWeightImpact(strength = 0.85): void {
    this.compressionVel -= strength;
  }

  /**
   * Teleports kinematic body cleanly without tearing colliders.
   */
  syncBodyPosition(x: number, footY: number, z: number): void {
    if (this.disposed) return;
    const cy = footY + AVATAR_PHYSICS_CONFIG.characterCenterOffsetY;
    this.charBody.setNextKinematicTranslation({x, y: cy, z});
    this.charBody.setTranslation({x, y: cy, z}, true);
    this.state.x = x;
    this.state.footY = footY;
    this.state.z = z;
  }

  /**
   * Pushes or tosses one of the dynamic physical room props.
   */
  applyPropImpulse(
    id: DynamicPropId,
    impulse: {x: number; y: number; z: number},
    torque?: {x: number; y: number; z: number}
  ): boolean {
    if (this.disposed) return false;
    const prop = this.dynamicProps.get(id);
    if (!prop) return false;
    prop.body.wakeUp();
    prop.body.applyImpulse(impulse, true);
    if (torque) {
      prop.body.applyTorqueImpulse(torque, true);
    } else {
      prop.body.applyTorqueImpulse(
        {
          x: (Math.random() - 0.5) * 0.06,
          y: (Math.random() - 0.5) * 0.08,
          z: (Math.random() - 0.5) * 0.06,
        },
        true
      );
    }
    return true;
  }

  getDynamicPropPose(
    id: DynamicPropId
  ): {x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number} | null {
    if (this.disposed) return null;
    const prop = this.dynamicProps.get(id);
    if (!prop) return null;
    const t = prop.body.translation();
    const r = prop.body.rotation();
    return {x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w};
  }

  getDynamicPropPosition(id: DynamicPropId): {x: number; y: number; z: number} | null {
    if (this.disposed) return null;
    const prop = this.dynamicProps.get(id);
    if (!prop) return null;
    const t = prop.body.translation();
    return {x: t.x, y: t.y, z: t.z};
  }

  isDynamicProp(id: RoomPropId): id is DynamicPropId {
    return id === 'toy_ball' || id === 'floor_cushion' || id === 'plush_die';
  }

  step(dt: number, input: CharacterPhysicsStepInput): CharacterPhysicsState {
    if (this.disposed) return this.state;
    const safeDt = Math.min(Math.max(dt, 0.001), 0.05);
    const cfg = AVATAR_PHYSICS_CONFIG;

    // 1. Mass-aware horizontal velocity smoothing & momentum lean
    const prevVx = this.vx;
    const prevVz = this.vz;
    const isAccel =
      Math.hypot(input.desiredVx, input.desiredVz) > Math.hypot(this.vx, this.vz);
    const lambda = isAccel ? cfg.walkAccel : cfg.walkDecel;
    const alpha = 1 - Math.exp(-lambda * safeDt);
    this.vx += (input.desiredVx - this.vx) * alpha;
    this.vz += (input.desiredVz - this.vz) * alpha;

    const ax = (this.vx - prevVx) / safeDt;
    const az = (this.vz - prevVz) / safeDt;
    const sinY = Math.sin(input.yaw);
    const cosY = Math.cos(input.yaw);
    const forwardVel = this.vx * sinY + this.vz * cosY;
    const forwardAccel = ax * sinY + az * cosY;
    const lateralAccel = ax * cosY - az * sinY;
    const targetLeanPitch = Math.max(
      -0.1,
      Math.min(0.14, forwardVel * 0.055 + forwardAccel * 0.012)
    );
    const targetLeanRoll = Math.max(-0.11, Math.min(0.11, -lateralAccel * 0.014));
    const leanAlpha = 1 - Math.exp(-9 * safeDt);
    this.leanPitch += (targetLeanPitch - this.leanPitch) * leanAlpha;
    this.leanRoll += (targetLeanRoll - this.leanRoll) * leanAlpha;

    // 2. Gravity integration
    if (input.seated) {
      this.verticalVelocity = 0;
      this.grounded = true;
    } else {
      if (this.grounded && this.verticalVelocity <= 0) {
        this.verticalVelocity = -0.15; // subtle downward contact pressure for ground check
      } else {
        this.verticalVelocity += cfg.gravityY * safeDt;
      }
    }

    // Manage snapToGround so upward jump is never pulled down
    if (this.verticalVelocity > 0.04) {
      if (this.snapEnabled) {
        this.characterController.disableSnapToGround();
        this.snapEnabled = false;
      }
    } else if (!this.snapEnabled) {
      this.characterController.enableSnapToGround(0.015);
      this.snapEnabled = true;
    }

    const desiredDelta = {
      x: this.vx * safeDt,
      y: this.verticalVelocity * safeDt,
      z: this.vz * safeDt,
    };

    const charHandle = this.charCollider.handle;
    const lHandHandle = this.leftHandCollider.handle;
    const rHandHandle = this.rightHandCollider.handle;

    // 3. Rapier KinematicCharacterController sweep & dynamic-body impulse transfer
    this.characterController.computeColliderMovement(
      this.charCollider,
      desiredDelta,
      undefined,
      undefined,
      (collider) => {
        const h = collider.handle;
        if (h === charHandle || h === lHandHandle || h === rHandHandle) {
          return false;
        }
        const tag = this.obstacleColliderTags.get(h);
        if (tag && input.ignoreObstacleId && tag === input.ignoreObstacleId) {
          return false;
        }
        if (input.seated && tag && (tag === 'desk_chair' || tag === 'bed')) {
          return false;
        }
        return true;
      }
    );

    const moved = this.characterController.computedMovement();
    const curPos = this.charBody.translation();
    let nextX = curPos.x + moved.x;
    let nextY = curPos.y + moved.y;
    let nextZ = curPos.z + moved.z;

    const minCenterY = cfg.characterCenterOffsetY;
    if (nextY < minCenterY) {
      nextY = minCenterY;
    }

    const wasGrounded = this.grounded;
    const nowGrounded =
      this.characterController.computedGrounded() || nextY <= minCenterY + 0.004;

    if (!wasGrounded && nowGrounded && this.verticalVelocity < -0.6) {
      // Real landing weight absorption compression!
      const impactSpeed = Math.abs(this.verticalVelocity);
      this.compressionVel -= Math.min(2.4, impactSpeed * 0.42);
    }

    if (nowGrounded && this.verticalVelocity < 0) {
      this.verticalVelocity = 0;
    }
    this.grounded = nowGrounded;

    this.charBody.setNextKinematicTranslation({x: nextX, y: nextY, z: nextZ});

    // 4. Second-order spring-damper for 46kg landing/step weight squash
    const springForce =
      -cfg.weightSpringStiffness * this.compressionY -
      cfg.weightSpringDamping * this.compressionVel;
    this.compressionVel += springForce * safeDt;
    this.compressionY = Math.max(-0.11, Math.min(0.04, this.compressionY + this.compressionVel * safeDt));

    // 5. Update kinematic hand colliders so swinging/reaching hands interact physically
    this.leftHandBody.setNextKinematicTranslation(input.leftHandWorld);
    this.rightHandBody.setNextKinematicTranslation(input.rightHandWorld);

    this.state.x = nextX;
    this.state.footY = Math.max(0, nextY - cfg.characterCenterOffsetY);
    this.state.z = nextZ;
    this.state.vx = this.vx;
    this.state.vz = this.vz;
    this.state.verticalVelocity = this.verticalVelocity;
    this.state.grounded = this.grounded;
    this.state.compressionY = this.compressionY;
    this.state.leanPitch = this.leanPitch;
    this.state.leanRoll = this.leanRoll;

    return this.state;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.world.removeCharacterController(this.characterController);
    } catch {
      // Ignore if world already freed
    }
    try {
      this.world.removeRigidBody(this.charBody);
      this.world.removeRigidBody(this.leftHandBody);
      this.world.removeRigidBody(this.rightHandBody);
      for (const prop of this.dynamicProps.values()) {
        this.world.removeRigidBody(prop.body);
      }
      for (const sb of this.staticBodies) {
        this.world.removeRigidBody(sb);
      }
    } catch {
      // Ignore if world already freed
    }
    this.dynamicProps.clear();
    this.staticBodies.length = 0;
    this.obstacleColliderTags.clear();
  }
}
