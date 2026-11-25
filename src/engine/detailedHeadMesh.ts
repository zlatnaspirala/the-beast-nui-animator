import * as THREE from 'three';
import {
  FACIAL_BLENDSHAPES,
  type FacialBlendshapeMap,
  type FacialBlendshapeName,
} from '../types/mocap';

export interface DetailedHeadRig {
  group: THREE.Group;
  faceMesh: THREE.Mesh;
  jawPivot: THREE.Group;
  leftEyePivot: THREE.Group;
  rightEyePivot: THREE.Group;
  leftUpperLid: THREE.Mesh;
  leftLowerLid: THREE.Mesh;
  rightUpperLid: THREE.Mesh;
  rightLowerLid: THREE.Mesh;
  leftBrowPlate: THREE.Group;
  rightBrowPlate: THREE.Group;
  applyBlendshapes: (shapes: FacialBlendshapeMap) => void;
}

const MORPH_NAMES: FacialBlendshapeName[] = [
  'jawOpen',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthPucker',
  'mouthFunnel',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'browDownLeft',
  'browDownRight',
  'cheekPuff',
];

function gaussian2D(
  x: number,
  y: number,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
): number {
  const dx = (x - cx) / sx;
  const dy = (y - cy) / sy;
  return Math.exp(-0.5 * (dx * dx + dy * dy));
}

function buildSculptedFaceGeometry(): THREE.BufferGeometry {
  const segU = 52;
  const segV = 40;
  const geo = new THREE.SphereGeometry(0.084, segU, segV);
  const pos = geo.attributes.position;
  const count = pos.count;

  const colors = new Float32Array(count * 3);
  const basePositions = new Float32Array(count * 3);

  const cCranium = new THREE.Color(0x333c4d);
  const cFaceMask = new THREE.Color(0x475266);
  const cOrbit = new THREE.Color(0x141820);
  const cNose = new THREE.Color(0x556278);
  const cLip = new THREE.Color(0x222834);
  const cJaw = new THREE.Color(0x28303e);
  const tmpCol = new THREE.Color();

  // Sculpt anatomical humanoid head contour (centered near y=0, facing +Z)
  for (let i = 0; i < count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    // Proportions: narrower jaw, wider cranium, taller head
    x *= 0.90;
    y *= 1.24;
    z *= 1.06;

    // Taper lower jaw & chin
    if (y < 0) {
      const jawT = THREE.MathUtils.clamp(-y / 0.104, 0, 1);
      x *= 1 - jawT * 0.34;
      if (z > 0) {
        z += jawT * 0.008;
      } else {
        z *= 1 - jawT * 0.25;
      }
    }

    // Back of skull fullness
    if (z < 0 && y > -0.02) {
      z *= 1.08;
    }

    // Flatten temples slightly
    const templeW = gaussian2D(Math.abs(x), y, 0.068, 0.03, 0.022, 0.035);
    x -= Math.sign(x) * templeW * 0.006;

    // Front facial sculpting (z > 0)
    let orbitWeight = 0;
    let noseWeight = 0;
    let lipWeight = 0;

    if (z > 0.015) {
      // Orbital eye sockets (recessed hollows)
      const leftEyeW = gaussian2D(x, y, 0.029, 0.018, 0.016, 0.012);
      const rightEyeW = gaussian2D(x, y, -0.029, 0.018, 0.016, 0.012);
      orbitWeight = Math.min(1, leftEyeW + rightEyeW);
      z -= orbitWeight * 0.016;

      // Brow ridge protrusion
      const browW =
        gaussian2D(x, y, 0.028, 0.037, 0.022, 0.009) +
        gaussian2D(x, y, -0.028, 0.037, 0.022, 0.009);
      z += browW * 0.008;

      // Nose bridge & tip
      const bridgeW = gaussian2D(x, y, 0, 0.008, 0.011, 0.022);
      const tipW = gaussian2D(x, y, 0, -0.013, 0.012, 0.010);
      noseWeight = Math.min(1, bridgeW * 0.8 + tipW);
      z += bridgeW * 0.014 + tipW * 0.021;

      // Cheekbone (zygomatic) highlight
      const cheekW =
        gaussian2D(x, y, 0.042, -0.008, 0.018, 0.015) +
        gaussian2D(x, y, -0.042, -0.008, 0.018, 0.015);
      z += cheekW * 0.007;
      x += Math.sign(x) * cheekW * 0.004;

      // Upper & lower lips + subtle mouth seam
      const lipCushion = gaussian2D(x, y, 0, -0.041, 0.022, 0.011);
      const mouthSeam = gaussian2D(x, y, 0, -0.042, 0.020, 0.003);
      lipWeight = Math.min(1, lipCushion * 0.85);
      z += lipCushion * 0.008 - mouthSeam * 0.006;

      // Chin prominence
      const chinW = gaussian2D(x, y, 0, -0.076, 0.020, 0.014);
      z += chinW * 0.011;
    }

    // Offset head center up to sit nicely above Neck (0, 0.10, 0.004)
    const wy = y + 0.095;
    const wz = z + 0.006;

    pos.setXYZ(i, x, wy, wz);
    basePositions[i * 3] = x;
    basePositions[i * 3 + 1] = wy;
    basePositions[i * 3 + 2] = wz;

    // Color blending
    tmpCol.copy(cCranium);
    if (wz > 0.025) {
      const maskBlend = THREE.MathUtils.clamp((wz - 0.025) / 0.035, 0, 1);
      tmpCol.lerp(cFaceMask, maskBlend);
    }
    if (wy < 0.055) {
      const jawBlend = THREE.MathUtils.clamp((0.055 - wy) / 0.04, 0, 0.7);
      tmpCol.lerp(cJaw, jawBlend);
    }
    if (noseWeight > 0.05) {
      tmpCol.lerp(cNose, noseWeight * 0.55);
    }
    if (lipWeight > 0.05) {
      tmpCol.lerp(cLip, lipWeight * 0.75);
    }
    if (orbitWeight > 0.05) {
      tmpCol.lerp(cOrbit, orbitWeight * 0.92);
    }

    colors[i * 3] = tmpCol.r;
    colors[i * 3 + 1] = tmpCol.g;
    colors[i * 3 + 2] = tmpCol.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // Build GLTF-compatible morphAttributes.position
  const morphPosAttrs: THREE.BufferAttribute[] = [];

  for (const morphName of MORPH_NAMES) {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const bx = basePositions[i * 3];
      const by = basePositions[i * 3 + 1];
      const bz = basePositions[i * 3 + 2];
      // Relative to face center (y=0.095)
      const yRel = by - 0.095;

      let dx = 0;
      let dy = 0;
      let dz = 0;

      if (bz > 0.01) {
        if (morphName === 'jawOpen') {
          const w =
            gaussian2D(bx, yRel, 0, -0.068, 0.055, 0.034) *
            THREE.MathUtils.clamp((-0.036 - yRel) / 0.02, 0, 1);
          dy = -0.024 * w;
          dz = -0.008 * w;
        } else if (morphName === 'mouthSmileLeft') {
          const w = gaussian2D(bx, yRel, 0.024, -0.041, 0.016, 0.015);
          dx = 0.006 * w;
          dy = 0.011 * w;
          dz = -0.003 * w;
        } else if (morphName === 'mouthSmileRight') {
          const w = gaussian2D(bx, yRel, -0.024, -0.041, 0.016, 0.015);
          dx = -0.006 * w;
          dy = 0.011 * w;
          dz = -0.003 * w;
        } else if (morphName === 'mouthFrownLeft') {
          const w = gaussian2D(bx, yRel, 0.022, -0.043, 0.015, 0.014);
          dy = -0.010 * w;
        } else if (morphName === 'mouthFrownRight') {
          const w = gaussian2D(bx, yRel, -0.022, -0.043, 0.015, 0.014);
          dy = -0.010 * w;
        } else if (morphName === 'mouthPucker') {
          const w = gaussian2D(bx, yRel, 0, -0.041, 0.025, 0.015);
          dx = -bx * 0.32 * w;
          dz = 0.014 * w;
        } else if (morphName === 'mouthFunnel') {
          const w = gaussian2D(bx, yRel, 0, -0.042, 0.024, 0.016);
          dx = -bx * 0.16 * w;
          dy = (yRel > -0.042 ? 0.006 : -0.010) * w;
          dz = 0.011 * w;
        } else if (morphName === 'eyeBlinkLeft') {
          const w = gaussian2D(bx, yRel, 0.029, 0.022, 0.014, 0.010);
          dy = -0.006 * w;
        } else if (morphName === 'eyeBlinkRight') {
          const w = gaussian2D(bx, yRel, -0.029, 0.022, 0.014, 0.010);
          dy = -0.006 * w;
        } else if (morphName === 'browInnerUp') {
          const w = gaussian2D(bx, yRel, 0, 0.038, 0.024, 0.014);
          dy = 0.010 * w;
        } else if (morphName === 'browOuterUpLeft') {
          const w = gaussian2D(bx, yRel, 0.036, 0.036, 0.018, 0.013);
          dy = 0.010 * w;
        } else if (morphName === 'browOuterUpRight') {
          const w = gaussian2D(bx, yRel, -0.036, 0.036, 0.018, 0.013);
          dy = 0.010 * w;
        } else if (morphName === 'browDownLeft') {
          const w = gaussian2D(bx, yRel, 0.026, 0.036, 0.020, 0.013);
          dy = -0.009 * w;
          dx = -0.004 * w;
        } else if (morphName === 'browDownRight') {
          const w = gaussian2D(bx, yRel, -0.026, 0.036, 0.020, 0.013);
          dy = -0.009 * w;
          dx = 0.004 * w;
        } else if (morphName === 'cheekPuff') {
          const w =
            gaussian2D(bx, yRel, 0.044, -0.025, 0.020, 0.020) +
            gaussian2D(bx, yRel, -0.044, -0.025, 0.020, 0.020);
          dx = Math.sign(bx) * 0.012 * w;
          dz = 0.010 * w;
        }
      }

      // Three.js morphAttributes.position stores absolute target positions (morphTargetsRelative = false)
      arr[i * 3] = bx + dx;
      arr[i * 3 + 1] = by + dy;
      arr[i * 3 + 2] = bz + dz;
    }

    const attr = new THREE.BufferAttribute(arr, 3);
    attr.name = morphName;
    morphPosAttrs.push(attr);
  }

  geo.morphAttributes.position = morphPosAttrs;
  geo.morphTargetsRelative = false;

  return geo;
}

function buildArticulatedEye(side: 'Left' | 'Right'): {
  socketGroup: THREE.Group;
  eyePivot: THREE.Group;
  upperLid: THREE.Mesh;
  lowerLid: THREE.Mesh;
} {
  const xPos = side === 'Left' ? 0.0285 : -0.0285;
  const socketGroup = new THREE.Group();
  socketGroup.name = `${side}Eye_Socket`;
  socketGroup.position.set(xPos, 0.112, 0.068);

  // Titanium orbital bezel ring
  const bezel = new THREE.Mesh(
    new THREE.TorusGeometry(0.0135, 0.0018, 8, 20),
    new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.3,
      metalness: 0.75,
    }),
  );
  bezel.position.z = 0.003;
  socketGroup.add(bezel);

  // Rotating eyeball pivot
  const eyePivot = new THREE.Group();
  eyePivot.name = `${side}Eye`;

  const sclera = new THREE.Mesh(
    new THREE.SphereGeometry(0.0115, 16, 14),
    new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.18,
      metalness: 0.05,
    }),
  );
  eyePivot.add(sclera);

  const iris = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0062, 0.0062, 0.002, 18),
    new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0x92400e,
      emissiveIntensity: 0.55,
      roughness: 0.2,
      metalness: 0.6,
    }),
  );
  iris.rotation.x = Math.PI / 2;
  iris.position.z = 0.0106;
  eyePivot.add(iris);

  const pupil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0028, 0.0028, 0.0022, 14),
    new THREE.MeshStandardMaterial({
      color: 0x05070a,
      roughness: 0.1,
      metalness: 0.2,
    }),
  );
  pupil.rotation.x = Math.PI / 2;
  pupil.position.z = 0.0109;
  eyePivot.add(pupil);

  socketGroup.add(eyePivot);

  // Upper & lower eyelid shutter shells
  const lidMat = new THREE.MeshStandardMaterial({
    color: 0x262f3e,
    roughness: 0.45,
    metalness: 0.4,
  });

  const upperGeo = new THREE.SphereGeometry(
    0.0128,
    16,
    10,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.52,
  );
  const upperLid = new THREE.Mesh(upperGeo, lidMat);
  upperLid.rotation.x = -0.62; // open rest angle
  socketGroup.add(upperLid);

  const lowerGeo = new THREE.SphereGeometry(
    0.0126,
    16,
    10,
    0,
    Math.PI * 2,
    Math.PI * 0.48,
    Math.PI * 0.52,
  );
  const lowerLid = new THREE.Mesh(lowerGeo, lidMat);
  lowerLid.rotation.x = 0.48; // open rest angle
  socketGroup.add(lowerLid);

  return { socketGroup, eyePivot, upperLid, lowerLid };
}

export function buildDetailedHeadAssembly(): DetailedHeadRig {
  const group = new THREE.Group();
  group.name = 'Kinesis_Detailed_Head';

  // 1. Sculpted Morphable Face & Cranium Mesh
  const faceGeo = buildSculptedFaceGeometry();
  const faceMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.28,
  });
  const faceMesh = new THREE.Mesh(faceGeo, faceMat);
  faceMesh.name = 'Kinesis_Head_Face_Mesh';
  faceMesh.castShadow = true;
  faceMesh.receiveShadow = true;

  // Populate morphTargetDictionary & morphTargetInfluences cleanly for Three.js + GLTFExporter
  faceMesh.morphTargetDictionary = {};
  faceMesh.morphTargetInfluences = new Array(MORPH_NAMES.length).fill(0);
  MORPH_NAMES.forEach((name, idx) => {
    faceMesh.morphTargetDictionary![name] = idx;
  });
  group.add(faceMesh);

  // 2. Cranial Armor Crest & Occipital Ridge Fins
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.28,
    metalness: 0.72,
  });
  const darkArmorMat = new THREE.MeshStandardMaterial({
    color: 0x1e2532,
    roughness: 0.5,
    metalness: 0.35,
  });
  const amberAccentMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0x78350f,
    emissiveIntensity: 0.4,
    roughness: 0.3,
    metalness: 0.45,
  });

  const crest = new THREE.Mesh(
    new THREE.BoxGeometry(0.018, 0.022, 0.14),
    trimMat,
  );
  crest.position.set(0, 0.194, -0.01);
  crest.rotation.x = -0.18;
  crest.castShadow = true;
  group.add(crest);

  // Lateral Ear / Acoustic Sensor Pods
  for (const side of [-1, 1]) {
    const earPod = new THREE.Group();
    earPod.position.set(side * 0.077, 0.094, -0.002);

    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.022, 0.018, 16),
      darkArmorMat,
    );
    housing.rotation.z = Math.PI / 2;
    earPod.add(housing);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.017, 0.0022, 8, 20),
      amberAccentMat,
    );
    ring.rotation.y = Math.PI / 2;
    ring.position.x = side * 0.009;
    earPod.add(ring);

    group.add(earPod);
  }

  // 3. Articulated Eyes & Eyelid Shutters
  const leftEye = buildArticulatedEye('Left');
  const rightEye = buildArticulatedEye('Right');
  group.add(leftEye.socketGroup);
  group.add(rightEye.socketGroup);

  // 4. Articulated Brow Plates
  const buildBrow = (side: 'Left' | 'Right') => {
    const sign = side === 'Left' ? 1 : -1;
    const pivot = new THREE.Group();
    pivot.name = `${side}Brow_Plate`;
    pivot.position.set(sign * 0.029, 0.133, 0.079);

    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.006, 0.012),
      darkArmorMat,
    );
    bar.rotation.z = -sign * 0.08;
    pivot.add(bar);

    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.0022, 0.013),
      trimMat,
    );
    strip.position.y = 0.003;
    strip.rotation.z = -sign * 0.08;
    pivot.add(strip);

    return pivot;
  };

  const leftBrowPlate = buildBrow('Left');
  const rightBrowPlate = buildBrow('Right');
  group.add(leftBrowPlate);
  group.add(rightBrowPlate);

  // 5. Articulated Mandible / Chin Guard Pivot
  const jawPivot = new THREE.Group();
  jawPivot.name = 'Jaw_Mandible';
  jawPivot.position.set(0, 0.066, 0.014);

  const chinPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.056, 0.024, 0.038),
    darkArmorMat,
  );
  chinPlate.position.set(0, -0.050, 0.052);
  chinPlate.castShadow = true;
  jawPivot.add(chinPlate);

  const chinTrim = new THREE.Mesh(
    new THREE.BoxGeometry(0.034, 0.006, 0.041),
    trimMat,
  );
  chinTrim.position.set(0, -0.058, 0.053);
  jawPivot.add(chinTrim);

  // Side mandible struts connecting jaw joint to chin
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.016, 0.068),
      darkArmorMat,
    );
    strut.position.set(side * 0.042, -0.036, 0.026);
    strut.rotation.x = 0.42;
    strut.rotation.y = -side * 0.24;
    jawPivot.add(strut);
  }
  group.add(jawPivot);

  const applyBlendshapes = (shapes: FacialBlendshapeMap) => {
    const influences = faceMesh.morphTargetInfluences!;
    const dict = faceMesh.morphTargetDictionary!;

    for (const key of FACIAL_BLENDSHAPES) {
      const idx = dict[key];
      if (idx !== undefined) {
        influences[idx] = THREE.MathUtils.clamp(shapes[key] ?? 0, 0, 1);
      }
    }

    // Physical articulated jaw hinge
    const jawVal = THREE.MathUtils.clamp(shapes.jawOpen ?? 0, 0, 1);
    jawPivot.rotation.x = jawVal * 0.42;

    // Physical articulated eyelids
    const blinkL = THREE.MathUtils.clamp(shapes.eyeBlinkLeft ?? 0, 0, 1);
    const wideL = THREE.MathUtils.clamp(shapes.eyeWideLeft ?? 0, 0, 1);
    leftEye.upperLid.rotation.x = THREE.MathUtils.lerp(-0.66 - wideL * 0.18, 0.05, blinkL);
    leftEye.lowerLid.rotation.x = THREE.MathUtils.lerp(0.50 + wideL * 0.12, -0.04, blinkL);

    const blinkR = THREE.MathUtils.clamp(shapes.eyeBlinkRight ?? 0, 0, 1);
    const wideR = THREE.MathUtils.clamp(shapes.eyeWideRight ?? 0, 0, 1);
    rightEye.upperLid.rotation.x = THREE.MathUtils.lerp(-0.66 - wideR * 0.18, 0.05, blinkR);
    rightEye.lowerLid.rotation.x = THREE.MathUtils.lerp(0.50 + wideR * 0.12, -0.04, blinkR);

    // Physical articulated eye gaze
    const lookYawL = (shapes.eyeLookInLeft ?? 0) - (shapes.eyeLookOutLeft ?? 0);
    const lookPitchL = (shapes.eyeLookDownLeft ?? 0) - (shapes.eyeLookUpLeft ?? 0);
    leftEye.eyePivot.rotation.y = -lookYawL * 0.42;
    leftEye.eyePivot.rotation.x = lookPitchL * 0.32;

    const lookYawR = (shapes.eyeLookOutRight ?? 0) - (shapes.eyeLookInRight ?? 0);
    const lookPitchR = (shapes.eyeLookDownRight ?? 0) - (shapes.eyeLookUpRight ?? 0);
    rightEye.eyePivot.rotation.y = -lookYawR * 0.42;
    rightEye.eyePivot.rotation.x = lookPitchR * 0.32;

    // Physical articulated brow plates
    const innerUp = shapes.browInnerUp ?? 0;
    const outerUpL = shapes.browOuterUpLeft ?? 0;
    const outerUpR = shapes.browOuterUpRight ?? 0;
    const downL = shapes.browDownLeft ?? 0;
    const downR = shapes.browDownRight ?? 0;

    leftBrowPlate.position.y = 0.133 + (innerUp * 0.5 + outerUpL * 0.5 - downL) * 0.009;
    leftBrowPlate.rotation.z = (outerUpL - innerUp) * 0.22 + downL * 0.24;

    rightBrowPlate.position.y = 0.133 + (innerUp * 0.5 + outerUpR * 0.5 - downR) * 0.009;
    rightBrowPlate.rotation.z = -(outerUpR - innerUp) * 0.22 - downR * 0.24;
  };

  return {
    group,
    faceMesh,
    jawPivot,
    leftEyePivot: leftEye.eyePivot,
    rightEyePivot: rightEye.eyePivot,
    leftUpperLid: leftEye.upperLid,
    leftLowerLid: leftEye.lowerLid,
    rightUpperLid: rightEye.upperLid,
    rightLowerLid: rightEye.lowerLid,
    leftBrowPlate,
    rightBrowPlate,
    applyBlendshapes,
  };
}
