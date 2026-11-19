import * as THREE from 'three';
import {STAGE_THEMES} from '../constants';
import {StageThemeId} from '../types';

function createRadialContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 124);
  grad.addColorStop(0, 'rgba(6, 8, 22, 0.72)');
  grad.addColorStop(0.55, 'rgba(10, 14, 38, 0.35)');
  grad.addColorStop(1, 'rgba(10, 14, 38, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createCyberFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0c0f24';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = 'rgba(75, 227, 255, 0.16)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255, 107, 168, 0.1)';
  ctx.lineWidth = 1;
  for (let i = 32; i < 512; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(14, 14);
  return texture;
}

/**
 * Multi-part studio dais, warm/cool 3-point lighting, instanced starlight
 * particles, and a floating 3D Holo-Art Frame for displaying generated images.
 */
export class AvatarStage {
  readonly group = new THREE.Group();
  readonly holoArtGroup = new THREE.Group();

  private readonly hemiLight: THREE.HemisphereLight;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;

  private readonly daisRingMat: THREE.MeshStandardMaterial;
  private readonly daisCoreMat: THREE.MeshStandardMaterial;
  private readonly floorMat: THREE.MeshStandardMaterial;
  private readonly starsMesh: THREE.InstancedMesh;
  private readonly starAngles: Float32Array;
  private readonly starBaseY: Float32Array;
  private readonly starRadii: Float32Array;
  private readonly starDummy = new THREE.Object3D();

  private readonly holoFrameMesh: THREE.Mesh;
  private readonly holoArtMat: THREE.MeshBasicMaterial;
  private currentArtTex: THREE.Texture | null = null;
  private readonly disposables: Array<{dispose: () => void}> = [];

  private currentTheme: StageThemeId = 'midnight_neon';

  constructor(isSoftwareGl: boolean) {
    this.group.name = 'NeuroStudioStage';
    const track = <T extends {dispose: () => void}>(r: T): T => {
      this.disposables.push(r);
      return r;
    };

    const theme = STAGE_THEMES[this.currentTheme];

    // Warm/cool 3-point anime portrait lighting aimed directly at avatar chest/face
    this.hemiLight = new THREE.HemisphereLight(
      theme.hemiSkyColor,
      theme.hemiGroundColor,
      1.85
    );
    this.group.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(theme.keyLightColor, 1.95);
    this.keyLight.position.set(1.4, 2.3, 3.2);
    this.keyLight.target.position.set(0, 1.05, 0);
    this.keyLight.castShadow = !isSoftwareGl;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.left = -1.6;
    this.keyLight.shadow.camera.right = 1.6;
    this.keyLight.shadow.camera.top = 2.4;
    this.keyLight.shadow.camera.bottom = -0.4;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.group.add(this.keyLight, this.keyLight.target);

    this.fillLight = new THREE.DirectionalLight(0xffeef8, 1.15);
    this.fillLight.position.set(-1.3, 1.45, 3.0);
    this.fillLight.target.position.set(0, 1.15, 0);
    this.group.add(this.fillLight, this.fillLight.target);

    this.rimLight = new THREE.DirectionalLight(theme.accentCyan, 1.35);
    this.rimLight.position.set(-1.8, 2.1, -2.0);
    this.rimLight.target.position.set(0, 1.05, 0);
    this.group.add(this.rimLight, this.rimLight.target);

    // Wide cyber studio floor
    const floorTex = track(createCyberFloorTexture());
    this.floorMat = track(
      new THREE.MeshStandardMaterial({
        map: floorTex,
        color: 0xffffff,
        roughness: 0.78,
        metalness: 0.15,
      })
    );
    const floorMesh = new THREE.Mesh(
      track(new THREE.CircleGeometry(14, 48)),
      this.floorMat
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.04;
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);

    // Multi-part beveled idol dais (sits flush at avatar feet y=0)
    const daisBaseMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x161b3a,
        roughness: 0.45,
        metalness: 0.4,
      })
    );
    this.daisCoreMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x111530,
        roughness: 0.28,
        metalness: 0.35,
      })
    );
    this.daisRingMat = track(
      new THREE.MeshStandardMaterial({
        color: theme.accentPink,
        emissive: theme.accentPink,
        emissiveIntensity: 0.75,
        roughness: 0.2,
        metalness: 0.5,
      })
    );

    const daisBase = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.68, 0.76, 0.04, 48)),
      daisBaseMat
    );
    daisBase.position.y = -0.02;
    daisBase.receiveShadow = true;

    const daisTop = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.58, 0.62, 0.018, 48)),
      this.daisCoreMat
    );
    daisTop.position.y = -0.008;
    daisTop.receiveShadow = true;

    const daisRing = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.63, 0.012, 12, 48)),
      this.daisRingMat
    );
    daisRing.rotation.x = Math.PI / 2;
    daisRing.position.y = 0.002;

    // Soft radial contact shadow directly beneath avatar boots
    const shadowTex = track(createRadialContactShadowTexture());
    const contactShadow = new THREE.Mesh(
      track(new THREE.CircleGeometry(0.42, 32)),
      track(
        new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        })
      )
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = 0.005;

    this.group.add(daisBase, daisTop, daisRing, contactShadow);

    // Instanced floating starlight motes
    const starCount = 48;
    const starGeo = track(new THREE.OctahedronGeometry(0.018, 0));
    const starMat = track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
      })
    );
    this.starsMesh = new THREE.InstancedMesh(starGeo, starMat, starCount);
    this.starsMesh.frustumCulled = false;
    this.starAngles = new Float32Array(starCount);
    this.starBaseY = new Float32Array(starCount);
    this.starRadii = new Float32Array(starCount);
    const tint = new THREE.Color();

    for (let i = 0; i < starCount; i++) {
      this.starAngles[i] = (i / starCount) * Math.PI * 2;
      this.starBaseY[i] = 0.25 + (i % 7) * 0.28;
      this.starRadii[i] = 1.15 + (i % 5) * 0.42;
      tint.setHex(i % 2 === 0 ? theme.accentCyan : theme.accentPink);
      this.starsMesh.setColorAt(i, tint);
    }
    this.group.add(this.starsMesh);

    // Floating 3D Holo-Art Frame (for displaying generated gemini-3-pro-image-preview art)
    this.holoArtGroup.name = 'HoloArtFrame';
    this.holoArtGroup.position.set(-0.82, 1.25, -0.35);
    this.holoArtGroup.rotation.y = 0.45;
    this.holoArtGroup.visible = false;

    const frameBezel = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.56, 0.56, 0.025)),
      daisBaseMat
    );
    const frameBorder = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.58, 0.58, 0.016)),
      this.daisRingMat
    );
    frameBorder.position.z = -0.006;

    this.holoArtMat = track(
      new THREE.MeshBasicMaterial({color: 0xffffff})
    );
    this.holoFrameMesh = new THREE.Mesh(
      track(new THREE.PlaneGeometry(0.5, 0.5)),
      this.holoArtMat
    );
    this.holoFrameMesh.position.z = 0.015;
    this.holoArtGroup.add(frameBorder, frameBezel, this.holoFrameMesh);
    this.group.add(this.holoArtGroup);
  }

  get themeId(): StageThemeId {
    return this.currentTheme;
  }

  applyTheme(themeId: StageThemeId, scene?: THREE.Scene): void {
    this.currentTheme = themeId;
    const theme = STAGE_THEMES[themeId];
    this.hemiLight.color.setHex(theme.hemiSkyColor);
    this.hemiLight.groundColor.setHex(theme.hemiGroundColor);
    this.keyLight.color.setHex(theme.keyLightColor);
    this.rimLight.color.setHex(theme.accentCyan);
    this.daisRingMat.color.setHex(theme.accentPink);
    this.daisRingMat.emissive.setHex(theme.accentPink);

    if (scene) {
      scene.background = new THREE.Color(theme.skyColor);
      scene.fog = new THREE.FogExp2(theme.fogColor, 0.065);
    }
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

  update(elapsed: number): void {
    for (let i = 0; i < this.starsMesh.count; i++) {
      const angle = this.starAngles[i] + elapsed * 0.18;
      const r = this.starRadii[i];
      const y = this.starBaseY[i] + Math.sin(elapsed * 1.4 + i) * 0.09;
      this.starDummy.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
      this.starDummy.rotation.set(elapsed + i, elapsed * 0.8, 0);
      const s = 0.65 + 0.35 * Math.sin(elapsed * 2.5 + i);
      this.starDummy.scale.setScalar(s);
      this.starDummy.updateMatrix();
      this.starsMesh.setMatrixAt(i, this.starDummy.matrix);
    }
    this.starsMesh.instanceMatrix.needsUpdate = true;

    if (this.holoArtGroup.visible) {
      this.holoArtGroup.position.y = 1.25 + Math.sin(elapsed * 1.6) * 0.03;
    }
  }

  dispose(): void {
    this.currentArtTex?.dispose();
    for (const res of this.disposables) {
      res.dispose();
    }
  }
}
