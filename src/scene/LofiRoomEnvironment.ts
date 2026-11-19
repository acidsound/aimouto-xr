import * as THREE from 'three';
import {STAGE_THEMES} from '../constants';
import {MotionBrickPose, RoomPropId, StageThemeId} from '../types';

export interface RoomObstacle {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface InteractiveRoomProp {
  id: RoomPropId;
  label: string;
  approachPos: THREE.Vector3;
  approachYaw: number;
  targetPose: MotionBrickPose;
  reachTargetWorld: THREE.Vector3;
  lookAtWorld: THREE.Vector3;
  hoverAnchorWorld: THREE.Vector3;
  hitMeshes: THREE.Object3D[];
}

export const ROOM_WALK_BOUNDS = {
  minX: -1.32,
  maxX: 1.32,
  minZ: -2.55,
  maxZ: -0.45,
};

function createWoodPlankTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4a3123';
  ctx.fillRect(0, 0, 512, 512);

  const plankH = 64;
  for (let row = 0; row < 8; row++) {
    const y = row * plankH;
    const toneShift = (row % 3) * 8 - 8;
    ctx.fillStyle = `rgb(${78 + toneShift}, ${52 + toneShift}, ${37 + toneShift})`;
    ctx.fillRect(0, y + 2, 512, plankH - 3);

    // Subtle wood grain streaks
    ctx.strokeStyle = 'rgba(28, 16, 10, 0.28)';
    ctx.lineWidth = 1.5;
    for (let g = 0; g < 6; g++) {
      const gy = y + 8 + g * 9;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(170, gy + ((row + g) % 2 ? 3 : -3), 340, gy - 2, 512, gy);
      ctx.stroke();
    }

    // Plank seam
    ctx.fillStyle = '#25160e';
    ctx.fillRect(0, y, 512, 2);
    const splitX = ((row * 173 + 90) % 420) + 46;
    ctx.fillRect(splitX, y, 2, plankH);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3.2, 3.0);
  return tex;
}

function createWovenRugTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#33294d';
  ctx.fillRect(0, 0, 512, 512);

  // Outer warm trim border
  ctx.strokeStyle = '#ff85b3';
  ctx.lineWidth = 14;
  ctx.strokeRect(22, 22, 468, 468);

  ctx.strokeStyle = '#6be5ff';
  ctx.lineWidth = 6;
  ctx.strokeRect(42, 42, 428, 428);

  // Cozy geometric woven diamond pattern
  ctx.strokeStyle = 'rgba(255, 224, 178, 0.22)';
  ctx.lineWidth = 3;
  for (let i = 64; i < 448; i += 48) {
    ctx.beginPath();
    ctx.moveTo(i, 64);
    ctx.lineTo(448, 512 - i);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(64, i);
    ctx.lineTo(512 - i, 448);
    ctx.stroke();
  }

  // Soft center circle motif
  ctx.beginPath();
  ctx.arc(256, 256, 86, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 133, 179, 0.16)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(107, 229, 255, 0.45)';
  ctx.lineWidth = 4;
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createNightSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#090d24');
  grad.addColorStop(0.5, '#191f4b');
  grad.addColorStop(1, '#31234a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Stars
  for (let i = 0; i < 75; i++) {
    const x = (i * 97 + 31) % 500;
    const y = (i * 61 + 19) % 280;
    const r = i % 5 === 0 ? 2.2 : 1.1;
    ctx.fillStyle = i % 3 === 0 ? '#bff5ff' : '#fff5d6';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Crescent Moon
  ctx.fillStyle = '#fff1b8';
  ctx.beginPath();
  ctx.arc(365, 108, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#12173a';
  ctx.beginPath();
  ctx.arc(379, 98, 29, 0, Math.PI * 2);
  ctx.fill();

  // Distant night city skyline silhouettes
  const buildings = [
    {x: 10, w: 68, h: 165},
    {x: 74, w: 54, h: 215},
    {x: 124, w: 82, h: 145},
    {x: 200, w: 62, h: 235},
    {x: 256, w: 74, h: 175},
    {x: 325, w: 66, h: 195},
    {x: 386, w: 58, h: 155},
    {x: 440, w: 72, h: 205},
  ];
  for (let bIdx = 0; bIdx < buildings.length; bIdx++) {
    const b = buildings[bIdx];
    const topY = 512 - b.h;
    ctx.fillStyle = bIdx % 2 === 0 ? '#111530' : '#161b3d';
    ctx.fillRect(b.x, topY, b.w, b.h);

    for (let wy = topY + 14; wy < 492; wy += 20) {
      for (let wx = b.x + 10; wx < b.x + b.w - 12; wx += 14) {
        if ((wx + wy + bIdx * 7) % 5 < 2) {
          ctx.fillStyle = (wx + wy) % 3 === 0 ? '#ffd28a' : '#7ae7ff';
          ctx.fillRect(wx, wy, 7, 10);
        }
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createLaptopScreenTexture(mode: number, timeSec: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  drawLaptopScreen(canvas, mode, timeSec);
  return canvas;
}

function drawLaptopScreen(canvas: HTMLCanvasElement, mode: number, timeSec: number): void {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0f142b';
  ctx.fillRect(0, 0, 512, 320);

  // Header bar
  ctx.fillStyle = '#1b2248';
  ctx.fillRect(0, 0, 512, 34);
  ctx.fillStyle = '#ff6ba8';
  ctx.beginPath();
  ctx.arc(20, 17, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4be3ff';
  ctx.beginPath();
  ctx.arc(38, 17, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 14px monospace';
  ctx.fillText(
    mode === 0
      ? 'midnight_beats_radio.ts  •  Chill Study'
      : mode === 1
        ? 'aimouto_motion.py  •  IK Active'
        : 'aimouto_face.exe  •  UwU',
    60,
    22
  );

  if (mode === 0) {
    // Ambient audio waveform visualizer
    const barCount = 28;
    for (let i = 0; i < barCount; i++) {
      const amp =
        34 +
        Math.sin(timeSec * 4.2 + i * 0.55) * 32 +
        Math.cos(timeSec * 2.4 + i * 0.9) * 20;
      const h = Math.max(12, Math.abs(amp));
      const x = 32 + i * 16;
      const grad = ctx.createLinearGradient(0, 260 - h, 0, 260);
      grad.addColorStop(0, '#4be3ff');
      grad.addColorStop(1, '#ff6ba8');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 260 - h, 10, h);
    }
    ctx.fillStyle = '#94a3b8';
    ctx.font = '15px sans-serif';
    ctx.fillText('Now Playing: Rainy Window & Twin-Tail Dreams (92 BPM)', 32, 294);
  } else if (mode === 1) {
    // Code / MotionBricks telemetry look
    const lines = [
      'const brick = MotionBricks.compose("cozy_desk");',
      'brick.setContextPose(vrm.humanoid.current);',
      'brick.solveArmIK("right", targetWorldPos);',
      'room.windowRain.intensity = 0.85;',
      '> Status: Cozy Mode / Click furniture to interact!',
    ];
    ctx.font = '16px monospace';
    lines.forEach((line, idx) => {
      ctx.fillStyle = idx === 4 ? '#4be3ff' : idx % 2 === 0 ? '#f472b6' : '#e2e8f0';
      ctx.fillText(line, 26, 84 + idx * 36);
    });
  } else {
    // Cute chibi face
    ctx.strokeStyle = '#4be3ff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(176, 150, 26, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(336, 150, 26, Math.PI, 0);
    ctx.stroke();
    ctx.strokeStyle = '#ff6ba8';
    ctx.beginPath();
    ctx.arc(236, 198, 20, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(276, 198, 20, 0, Math.PI);
    ctx.stroke();
  }
}

function createPosterTexture(title: string, accent: string, bg: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 340;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 340);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, 228, 312);

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(128, 138, 56, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(146, 126, 44, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 128, 262);
  ctx.font = '14px monospace';
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText('AIMOUTO NIGHT STUDIO', 128, 290);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createToyBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 256, 128);
  grad.addColorStop(0, '#ff85b3');
  grad.addColorStop(0.5, '#a78bfa');
  grad.addColorStop(1, '#4be3ff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  for (let i = 0; i < 8; i++) {
    const cx = 18 + i * 31;
    const cy = i % 2 === 0 ? 38 : 88;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createDieFaceTexture(pips: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fdf4ff';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#ff6ba8';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 116, 116);

  const dotCoords: Record<number, Array<[number, number]>> = {
    1: [[64, 64]],
    2: [[38, 38], [90, 90]],
    3: [[36, 36], [64, 64], [92, 92]],
    4: [[38, 38], [90, 38], [38, 90], [90, 90]],
    5: [[36, 36], [92, 36], [64, 64], [36, 92], [92, 92]],
    6: [[38, 32], [90, 32], [38, 64], [90, 64], [38, 96], [90, 96]],
  };
  const coords = dotCoords[pips] ?? dotCoords[1];
  ctx.fillStyle = pips === 1 ? '#ff477e' : '#1e293b';
  for (const [x, y] of coords) {
    ctx.beginPath();
    ctx.arc(x, y, pips === 1 ? 16 : 11, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Compact, high-density rainy-night study bedroom environment:
 * - Left Wall: Large Multi-Pane Window overlooking a rainy twilight cityscape + sill plants
 * - Attached to Window: Walnut Study Desk, Swivel Chair, Laptop, Desk Lamp, Steaming Mug, Books
 * - Behind the Desk: Cozy Single Bed with duvet, pillows, Sleepy Cat Plushie, Nightstand & Lamp
 * - Back Wall: Bookshelf, Vinyl Turntable, Fairy String Lights & Framed Holo-Art Display
 */
export class LofiRoomEnvironment {
  readonly group = new THREE.Group();
  readonly holoArtGroup = new THREE.Group();
  readonly interactiveProps = new Map<RoomPropId, InteractiveRoomProp>();
  readonly obstacles: RoomObstacle[] = [];
  private readonly dynamicPropGroups = new Map<
    'toy_ball' | 'floor_cushion' | 'plush_die',
    THREE.Group
  >();

  private readonly hemiLight: THREE.HemisphereLight;
  private readonly windowMoonLight: THREE.DirectionalLight;
  private readonly deskLampLight: THREE.PointLight;
  private readonly bedsideLampLight: THREE.PointLight;
  private readonly ceilingFillLight: THREE.DirectionalLight;

  private deskLampBulbMat!: THREE.MeshStandardMaterial;
  private bedsideBulbMat!: THREE.MeshStandardMaterial;
  private deskLampOn = true;
  private rainEnabled = true;
  private vinylSpinning = true;
  private laptopMode = 0;

  private laptopCanvas!: HTMLCanvasElement;
  private laptopTex!: THREE.CanvasTexture;
  private laptopRefreshTimer = 0;

  private vinylDisc!: THREE.Mesh;
  private catGroup!: THREE.Group;
  private catPurrBoost = 0;

  private rainMesh!: THREE.InstancedMesh;
  private rainDrops: Array<{y: number; z: number; speed: number}> = [];
  private readonly rainDummy = new THREE.Object3D();

  private steamMeshes: THREE.Mesh[] = [];
  private hoverRingMesh!: THREE.Mesh;
  private floorMarkerMesh!: THREE.Mesh;
  private floorMarkerLife = 0;

  private holoFrameMesh!: THREE.Mesh;
  private holoArtMat!: THREE.MeshBasicMaterial;
  private currentArtTex: THREE.Texture | null = null;
  private currentTheme: StageThemeId = 'midnight_neon';

  private readonly backWallGroup = new THREE.Group();
  private readonly rightWallGroup = new THREE.Group();
  private readonly leftWallGroup = new THREE.Group();
  private readonly ceilingGroup = new THREE.Group();

  private readonly disposables: Array<{dispose: () => void}> = [];

  constructor(private readonly isSoftwareGl: boolean) {
    this.group.name = 'CozyBedroomEnvironment';
    const track = <T extends {dispose: () => void}>(res: T): T => {
      this.disposables.push(res);
      return res;
    };

    const theme = STAGE_THEMES[this.currentTheme];

    // 1. Balanced Bedroom Lighting (1 shadow caster + warm practical lights + cool window light)
    this.hemiLight = new THREE.HemisphereLight(0xa3b9ff, 0x3b2722, 1.35);
    this.group.add(this.hemiLight);

    this.windowMoonLight = new THREE.DirectionalLight(0xaad4ff, 1.45);
    this.windowMoonLight.position.set(-3.2, 2.5, -1.3);
    this.windowMoonLight.target.position.set(0.2, 0.5, -1.9);
    this.windowMoonLight.castShadow = !isSoftwareGl;
    this.windowMoonLight.shadow.mapSize.set(1024, 1024);
    this.windowMoonLight.shadow.camera.left = -2.2;
    this.windowMoonLight.shadow.camera.right = 2.2;
    this.windowMoonLight.shadow.camera.top = 2.4;
    this.windowMoonLight.shadow.camera.bottom = -1.2;
    this.windowMoonLight.shadow.bias = -0.0005;
    this.windowMoonLight.shadow.normalBias = 0.02;
    this.group.add(this.windowMoonLight, this.windowMoonLight.target);

    // Soft front-top studio fill so VRM face stays crisp & readable
    this.ceilingFillLight = new THREE.DirectionalLight(0xfff0e0, 1.25);
    this.ceilingFillLight.position.set(1.2, 2.2, 1.6);
    this.ceilingFillLight.target.position.set(0, 1.0, -1.8);
    this.group.add(this.ceilingFillLight, this.ceilingFillLight.target);

    // Warm desk lamp practical light
    this.deskLampLight = new THREE.PointLight(0xffb86b, 2.1, 3.2, 1.6);
    this.deskLampLight.position.set(-1.18, 1.08, -2.35);
    this.group.add(this.deskLampLight);

    // Warm bedside mushroom lamp practical light
    this.bedsideLampLight = new THREE.PointLight(0xff9a62, 1.35, 2.8, 1.6);
    this.bedsideLampLight.position.set(0.08, 0.78, -2.72);
    this.group.add(this.bedsideLampLight);

    // Build room shell, furniture, interactive props, and wall holo frame
    this.buildRoomShell(track);
    this.buildWindowAndSky(track);
    this.buildDeskAndChair(track);
    this.buildBedAndCat(track);
    this.buildNightstandAndBookshelf(track);
    this.buildFairyLightsAndHoloFrame(track, theme.accentPink);
    this.buildDynamicPhysicsProps(track);
    this.buildInteractionMarkers(track);

    // Register walkable obstacle AABBs so avatar navigates around furniture
    this.obstacles.push(
      {id: 'desk', minX: -1.56, maxX: -0.78, minZ: -2.68, maxZ: -1.22},
      {id: 'desk_chair', minX: -0.76, maxX: -0.44, minZ: -2.18, maxZ: -1.72},
      {id: 'nightstand', minX: -0.22, maxX: 0.28, minZ: -3.05, maxZ: -2.50},
      {id: 'bed', minX: 0.28, maxX: 1.56, minZ: -3.05, maxZ: -1.04}
    );
  }

  get themeId(): StageThemeId {
    return this.currentTheme;
  }

  applyTheme(themeId: StageThemeId, scene?: THREE.Scene): void {
    this.currentTheme = themeId;
    const theme = STAGE_THEMES[themeId];
    this.hemiLight.color.setHex(theme.hemiSkyColor);
    this.windowMoonLight.color.setHex(theme.accentCyan);
    if (scene) {
      scene.background = new THREE.Color(theme.skyColor);
      scene.fog = new THREE.FogExp2(theme.fogColor, 0.045);
    }
  }

  /**
   * Ensures ceiling, right wall, back wall, and left wall never occlude the room
   * when rotating OrbitControls around or above the bedroom.
   */
  updateCameraCulling(camera: THREE.Camera): void {
    const p = camera.position;
    this.rightWallGroup.visible = p.x < 1.44;
    this.ceilingGroup.visible = p.y < 2.40;
    this.backWallGroup.visible = p.z > -3.00;
    this.leftWallGroup.visible = p.x > -1.46;
  }

  private buildRoomShell(track: <T extends {dispose: () => void}>(r: T) => T): void {
    const floorTex = track(createWoodPlankTexture());
    const floorMat = track(
      new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: 0.72,
        metalness: 0.06,
      })
    );
    const floor = new THREE.Mesh(track(new THREE.BoxGeometry(3.2, 0.08, 3.0)), floorMat);
    floor.position.set(0, -0.04, -1.65);
    floor.receiveShadow = true;
    floor.name = 'RoomFloor';
    this.group.add(floor);

    // Woven center rug (offset by +0.008m on Y to avoid Z-fighting)
    const rugTex = track(createWovenRugTexture());
    const rugMat = track(
      new THREE.MeshStandardMaterial({
        map: rugTex,
        roughness: 0.92,
        metalness: 0.02,
      })
    );
    const rug = new THREE.Mesh(track(new THREE.CylinderGeometry(0.68, 0.7, 0.014, 42)), rugMat);
    rug.scale.set(1.0, 1, 1.32);
    rug.position.set(-0.08, 0.007, -1.32);
    rug.receiveShadow = true;
    rug.name = 'WovenRug';
    this.group.add(rug);

    // Register clickable floor + rug for direct walk-to navigation
    this.interactiveProps.set('floor', {
      id: 'floor',
      label: '👣 여기로 걸어가기 (Walk Here)',
      approachPos: new THREE.Vector3(-0.08, 0, -1.32),
      approachYaw: 0,
      targetPose: 'idle',
      reachTargetWorld: new THREE.Vector3(-0.08, 0, -1.32),
      lookAtWorld: new THREE.Vector3(0, 1.1, 0),
      hoverAnchorWorld: new THREE.Vector3(-0.08, 0.05, -1.32),
      hitMeshes: [floor, rug],
    });

    // Warm muted twilight bedroom plaster walls (single-sided inward planes so outside camera angles never occlude)
    const wallMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x26243b,
        roughness: 0.88,
        metalness: 0.02,
        side: THREE.FrontSide,
      })
    );
    const woodTrimMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x3b261d,
        roughness: 0.56,
        metalness: 0.08,
      })
    );

    this.backWallGroup.name = 'RoomBackWall';
    this.rightWallGroup.name = 'RoomRightWall';
    this.leftWallGroup.name = 'RoomLeftWall';
    this.ceilingGroup.name = 'RoomCeiling';
    this.group.add(this.backWallGroup, this.rightWallGroup, this.leftWallGroup, this.ceilingGroup);

    // Back wall (z = -3.12, inward face +Z)
    const backWall = new THREE.Mesh(track(new THREE.PlaneGeometry(3.24, 2.52)), wallMat);
    backWall.position.set(0, 1.24, -3.12);
    backWall.receiveShadow = true;
    this.backWallGroup.add(backWall);

    // Right wall (x = +1.56, inward face -X)
    const rightWall = new THREE.Mesh(track(new THREE.PlaneGeometry(3.04, 2.52)), wallMat);
    rightWall.position.set(1.56, 1.24, -1.65);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.receiveShadow = true;
    this.rightWallGroup.add(rightWall);

    // Left wall built in 4 inward-facing segments around Window cutout (x = -1.56, window z: -2.62..-1.28, y: 0.78..2.06)
    const leftWallBottom = new THREE.Mesh(track(new THREE.PlaneGeometry(3.04, 0.78)), wallMat);
    leftWallBottom.position.set(-1.56, 0.39, -1.65);
    leftWallBottom.rotation.y = Math.PI / 2;
    const leftWallTop = new THREE.Mesh(track(new THREE.PlaneGeometry(3.04, 0.44)), wallMat);
    leftWallTop.position.set(-1.56, 2.28, -1.65);
    leftWallTop.rotation.y = Math.PI / 2;
    const leftWallBack = new THREE.Mesh(track(new THREE.PlaneGeometry(0.54, 1.28)), wallMat);
    leftWallBack.position.set(-1.56, 1.42, -2.89);
    leftWallBack.rotation.y = Math.PI / 2;
    const leftWallFront = new THREE.Mesh(track(new THREE.PlaneGeometry(1.12, 1.28)), wallMat);
    leftWallFront.position.set(-1.56, 1.42, -0.72);
    leftWallFront.rotation.y = Math.PI / 2;
    this.leftWallGroup.add(leftWallBottom, leftWallTop, leftWallBack, leftWallFront);

    // Ceiling (y = 2.50, inward face -Y so overhead OrbitControls looks cleanly down into the bedroom)
    const ceilingMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x1d1b2f,
        roughness: 0.9,
        side: THREE.FrontSide,
      })
    );
    const ceiling = new THREE.Mesh(track(new THREE.PlaneGeometry(3.24, 3.04)), ceilingMat);
    ceiling.position.set(0, 2.5, -1.65);
    ceiling.rotation.x = Math.PI / 2;
    this.ceilingGroup.add(ceiling);

    // Baseboards grouped with their parent wall for clean camera-angle culling
    const backBaseboard = new THREE.Mesh(track(new THREE.BoxGeometry(3.16, 0.11, 0.03)), woodTrimMat);
    backBaseboard.position.set(0, 0.055, -3.09);
    const rightBaseboard = new THREE.Mesh(track(new THREE.BoxGeometry(0.03, 0.11, 2.98)), woodTrimMat);
    rightBaseboard.position.set(1.53, 0.055, -1.65);
    const leftBaseboard = new THREE.Mesh(track(new THREE.BoxGeometry(0.03, 0.11, 2.98)), woodTrimMat);
    leftBaseboard.position.set(-1.53, 0.055, -1.65);
    this.backWallGroup.add(backBaseboard);
    this.rightWallGroup.add(rightBaseboard);
    this.leftWallGroup.add(leftBaseboard);
  }

  private buildWindowAndSky(track: <T extends {dispose: () => void}>(r: T) => T): void {
    const windowGroup = new THREE.Group();
    windowGroup.name = 'LofiWindow';
    const frameMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x4f3326,
        roughness: 0.55,
        metalness: 0.08,
      })
    );

    // Sill & outer frame (center z = -1.95, y = 0.78..2.06)
    const sill = new THREE.Mesh(track(new THREE.BoxGeometry(0.18, 0.045, 1.44)), frameMat);
    sill.position.set(-1.51, 0.78, -1.95);
    const header = new THREE.Mesh(track(new THREE.BoxGeometry(0.14, 0.06, 1.42)), frameMat);
    header.position.set(-1.54, 2.06, -1.95);
    const jambBack = new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 1.28, 0.06)), frameMat);
    jambBack.position.set(-1.54, 1.42, -2.62);
    const jambFront = new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 1.28, 0.06)), frameMat);
    jambFront.position.set(-1.54, 1.42, -1.28);
    const mullionV = new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 1.24, 0.04)), frameMat);
    mullionV.position.set(-1.55, 1.42, -1.95);
    const mullionH = new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 0.04, 1.30)), frameMat);
    mullionH.position.set(-1.55, 1.44, -1.95);
    windowGroup.add(sill, header, jambBack, jambFront, mullionV, mullionH);

    // Translucent glass pane (no transmission extra pass needed; crisp reflective glaze)
    const glassMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0x99ccff,
        transparent: true,
        opacity: 0.16,
        roughness: 0.08,
        metalness: 0.1,
        clearcoat: 1.0,
        depthWrite: false,
      })
    );
    const glass = new THREE.Mesh(track(new THREE.BoxGeometry(0.012, 1.22, 1.28)), glassMat);
    glass.position.set(-1.56, 1.42, -1.95);
    glass.renderOrder = 2;
    windowGroup.add(glass);

    // Curtain rod & cozy side drapes
    const rodMat = track(
      new THREE.MeshStandardMaterial({color: 0xd1a968, roughness: 0.25, metalness: 0.85})
    );
    const rod = new THREE.Mesh(track(new THREE.CylinderGeometry(0.014, 0.014, 1.62, 12)), rodMat);
    rod.rotation.x = Math.PI / 2;
    rod.position.set(-1.46, 2.13, -1.95);
    windowGroup.add(rod);

    const curtainMat = track(
      new THREE.MeshStandardMaterial({color: 0x7b5c8c, roughness: 0.86, metalness: 0.02})
    );
    for (const zSide of [-2.63, -1.27]) {
      for (let fold = 0; fold < 3; fold++) {
        const drape = new THREE.Mesh(
          track(new THREE.CylinderGeometry(0.038, 0.048, 1.38, 12)),
          curtainMat
        );
        drape.position.set(
          -1.45,
          1.44,
          zSide + (zSide < -2 ? fold * 0.055 : -fold * 0.055)
        );
        windowGroup.add(drape);
      }
    }

    // Small terracotta succulent plant on windowsill
    const potMat = track(new THREE.MeshStandardMaterial({color: 0xb85d43, roughness: 0.78}));
    const leafMat = track(new THREE.MeshStandardMaterial({color: 0x4ca66b, roughness: 0.55}));
    const pot = new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.036, 0.075, 14)), potMat);
    pot.position.set(-1.48, 0.84, -1.42);
    windowGroup.add(pot);
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(track(new THREE.ConeGeometry(0.024, 0.08, 8)), leafMat);
      const ang = (i / 6) * Math.PI * 2;
      leaf.position.set(-1.48 + Math.cos(ang) * 0.02, 0.90, -1.42 + Math.sin(ang) * 0.02);
      leaf.rotation.z = Math.cos(ang) * 0.45;
      leaf.rotation.x = Math.sin(ang) * 0.45;
      windowGroup.add(leaf);
    }

    // Exterior Night Skyline Backdrop outside window (x = -2.25)
    const skyTex = track(createNightSkyTexture());
    const skyMat = track(new THREE.MeshBasicMaterial({map: skyTex}));
    const skyBackdrop = new THREE.Mesh(track(new THREE.PlaneGeometry(2.6, 2.2)), skyMat);
    skyBackdrop.rotation.y = Math.PI / 2;
    skyBackdrop.position.set(-2.32, 1.42, -1.95);
    windowGroup.add(skyBackdrop);

    // Animated falling rain streaks outside window (InstancedMesh)
    const dropCount = 48;
    const dropGeo = track(new THREE.BoxGeometry(0.004, 0.085, 0.004));
    const dropMat = track(
      new THREE.MeshBasicMaterial({
        color: 0xa6e1ff,
        transparent: true,
        opacity: 0.65,
      })
    );
    this.rainMesh = new THREE.InstancedMesh(dropGeo, dropMat, dropCount);
    this.rainMesh.frustumCulled = false;
    for (let i = 0; i < dropCount; i++) {
      this.rainDrops.push({
        y: 0.8 + Math.random() * 1.35,
        z: -2.6 + Math.random() * 1.3,
        speed: 1.4 + Math.random() * 1.2,
      });
    }
    windowGroup.add(this.rainMesh);

    // Invisible larger raycast hit plane on window so clicking window is effortless
    const hitMat = track(new THREE.MeshBasicMaterial({visible: false}));
    const windowHit = new THREE.Mesh(track(new THREE.BoxGeometry(0.14, 1.25, 1.32)), hitMat);
    windowHit.position.set(-1.5, 1.42, -1.95);
    windowGroup.add(windowHit);

    this.group.add(windowGroup);

    this.interactiveProps.set('window', {
      id: 'window',
      label: '🪟 창밖 비 구경하기 (Look Out Window)',
      approachPos: new THREE.Vector3(-0.94, 0, -1.04),
      approachYaw: -Math.PI * 0.62,
      targetPose: 'look_window',
      reachTargetWorld: new THREE.Vector3(-1.38, 0.86, -1.35),
      lookAtWorld: new THREE.Vector3(-2.1, 1.35, -1.95),
      hoverAnchorWorld: new THREE.Vector3(-1.42, 1.55, -1.85),
      hitMeshes: [glass, windowHit, sill, mullionV, mullionH],
    });
  }

  private buildDeskAndChair(track: <T extends {dispose: () => void}>(r: T) => T): void {
    const deskGroup = new THREE.Group();
    deskGroup.name = 'LofiStudyDesk';

    const walnutMat = track(
      new THREE.MeshStandardMaterial({color: 0x6f4730, roughness: 0.48, metalness: 0.06})
    );
    const darkMetalMat = track(
      new THREE.MeshStandardMaterial({color: 0x24283d, roughness: 0.32, metalness: 0.78})
    );
    const brassMat = track(
      new THREE.MeshStandardMaterial({color: 0xd9a85b, roughness: 0.24, metalness: 0.88})
    );

    // Desktop flush against left window (x = -1.16, z = -1.95, y = 0.73)
    const desktop = new THREE.Mesh(track(new THREE.BoxGeometry(0.74, 0.04, 1.42)), walnutMat);
    desktop.position.set(-1.16, 0.72, -1.95);
    desktop.castShadow = true;
    desktop.receiveShadow = true;
    deskGroup.add(desktop);

    // 4 metal legs
    const legGeo = track(new THREE.CylinderGeometry(0.02, 0.016, 0.7, 12));
    for (const lx of [-1.48, -0.84]) {
      for (const lz of [-2.6, -1.3]) {
        const leg = new THREE.Mesh(legGeo, darkMetalMat);
        leg.position.set(lx, 0.35, lz);
        leg.castShadow = true;
        deskGroup.add(leg);
      }
    }

    // Drawer cabinet on far side of desk
    const cabinet = new THREE.Mesh(track(new THREE.BoxGeometry(0.62, 0.36, 0.38)), walnutMat);
    cabinet.position.set(-1.16, 0.52, -2.42);
    cabinet.castShadow = true;
    deskGroup.add(cabinet);
    for (const dy of [0.59, 0.44]) {
      const pull = new THREE.Mesh(track(new THREE.BoxGeometry(0.02, 0.018, 0.1)), brassMat);
      pull.position.set(-0.84, dy, -2.42);
      deskGroup.add(pull);
    }

    // Cozy felt desk mat
    const matMesh = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.42, 0.006, 0.78)),
      track(new THREE.MeshStandardMaterial({color: 0x2c3250, roughness: 0.92}))
    );
    matMesh.position.set(-1.10, 0.743, -1.90);
    deskGroup.add(matMesh);

    // 1) Laptop (interactive prop)
    const laptopGroup = new THREE.Group();
    laptopGroup.position.set(-1.20, 0.745, -1.92);
    laptopGroup.rotation.y = Math.PI / 2;

    const laptopBase = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.34, 0.014, 0.23)),
      track(new THREE.MeshStandardMaterial({color: 0xc2c8dc, roughness: 0.28, metalness: 0.72}))
    );
    laptopBase.position.y = 0.007;
    laptopGroup.add(laptopBase);

    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.014, -0.11);
    lidPivot.rotation.x = -0.26;
    const lidBack = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.34, 0.22, 0.01)),
      track(new THREE.MeshStandardMaterial({color: 0xa4acc6, roughness: 0.3, metalness: 0.72}))
    );
    lidBack.position.set(0, 0.11, 0);
    this.laptopCanvas = createLaptopScreenTexture(0, 0);
    this.laptopTex = track(new THREE.CanvasTexture(this.laptopCanvas));
    this.laptopTex.colorSpace = THREE.SRGBColorSpace;
    const screenMesh = new THREE.Mesh(
      track(new THREE.PlaneGeometry(0.31, 0.19)),
      track(
        new THREE.MeshBasicMaterial({
          map: this.laptopTex,
        })
      )
    );
    screenMesh.position.set(0, 0.11, 0.007);
    lidPivot.add(lidBack, screenMesh);
    laptopGroup.add(lidPivot);
    deskGroup.add(laptopGroup);

    this.interactiveProps.set('laptop', {
      id: 'laptop',
      label: '💻 노트북 화면 전환 / 타이핑 (Laptop)',
      approachPos: new THREE.Vector3(-0.58, 0, -1.95),
      approachYaw: -Math.PI / 2,
      targetPose: 'type_desk',
      reachTargetWorld: new THREE.Vector3(-1.12, 0.77, -1.92),
      lookAtWorld: new THREE.Vector3(-1.22, 0.88, -1.92),
      hoverAnchorWorld: new THREE.Vector3(-1.2, 1.02, -1.92),
      hitMeshes: [laptopBase, lidBack, screenMesh],
    });

    // 2) Articulated Desk Lamp (interactive prop)
    const lampGroup = new THREE.Group();
    lampGroup.position.set(-1.32, 0.74, -2.42);
    const lampBase = new THREE.Mesh(track(new THREE.CylinderGeometry(0.075, 0.085, 0.024, 18)), brassMat);
    lampBase.position.y = 0.012;
    const arm1 = new THREE.Mesh(track(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 10)), darkMetalMat);
    arm1.position.set(-0.02, 0.13, 0);
    arm1.rotation.z = 0.22;
    const arm2 = new THREE.Mesh(track(new THREE.CylinderGeometry(0.011, 0.011, 0.22, 10)), darkMetalMat);
    arm2.position.set(0.04, 0.28, 0.02);
    arm2.rotation.z = -0.65;
    const shade = new THREE.Mesh(
      track(new THREE.ConeGeometry(0.085, 0.12, 18, 1, true)),
      track(new THREE.MeshStandardMaterial({color: 0xe38a56, roughness: 0.4, side: THREE.DoubleSide}))
    );
    shade.position.set(0.12, 0.32, 0.04);
    shade.rotation.z = -0.55;
    this.deskLampBulbMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xffe4b3,
        emissive: 0xffb35c,
        emissiveIntensity: 2.2,
        roughness: 0.2,
      })
    );
    const bulb = new THREE.Mesh(track(new THREE.SphereGeometry(0.028, 12, 10)), this.deskLampBulbMat);
    bulb.position.set(0.13, 0.29, 0.04);
    lampGroup.add(lampBase, arm1, arm2, shade, bulb);
    deskGroup.add(lampGroup);

    this.interactiveProps.set('desk_lamp', {
      id: 'desk_lamp',
      label: '💡 책상 스탠드 켜기/끄기 (Desk Lamp)',
      approachPos: new THREE.Vector3(-0.62, 0, -2.35),
      approachYaw: -Math.PI * 0.55,
      targetPose: 'reach_prop',
      reachTargetWorld: new THREE.Vector3(-1.20, 1.04, -2.38),
      lookAtWorld: new THREE.Vector3(-1.30, 1.04, -2.42),
      hoverAnchorWorld: new THREE.Vector3(-1.26, 1.15, -2.4),
      hitMeshes: [lampBase, arm1, arm2, shade, bulb],
    });

    // 3) Steaming Ceramic Coffee Mug (interactive prop)
    const mugGroup = new THREE.Group();
    mugGroup.position.set(-0.96, 0.74, -1.48);
    const coaster = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.056, 0.058, 0.008, 18)),
      track(new THREE.MeshStandardMaterial({color: 0x8f6144, roughness: 0.8}))
    );
    coaster.position.y = 0.004;
    const mugMat = track(new THREE.MeshStandardMaterial({color: 0xf7e7dc, roughness: 0.25}));
    const mugBody = new THREE.Mesh(track(new THREE.CylinderGeometry(0.04, 0.036, 0.092, 18)), mugMat);
    mugBody.position.y = 0.052;
    const mugHandle = new THREE.Mesh(track(new THREE.TorusGeometry(0.024, 0.007, 8, 16, Math.PI)), mugMat);
    mugHandle.rotation.z = -Math.PI / 2;
    mugHandle.position.set(0.038, 0.052, 0);
    const coffeeDisc = new THREE.Mesh(
      track(new THREE.CircleGeometry(0.035, 16)),
      track(new THREE.MeshStandardMaterial({color: 0x2d1810, roughness: 0.15}))
    );
    coffeeDisc.rotation.x = -Math.PI / 2;
    coffeeDisc.position.y = 0.094;
    mugGroup.add(coaster, mugBody, mugHandle, coffeeDisc);

    // Animated steam puffs
    const steamMat = track(
      new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.28})
    );
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Mesh(track(new THREE.SphereGeometry(0.016, 8, 8)), steamMat);
      puff.position.set(-0.96, 0.86 + i * 0.045, -1.48);
      this.steamMeshes.push(puff);
      deskGroup.add(puff);
    }
    deskGroup.add(mugGroup);

    this.interactiveProps.set('coffee_mug', {
      id: 'coffee_mug',
      label: '☕ 따뜻한 커피 마시기 (Drink Coffee)',
      approachPos: new THREE.Vector3(-0.58, 0, -1.95),
      approachYaw: -Math.PI / 2,
      targetPose: 'sip_mug',
      reachTargetWorld: new THREE.Vector3(-0.96, 0.82, -1.48),
      lookAtWorld: new THREE.Vector3(-0.96, 0.82, -1.48),
      hoverAnchorWorld: new THREE.Vector3(-0.96, 0.94, -1.48),
      hitMeshes: [mugBody, mugHandle, coaster],
    });

    // Books stack & notebook clutter on desk
    const bookColors = [0xff6b8b, 0x4be3ff, 0xfbbf24];
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.18, 0.032, 0.24)),
        track(new THREE.MeshStandardMaterial({color: bookColors[i], roughness: 0.72}))
      );
      b.position.set(-1.35, 0.756 + i * 0.033, -1.42);
      b.rotation.y = (i - 1) * 0.14;
      deskGroup.add(b);
    }

    // 4) Swivel Study Chair tucked behind desk (x = -0.60, z = -1.95)
    const chairGroup = new THREE.Group();
    chairGroup.position.set(-0.58, 0, -1.95);
    const chairCushionMat = track(
      new THREE.MeshStandardMaterial({color: 0x3b446e, roughness: 0.78})
    );
    const chairStem = new THREE.Mesh(track(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 12)), darkMetalMat);
    chairStem.position.y = 0.22;
    chairGroup.add(chairStem);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(track(new THREE.BoxGeometry(0.24, 0.024, 0.03)), darkMetalMat);
      spoke.position.set(Math.cos(ang) * 0.11, 0.04, Math.sin(ang) * 0.11);
      spoke.rotation.y = -ang;
      chairGroup.add(spoke);
    }
    const seat = new THREE.Mesh(track(new THREE.BoxGeometry(0.42, 0.065, 0.42)), chairCushionMat);
    seat.position.y = 0.43;
    seat.castShadow = true;
    const backrest = new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 0.42, 0.38)), chairCushionMat);
    backrest.position.set(0.19, 0.66, 0);
    backrest.rotation.z = -0.1;
    backrest.castShadow = true;
    chairGroup.add(seat, backrest);
    deskGroup.add(chairGroup);

    this.interactiveProps.set('desk_chair', {
      id: 'desk_chair',
      label: '🪑 책상 의자에 앉기 (Sit at Desk)',
      approachPos: new THREE.Vector3(-0.58, 0, -1.95),
      approachYaw: -Math.PI / 2,
      targetPose: 'type_desk',
      reachTargetWorld: new THREE.Vector3(-1.12, 0.77, -1.92),
      lookAtWorld: new THREE.Vector3(-1.45, 1.15, -1.95),
      hoverAnchorWorld: new THREE.Vector3(-0.58, 0.95, -1.95),
      hitMeshes: [seat, backrest, chairStem],
    });

    this.group.add(deskGroup);
  }

  private buildBedAndCat(track: <T extends {dispose: () => void}>(r: T) => T): void {
    const bedGroup = new THREE.Group();
    bedGroup.name = 'LofiBed';
    bedGroup.position.set(0.88, 0, -2.04);

    const woodMat = track(new THREE.MeshStandardMaterial({color: 0x5c3a27, roughness: 0.55}));
    const sheetMat = track(new THREE.MeshStandardMaterial({color: 0xf1ebe4, roughness: 0.88}));
    const duvetMat = track(new THREE.MeshStandardMaterial({color: 0x675b8c, roughness: 0.85}));
    const pillowMat = track(new THREE.MeshStandardMaterial({color: 0xffd3df, roughness: 0.82}));

    // Bed frame + legs + headboard against back wall
    const frame = new THREE.Mesh(track(new THREE.BoxGeometry(1.12, 0.14, 1.88)), woodMat);
    frame.position.y = 0.19;
    frame.castShadow = true;
    frame.receiveShadow = true;
    const headboard = new THREE.Mesh(track(new THREE.BoxGeometry(1.14, 0.78, 0.07)), woodMat);
    headboard.position.set(0, 0.45, -0.92);
    headboard.castShadow = true;
    const footboard = new THREE.Mesh(track(new THREE.BoxGeometry(1.12, 0.34, 0.06)), woodMat);
    footboard.position.set(0, 0.22, 0.92);
    bedGroup.add(frame, headboard, footboard);

    for (const lx of [-0.5, 0.5]) {
      for (const lz of [-0.88, 0.88]) {
        const leg = new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 0.14, 0.06)), woodMat);
        leg.position.set(lx, 0.07, lz);
        bedGroup.add(leg);
      }
    }

    // Mattress & draped duvet
    const mattress = new THREE.Mesh(track(new THREE.BoxGeometry(1.04, 0.16, 1.78)), sheetMat);
    mattress.position.y = 0.34;
    mattress.receiveShadow = true;
    const duvet = new THREE.Mesh(track(new THREE.BoxGeometry(1.08, 0.12, 1.24)), duvetMat);
    duvet.position.set(0, 0.38, 0.24);
    duvet.castShadow = true;
    duvet.receiveShadow = true;
    bedGroup.add(mattress, duvet);

    // Two cozy pillows
    for (const px of [-0.25, 0.24]) {
      const pillow = new THREE.Mesh(track(new THREE.BoxGeometry(0.42, 0.12, 0.30)), pillowMat);
      pillow.position.set(px, 0.47, -0.66);
      pillow.rotation.x = 0.22;
      bedGroup.add(pillow);
    }

    // Sleepy Cat Plushie curled up on the bed (interactive prop)
    this.catGroup = new THREE.Group();
    this.catGroup.position.set(-0.22, 0.47, 0.25);
    const catMat = track(new THREE.MeshStandardMaterial({color: 0xf5b87a, roughness: 0.75}));
    const catBellyMat = track(new THREE.MeshStandardMaterial({color: 0xfff0df, roughness: 0.8}));
    const catBody = new THREE.Mesh(track(new THREE.SphereGeometry(0.11, 16, 12)), catMat);
    catBody.scale.set(1.15, 0.72, 1.28);
    const catHead = new THREE.Mesh(track(new THREE.SphereGeometry(0.075, 16, 12)), catMat);
    catHead.position.set(-0.04, 0.06, 0.10);
    const catCheek = new THREE.Mesh(track(new THREE.SphereGeometry(0.045, 10, 10)), catBellyMat);
    catCheek.position.set(-0.04, 0.04, 0.14);
    const earL = new THREE.Mesh(track(new THREE.ConeGeometry(0.025, 0.045, 8)), catMat);
    earL.position.set(-0.085, 0.125, 0.09);
    earL.rotation.z = 0.22;
    const earR = new THREE.Mesh(track(new THREE.ConeGeometry(0.025, 0.045, 8)), catMat);
    earR.position.set(0.005, 0.125, 0.09);
    earR.rotation.z = -0.22;
    const tail = new THREE.Mesh(track(new THREE.CylinderGeometry(0.015, 0.012, 0.18, 10)), catMat);
    tail.position.set(0.09, 0.01, -0.08);
    tail.rotation.z = Math.PI / 2.3;
    this.catGroup.add(catBody, catHead, catCheek, earL, earR, tail);
    bedGroup.add(this.catGroup);

    this.group.add(bedGroup);

    this.interactiveProps.set('bed', {
      id: 'bed',
      label: '🛏 침대에 걸터앉기 / 쉬기 (Sit on Bed)',
      approachPos: new THREE.Vector3(0.32, 0, -1.85),
      approachYaw: -Math.PI / 2,
      targetPose: 'sit_bed',
      reachTargetWorld: new THREE.Vector3(0.48, 0.44, -1.85),
      lookAtWorld: new THREE.Vector3(-0.3, 1.0, -1.1),
      hoverAnchorWorld: new THREE.Vector3(0.85, 0.72, -1.9),
      hitMeshes: [mattress, duvet, frame, headboard],
    });

    this.interactiveProps.set('cat_plushie', {
      id: 'cat_plushie',
      label: '🐱 고양이 쓰다듬기 (Pet Kitty)',
      approachPos: new THREE.Vector3(0.20, 0, -1.68),
      approachYaw: Math.PI * 0.42,
      targetPose: 'pet_cat',
      reachTargetWorld: new THREE.Vector3(0.66, 0.56, -1.79),
      lookAtWorld: new THREE.Vector3(0.66, 0.54, -1.79),
      hoverAnchorWorld: new THREE.Vector3(0.66, 0.72, -1.79),
      hitMeshes: [catBody, catHead, earL, earR],
    });
  }

  private buildNightstandAndBookshelf(
    track: <T extends {dispose: () => void}>(r: T) => T
  ): void {
    const woodMat = track(new THREE.MeshStandardMaterial({color: 0x5c3a27, roughness: 0.52}));

    // Bedside nightstand tucked cleanly between desk and bed (x = 0.06, z = -2.78)
    const nightstand = new THREE.Mesh(track(new THREE.BoxGeometry(0.42, 0.52, 0.42)), woodMat);
    nightstand.position.set(0.06, 0.26, -2.78);
    nightstand.castShadow = true;
    nightstand.receiveShadow = true;
    this.group.add(nightstand);

    // Mushroom bedside lamp on nightstand
    const stem = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.032, 0.048, 0.14, 14)),
      track(new THREE.MeshStandardMaterial({color: 0xfaf0e6, roughness: 0.4}))
    );
    stem.position.set(0.06, 0.59, -2.76);
    this.bedsideBulbMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xffd5a8,
        emissive: 0xff9d52,
        emissiveIntensity: 1.5,
        roughness: 0.3,
      })
    );
    const dome = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.088, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)),
      this.bedsideBulbMat
    );
    dome.position.set(0.06, 0.65, -2.76);
    this.group.add(stem, dome);

    // Floating Wall Bookshelf & Vinyl Turntable on back wall (x = -0.1, y = 1.48, z = -2.96)
    const shelfGroup = new THREE.Group();
    shelfGroup.position.set(-0.08, 1.46, -2.96);

    const plank = new THREE.Mesh(track(new THREE.BoxGeometry(0.92, 0.035, 0.24)), woodMat);
    plank.castShadow = true;
    shelfGroup.add(plank);

    // Colorful leaning books on shelf
    const colors = [0xff6ba8, 0x4be3ff, 0xa78bfa, 0x34d399, 0xfbbf24, 0xf87171];
    for (let i = 0; i < 6; i++) {
      const book = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.038, 0.19 + (i % 3) * 0.025, 0.16)),
        track(new THREE.MeshStandardMaterial({color: colors[i], roughness: 0.68}))
      );
      book.position.set(-0.34 + i * 0.048, 0.115, 0);
      if (i === 5) book.rotation.z = -0.22;
      shelfGroup.add(book);
    }

    // Vinyl Turntable on right side of shelf
    const ttBase = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.28, 0.038, 0.21)),
      track(new THREE.MeshStandardMaterial({color: 0x26293d, roughness: 0.35, metalness: 0.45}))
    );
    ttBase.position.set(0.22, 0.036, 0);
    this.vinylDisc = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.085, 0.085, 0.008, 24)),
      track(new THREE.MeshStandardMaterial({color: 0x0d0e15, roughness: 0.22, metalness: 0.4}))
    );
    this.vinylDisc.position.set(0.20, 0.06, 0);
    const vinylLabel = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.028, 0.028, 0.01, 16)),
      track(new THREE.MeshStandardMaterial({color: 0xff6ba8, roughness: 0.4}))
    );
    this.vinylDisc.add(vinylLabel);
    shelfGroup.add(ttBase, this.vinylDisc);

    this.group.add(shelfGroup);

    this.interactiveProps.set('bookshelf', {
      id: 'bookshelf',
      label: '🎵 바이닐 턴테이블 (Toggle Vinyl)',
      approachPos: new THREE.Vector3(-0.10, 0, -2.35),
      approachYaw: Math.PI,
      targetPose: 'reach_prop',
      reachTargetWorld: new THREE.Vector3(0.12, 1.48, -2.86),
      lookAtWorld: new THREE.Vector3(0.12, 1.54, -2.96),
      hoverAnchorWorld: new THREE.Vector3(0.12, 1.66, -2.92),
      hitMeshes: [plank, ttBase, this.vinylDisc],
    });
  }

  private buildFairyLightsAndHoloFrame(
    track: <T extends {dispose: () => void}>(r: T) => T,
    accentHex: number
  ): void {
    // Framed posters on back wall
    const poster1 = new THREE.Mesh(
      track(new THREE.PlaneGeometry(0.44, 0.58)),
      track(new THREE.MeshBasicMaterial({map: track(createPosterTexture('CHILL', '#4be3ff', '#161b3a'))}))
    );
    poster1.position.set(-0.98, 1.56, -3.09);
    this.backWallGroup.add(poster1);

    // Holo-Art Poster Frame mounted cleanly above the Bed on the back wall
    this.holoArtGroup.name = 'HoloArtFrame';
    this.holoArtGroup.position.set(0.88, 1.56, -3.08);
    this.holoArtGroup.visible = true;

    const frameBorder = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.62, 0.62, 0.028)),
      track(
        new THREE.MeshStandardMaterial({
          color: accentHex,
          emissive: accentHex,
          emissiveIntensity: 0.45,
          roughness: 0.3,
        })
      )
    );
    this.holoArtMat = track(
      new THREE.MeshBasicMaterial({
        map: track(createPosterTexture('AIMOUTO-XR', '#ff6ba8', '#141736')),
      })
    );
    this.holoFrameMesh = new THREE.Mesh(track(new THREE.PlaneGeometry(0.55, 0.55)), this.holoArtMat);
    this.holoFrameMesh.position.z = 0.017;
    this.holoArtGroup.add(frameBorder, this.holoFrameMesh);
    this.backWallGroup.add(this.holoArtGroup);

    // Warm fairy string lights draped across back wall
    const fairyCount = 18;
    const bulbGeo = track(new THREE.SphereGeometry(0.016, 8, 8));
    const bulbMat = track(new THREE.MeshBasicMaterial({color: 0xffd58f}));
    const fairyMesh = new THREE.InstancedMesh(bulbGeo, bulbMat, fairyCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < fairyCount; i++) {
      const t = i / (fairyCount - 1);
      const x = -1.35 + t * 2.7;
      const sag = Math.sin(t * Math.PI * 3) * 0.11;
      dummy.position.set(x, 2.24 - Math.abs(sag), -3.08);
      dummy.updateMatrix();
      fairyMesh.setMatrixAt(i, dummy.matrix);
    }
    fairyMesh.instanceMatrix.needsUpdate = true;
    this.backWallGroup.add(fairyMesh);
  }

  private buildDynamicPhysicsProps(
    track: <T extends {dispose: () => void}>(r: T) => T
  ): void {
    // 1. Starry pastel toy ball (radius = 0.085m, center synced by Rapier)
    const ballGroup = new THREE.Group();
    ballGroup.name = 'PhysicsToyBall';
    ballGroup.position.set(-0.34, 0.11, -1.02);

    const ballCore = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.085, 22, 18)),
      track(
        new THREE.MeshStandardMaterial({
          map: track(createToyBallTexture()),
          roughness: 0.42,
          metalness: 0.08,
        })
      )
    );
    ballCore.castShadow = true;
    ballCore.receiveShadow = true;

    const seamMatCyan = track(
      new THREE.MeshStandardMaterial({
        color: 0x4be3ff,
        emissive: 0x164e63,
        roughness: 0.25,
        metalness: 0.35,
      })
    );
    const seamMatPink = track(
      new THREE.MeshStandardMaterial({
        color: 0xff6ba8,
        emissive: 0x581c45,
        roughness: 0.25,
        metalness: 0.35,
      })
    );
    const eqRing = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.0855, 0.0055, 8, 28)),
      seamMatCyan
    );
    const merRing = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.0855, 0.005, 8, 28)),
      seamMatPink
    );
    merRing.rotation.y = Math.PI / 2;
    const poleGeo = track(new THREE.SphereGeometry(0.015, 10, 8));
    const capN = new THREE.Mesh(poleGeo, seamMatPink);
    capN.position.y = 0.082;
    const capS = new THREE.Mesh(poleGeo, seamMatCyan);
    capS.position.y = -0.082;

    ballGroup.add(ballCore, eqRing, merRing, capN, capS);
    this.group.add(ballGroup);
    this.dynamicPropGroups.set('toy_ball', ballGroup);

    this.interactiveProps.set('toy_ball', {
      id: 'toy_ball',
      label: '🏀 별빛 공 튕기기 (Bounce Toy Ball)',
      approachPos: new THREE.Vector3(-0.34, 0, -0.78),
      approachYaw: Math.PI,
      targetPose: 'reach_prop',
      reachTargetWorld: new THREE.Vector3(-0.34, 0.11, -1.02),
      lookAtWorld: new THREE.Vector3(-0.34, 0.14, -1.02),
      hoverAnchorWorld: new THREE.Vector3(-0.34, 0.25, -1.02),
      hitMeshes: [ballCore, eqRing, merRing],
    });

    // 2. Tufted plush floor cushion (0.38 x 0.11 x 0.38m)
    const cushionGroup = new THREE.Group();
    cushionGroup.name = 'PhysicsFloorCushion';
    cushionGroup.position.set(0.54, 0.06, -1.14);

    const cushionMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x7b6ba8,
        roughness: 0.88,
        metalness: 0.02,
      })
    );
    const trimMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xff85b3,
        roughness: 0.72,
      })
    );
    const cushionBase = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.185, 0.205, 0.085, 24)),
      cushionMat
    );
    cushionBase.scale.set(1.04, 1, 1.04);
    cushionBase.castShadow = true;
    cushionBase.receiveShadow = true;

    const cushionTrim = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.186, 0.012, 8, 28)),
      trimMat
    );
    cushionTrim.rotation.x = Math.PI / 2;
    cushionTrim.position.y = 0.036;

    const centerTuft = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.024, 0.024, 0.022, 14)),
      trimMat
    );
    centerTuft.position.y = 0.042;

    cushionGroup.add(cushionBase, cushionTrim, centerTuft);
    const tasselGeo = track(new THREE.SphereGeometry(0.017, 10, 8));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const tassel = new THREE.Mesh(tasselGeo, trimMat);
        tassel.position.set(sx * 0.155, -0.02, sz * 0.155);
        cushionGroup.add(tassel);
      }
    }
    this.group.add(cushionGroup);
    this.dynamicPropGroups.set('floor_cushion', cushionGroup);

    this.interactiveProps.set('floor_cushion', {
      id: 'floor_cushion',
      label: '🛋 방석 툭 밀기 (Nudge Cushion)',
      approachPos: new THREE.Vector3(0.26, 0, -1.14),
      approachYaw: Math.PI / 2,
      targetPose: 'reach_prop',
      reachTargetWorld: new THREE.Vector3(0.54, 0.09, -1.14),
      lookAtWorld: new THREE.Vector3(0.54, 0.1, -1.14),
      hoverAnchorWorld: new THREE.Vector3(0.54, 0.24, -1.14),
      hitMeshes: [cushionBase, cushionTrim, centerTuft],
    });

    // 3. Soft six-sided plush die (0.144m cube)
    const dieGroup = new THREE.Group();
    dieGroup.name = 'PhysicsPlushDie';
    dieGroup.position.set(-0.14, 0.09, -0.82);

    const dieMats = [1, 6, 2, 5, 3, 4].map((pips) =>
      track(
        new THREE.MeshStandardMaterial({
          map: track(createDieFaceTexture(pips)),
          roughness: 0.78,
          metalness: 0.04,
        })
      )
    );
    const dieCube = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.142, 0.142, 0.142)),
      dieMats
    );
    dieCube.castShadow = true;
    dieCube.receiveShadow = true;
    dieGroup.add(dieCube);

    const studGeo = track(new THREE.SphereGeometry(0.012, 8, 8));
    for (const sx of [-0.064, 0.064]) {
      for (const sy of [-0.064, 0.064]) {
        for (const sz of [-0.064, 0.064]) {
          const stud = new THREE.Mesh(studGeo, seamMatPink);
          stud.position.set(sx, sy, sz);
          dieGroup.add(stud);
        }
      }
    }

    this.group.add(dieGroup);
    this.dynamicPropGroups.set('plush_die', dieGroup);

    this.interactiveProps.set('plush_die', {
      id: 'plush_die',
      label: '🎲 플러시 주사위 굴리기 (Roll Plush Die)',
      approachPos: new THREE.Vector3(-0.14, 0, -0.62),
      approachYaw: Math.PI,
      targetPose: 'reach_prop',
      reachTargetWorld: new THREE.Vector3(-0.14, 0.09, -0.82),
      lookAtWorld: new THREE.Vector3(-0.14, 0.12, -0.82),
      hoverAnchorWorld: new THREE.Vector3(-0.14, 0.24, -0.82),
      hitMeshes: [dieCube],
    });
  }

  syncDynamicPropPose(
    id: 'toy_ball' | 'floor_cushion' | 'plush_die',
    pose: {x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number}
  ): void {
    const group = this.dynamicPropGroups.get(id);
    if (group) {
      group.position.set(pose.x, pose.y, pose.z);
      group.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
    }
    const prop = this.interactiveProps.get(id);
    if (prop) {
      prop.reachTargetWorld.set(pose.x, pose.y, pose.z);
      prop.lookAtWorld.set(pose.x, pose.y + 0.04, pose.z);
      prop.hoverAnchorWorld.set(pose.x, pose.y + 0.18, pose.z);
      prop.approachPos.set(
        THREE.MathUtils.clamp(pose.x, ROOM_WALK_BOUNDS.minX, ROOM_WALK_BOUNDS.maxX),
        0,
        THREE.MathUtils.clamp(pose.z + 0.22, ROOM_WALK_BOUNDS.minZ, ROOM_WALK_BOUNDS.maxZ)
      );
    }
  }

  private buildInteractionMarkers(track: <T extends {dispose: () => void}>(r: T) => T): void {
    this.hoverRingMesh = new THREE.Mesh(
      track(new THREE.RingGeometry(0.11, 0.14, 28)),
      track(
        new THREE.MeshBasicMaterial({
          color: 0x4be3ff,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      )
    );
    this.hoverRingMesh.rotation.x = -Math.PI / 2;
    this.hoverRingMesh.visible = false;
    this.group.add(this.hoverRingMesh);

    this.floorMarkerMesh = new THREE.Mesh(
      track(new THREE.RingGeometry(0.13, 0.17, 28)),
      track(
        new THREE.MeshBasicMaterial({
          color: 0xff6ba8,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      )
    );
    this.floorMarkerMesh.rotation.x = -Math.PI / 2;
    this.floorMarkerMesh.visible = false;
    this.group.add(this.floorMarkerMesh);
  }

  showFloorDestinationMarker(x: number, z: number): void {
    this.floorMarkerMesh.position.set(x, 0.022, z);
    this.floorMarkerMesh.visible = true;
    this.floorMarkerLife = 1.0;
  }

  setHoveredProp(prop: InteractiveRoomProp | null, floorPoint?: THREE.Vector3): void {
    if (!prop) {
      this.hoverRingMesh.visible = false;
      return;
    }
    if (prop.id === 'floor' && floorPoint) {
      this.hoverRingMesh.position.set(floorPoint.x, 0.02, floorPoint.z);
    } else {
      this.hoverRingMesh.position.set(
        prop.approachPos.x,
        0.02,
        prop.approachPos.z
      );
    }
    this.hoverRingMesh.visible = true;
  }

  triggerPropEffect(propId: RoomPropId): string {
    if (propId === 'desk_lamp') {
      this.deskLampOn = !this.deskLampOn;
      this.deskLampLight.intensity = this.deskLampOn ? 2.1 : 0.12;
      this.deskLampBulbMat.emissiveIntensity = this.deskLampOn ? 2.2 : 0.1;
      return this.deskLampOn ? '책상 스탠드를 켰어요!' : '책상 스탠드를 은은하게 줄였어요!';
    }
    if (propId === 'laptop') {
      this.laptopMode = (this.laptopMode + 1) % 3;
      drawLaptopScreen(this.laptopCanvas, this.laptopMode, performance.now() * 0.001);
      this.laptopTex.needsUpdate = true;
      return '노트북 화면 모드를 바꿨어요!';
    }
    if (propId === 'window') {
      this.rainEnabled = !this.rainEnabled;
      this.rainMesh.visible = this.rainEnabled;
      return this.rainEnabled
        ? '창밖에 잔잔한 밤비가 내리기 시작했어요.'
        : '창밖 빗소리가 멈추고 맑은 밤하늘이 보여요.';
    }
    if (propId === 'bookshelf') {
      this.vinylSpinning = !this.vinylSpinning;
      return this.vinylSpinning
        ? '바이닐 턴테이블을 다시 재생했어요!'
        : '바이닐 턴테이블을 잠시 멈췄어요.';
    }
    if (propId === 'cat_plushie') {
      this.catPurrBoost = 1.2;
      return '냥이를 쓰담쓰담! 골골송이 들리는 것 같아요~';
    }
    return '';
  }

  getAllHitMeshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const prop of this.interactiveProps.values()) {
      out.push(...prop.hitMeshes);
    }
    return out;
  }

  findPropByMesh(obj: THREE.Object3D): InteractiveRoomProp | null {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      for (const prop of this.interactiveProps.values()) {
        if (prop.hitMeshes.includes(cur)) return prop;
      }
      cur = cur.parent;
    }
    return null;
  }

  showGeneratedArt(imageUrl: string): void {
    const loader = new THREE.TextureLoader();
    loader.load(imageUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      this.currentArtTex?.dispose();
      this.currentArtTex = texture;
      this.holoArtMat.map = texture;
      this.holoArtMat.needsUpdate = true;
      this.holoArtGroup.visible = true;
    });
  }

  update(elapsed: number, dt: number): void {
    // Animate rain drops outside the left window
    if (this.rainEnabled && this.rainMesh) {
      for (let i = 0; i < this.rainDrops.length; i++) {
        const drop = this.rainDrops[i];
        drop.y -= drop.speed * dt;
        if (drop.y < 0.78) {
          drop.y = 2.08;
          drop.z = -2.6 + Math.random() * 1.3;
        }
        this.rainDummy.position.set(-1.66, drop.y, drop.z);
        this.rainDummy.updateMatrix();
        this.rainMesh.setMatrixAt(i, this.rainDummy.matrix);
      }
      this.rainMesh.instanceMatrix.needsUpdate = true;
    }

    // Animate coffee mug steam
    for (let i = 0; i < this.steamMeshes.length; i++) {
      const puff = this.steamMeshes[i];
      const phase = (elapsed * 0.55 + i * 0.33) % 1;
      puff.position.y = 0.85 + phase * 0.16;
      puff.position.x = -0.96 + Math.sin(elapsed * 2.1 + i) * 0.012;
      puff.scale.setScalar(0.6 + phase * 0.9);
    }

    // Spin vinyl record on shelf
    if (this.vinylSpinning && this.vinylDisc) {
      this.vinylDisc.rotation.y += dt * 1.8;
    }

    // Refresh animated laptop waveform periodically
    this.laptopRefreshTimer += dt;
    if (this.laptopMode === 0 && this.laptopRefreshTimer > 0.18) {
      this.laptopRefreshTimer = 0;
      drawLaptopScreen(this.laptopCanvas, 0, elapsed);
      this.laptopTex.needsUpdate = true;
    }

    // Cat plushie purr bounce
    if (this.catPurrBoost > 0) {
      this.catPurrBoost = Math.max(0, this.catPurrBoost - dt);
      this.catGroup.position.y = 0.47 + Math.abs(Math.sin(elapsed * 14)) * 0.03 * this.catPurrBoost;
    } else {
      this.catGroup.position.y = 0.47 + Math.sin(elapsed * 1.6) * 0.004;
    }

    // Floor marker fade-out
    if (this.floorMarkerLife > 0) {
      this.floorMarkerLife = Math.max(0, this.floorMarkerLife - dt * 1.1);
      this.floorMarkerMesh.scale.setScalar(1.3 - this.floorMarkerLife * 0.35);
      (this.floorMarkerMesh.material as THREE.MeshBasicMaterial).opacity =
        this.floorMarkerLife * 0.85;
      if (this.floorMarkerLife <= 0) {
        this.floorMarkerMesh.visible = false;
      }
    }
  }

  dispose(): void {
    this.currentArtTex?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
