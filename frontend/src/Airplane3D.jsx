import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export default function Airplane3D({ parsed, results, strips = [] }) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const planeGroupRef = useRef(null);
  const lastSnappedModelRef = useRef('');
  const hoverTargetsRef = useRef([]);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  const [webglError, setWebglError] = useState(null);
  const [viewMode, setViewMode] = useState('shaded');
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, data: null });
  const [showVLM, setShowVLM] = useState(false);
  const [showClMap, setShowClMap] = useState(true);
  const [showPVec, setShowPVec] = useState(true);
  const vlmGroupRef = useRef(null);
  const clMapGroupRef = useRef(null);
  const pvecGroupRef = useRef(null);

  // ── 1. Cleanup ONLY on actual Component Unmount ──
  useEffect(() => {
    return () => {
      if (sceneRef.current) {
        if (sceneRef.current.userData.animationFrameId) {
          cancelAnimationFrame(sceneRef.current.userData.animationFrameId);
        }
        sceneRef.current.clear();
      }
      if (rendererRef.current) {
        if (containerRef.current && containerRef.current.contains(rendererRef.current.domElement)) {
          containerRef.current.removeChild(rendererRef.current.domElement);
        }
        const gl = rendererRef.current.getContext();
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        rendererRef.current.dispose();
      }
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      planeGroupRef.current = null;
    };
  }, []);

  // ── 2. Unified Setup & Geometry Update Loop ──
  useEffect(() => {
    try {
      if (!containerRef.current || !parsed?.surfaces) return;

      const width = containerRef.current.clientWidth || 800;
      const height = containerRef.current.clientHeight || 500;

      let scene = sceneRef.current;
      let camera = cameraRef.current;
      let renderer = rendererRef.current;
      let controls = controlsRef.current;
      let planeGroup = planeGroupRef.current;

      // Lazy initialization of WebGL Context (Once)
      if (!scene) {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0e1a);
        sceneRef.current = scene;

        camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
        camera.position.set(5, 5, 8); // Default fallback position
        cameraRef.current = camera;

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // Critical fix: prevent infinite ResizeObserver loop by taking canvas out of document flow
        renderer.domElement.style.position = 'absolute';
        renderer.domElement.style.top = '0';
        renderer.domElement.style.left = '0';
        
        rendererRef.current = renderer;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight1.position.set(10, 20, 15);
        scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0x818cf8, 0.4);
        dirLight2.position.set(-10, -10, -10);
        scene.add(dirLight2);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controlsRef.current = controls;

        planeGroup = new THREE.Group();
        planeGroupRef.current = planeGroup;
        scene.add(planeGroup);

        // Animation Loop
        let animationFrameId;
        const animate = () => {
          animationFrameId = requestAnimationFrame(animate);
          if (sceneRef.current) sceneRef.current.userData.animationFrameId = animationFrameId;
          
          if (controlsRef.current) controlsRef.current.update();
          if (rendererRef.current && sceneRef.current && cameraRef.current) {
            rendererRef.current.render(sceneRef.current, cameraRef.current);
          }
        };
        animate();
      }

      // Ensure canvas DOM element is appended
      if (!containerRef.current.contains(renderer.domElement)) {
        containerRef.current.appendChild(renderer.domElement);
      }

      // Clear previous geometries cleanly to prevent WebGL memory leaks
      while (planeGroup.children.length > 0) {
        const obj = planeGroup.children[0];
        planeGroup.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      }

      // Grid Helper
      let gridHelper = planeGroup.getObjectByName('gridHelper');
      if (!gridHelper) {
        gridHelper = new THREE.GridHelper(20, 20, 0x6366f1, 0x1e293b);
        gridHelper.rotation.x = Math.PI / 2; // Flat ground
        gridHelper.name = 'gridHelper';
        planeGroup.add(gridHelper);
      }

      // Axes Helper
      let axesHelper = planeGroup.getObjectByName('axesHelper');
      if (!axesHelper) {
        axesHelper = new THREE.AxesHelper(3);
        axesHelper.name = 'axesHelper';
        planeGroup.add(axesHelper);
      }

      // Build Surfaces
      const surfaces = parsed.surfaces;

      surfaces.forEach((surf) => {
        if (!surf.sections || surf.sections.length < 2) return;

        const tx = surf.translate ? surf.translate[0] : 0;
        const ty = surf.translate ? surf.translate[1] : 0;
        const tz = surf.translate ? surf.translate[2] : 0;
        const surfAngleRad = (surf.angle || 0) * Math.PI / 180;

        const getGlobalPoint = (sec, isTE, mirrorY = false) => {
          const aincRad = (sec.Ainc || 0) * Math.PI / 180;
          
          let px = sec.Xle;
          let py = sec.Yle;
          let pz = sec.Zle;

          if (isTE) {
            px += sec.Chord * Math.cos(aincRad);
            pz -= sec.Chord * Math.sin(aincRad);
          }

          // Apply surface incidence rotation around Y
          const cosS = Math.cos(surfAngleRad);
          const sinS = Math.sin(surfAngleRad);
          const rx = px * cosS + pz * sinS;
          const rz = -px * sinS + pz * cosS;

          let gx = rx + tx;
          let gy = py + ty;
          let gz = rz + tz;

          if (mirrorY) {
            gy = -gy;
          }

          // Map to Three.js coordinates
          return new THREE.Vector3(gy, gz, -gx);
        };

        const createSurfaceMesh = (mirrorY = false) => {
          const vertices = [];
          const indices = [];

          for (let s = 0; s < surf.sections.length; s++) {
            const sec = surf.sections[s];
            const lePt = getGlobalPoint(sec, false, mirrorY);
            const tePt = getGlobalPoint(sec, true, mirrorY);

            vertices.push(lePt);
            vertices.push(tePt);
          }

          for (let s = 0; s < surf.sections.length - 1; s++) {
            const i0 = s * 2;
            const i1 = s * 2 + 1;
            const i2 = (s + 1) * 2;
            const i3 = (s + 1) * 2 + 1;

            indices.push(i0, i1, i3);
            indices.push(i0, i3, i2);
          }

          const geometry = new THREE.BufferGeometry();
          const positions = [];
          vertices.forEach(v => {
            positions.push(v.x, v.y, v.z);
          });

          geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          geometry.setIndex(indices);
          geometry.computeVertexNormals();

          // Shaded surface mesh
          const material = new THREE.MeshPhysicalMaterial({
            color: 0x6366f1,
            emissive: 0x1e1b4b,
            roughness: 0.2,
            metalness: 0.1,
            transparent: true,
            opacity: 0.75,
            side: THREE.DoubleSide,
            flatShading: true,
            clearcoat: 1.0
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.userData.isShaded = true;
          planeGroup.add(mesh);

          // Wireframe mesh
          const wireMat = new THREE.MeshBasicMaterial({
            color: 0x818cf8,
            wireframe: true,
            transparent: true,
            opacity: 0.9
          });
          const wireMesh = new THREE.Mesh(geometry, wireMat);
          wireMesh.userData.isWireframe = true;
          planeGroup.add(wireMesh);

          // Bold Planform Outlines
          const outlineGeom = new THREE.BufferGeometry();
          const outlinePts = [];
          
          for (let s = 0; s < surf.sections.length; s++) {
            outlinePts.push(getGlobalPoint(surf.sections[s], false, mirrorY));
          }
          for (let s = surf.sections.length - 1; s >= 0; s--) {
            outlinePts.push(getGlobalPoint(surf.sections[s], true, mirrorY));
          }
          outlinePts.push(getGlobalPoint(surf.sections[0], false, mirrorY));

          outlineGeom.setFromPoints(outlinePts);
          const outlineMat = new THREE.LineBasicMaterial({
            color: 0x4f46e5,
            linewidth: 2
          });
          const outline = new THREE.Line(outlineGeom, outlineMat);
          planeGroup.add(outline);
        };

        createSurfaceMesh(false);

        const shouldMirrorY = (surf.yduplicate != null) || (parsed.iYsym === 1 && surf.sections.some(sec => Math.abs(sec.Yle) > 1e-5));
        if (shouldMirrorY) {
          createSurfaceMesh(true);
        }
      });

      // ── Helper: Plain colored sphere with tooltip userData ──
      hoverTargetsRef.current = [];
      const createHoverSphere = (tooltipData, color, radius = 0.14) => {
        const geometry = new THREE.SphereGeometry(radius, 32, 32);
        const material = new THREE.MeshPhongMaterial({
          color,
          shininess: 80,
          specular: new THREE.Color(0xffffff),
          emissive: new THREE.Color(color).multiplyScalar(0.15),
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.tooltip = tooltipData;
        hoverTargetsRef.current.push(mesh);
        return mesh;
      };

      // ── Center of Gravity (CG - Red) ──
      if (parsed.Xref != null) {
        const cgPos = new THREE.Vector3(parsed.Yref, -parsed.Zref, -parsed.Xref);
        const cgMesh = createHoverSphere({
          label: 'CG',
          fullName: 'Center of Gravity',
          color: '#ef4444',
          description: 'The point where the aircraft\'s total weight acts. Moving CG forward increases stability but reduces maneuverability.',
          value: `X = ${parsed.Xref?.toFixed(3)} m`,
        }, 0xef4444, 0.16);
        cgMesh.position.copy(cgPos);
        planeGroup.add(cgMesh);

        // Glowing ring around CG
        const ringGeom = new THREE.RingGeometry(0.22, 0.27, 36);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.copy(cgPos);
        ring.rotation.x = Math.PI / 2;
        planeGroup.add(ring);
      }

      // ── Neutral Point (NP - Blue) ──
      if (results?.Xnp != null) {
        const npPos = new THREE.Vector3(parsed.Yref || 0, -(parsed.Zref || 0), -results.Xnp);
        const npMesh = createHoverSphere({
          label: 'NP',
          fullName: 'Neutral Point',
          color: '#3b82f6',
          description: 'The point where changes in angle of attack produce zero pitching moment. CG must be ahead of NP for static stability.',
          value: `Xₚ = ${results.Xnp?.toFixed(3)} m`,
        }, 0x3b82f6, 0.14);
        npMesh.position.copy(npPos);
        planeGroup.add(npMesh);
      }

      // ── Aerodynamic Center of Main Wing (AC - Green) ──
      let wingAcX = null;
      if (parsed.surfaces && parsed.surfaces.length > 0) {
        const mainWing = parsed.surfaces[0];
        if (mainWing.sections && mainWing.sections.length > 0) {
          const rootSec = mainWing.sections[0];
          const tx = mainWing.translate ? mainWing.translate[0] : 0;
          wingAcX = tx + rootSec.Xle + 0.25 * rootSec.Chord;
        }
      }

      if (wingAcX != null) {
        const acPos = new THREE.Vector3(parsed.Yref || 0, -(parsed.Zref || 0), -wingAcX);
        const acMesh = createHoverSphere({
          label: 'AC',
          fullName: 'Aerodynamic Center',
          color: '#10b981',
          description: 'The point where the pitching moment coefficient is constant regardless of angle of attack. Located at ~25% of the mean aerodynamic chord.',
          value: `Xₐᴄ = ${wingAcX?.toFixed(3)} m`,
        }, 0x10b981, 0.14);
        acMesh.position.copy(acPos);
        planeGroup.add(acMesh);
      }

      // ── Strip Force Load Arrows (Spanwise Load Distribution) ──
      if (strips && strips.length > 0) {
        const maxCl = Math.max(...strips.map(s => Math.abs(s.cl || 0)), 0.001);
        const SCALE = 1.8; // Max arrow height in world units

        const lerpColor = (t) => {
          // green (0) -> yellow (0.5) -> red (1)
          const r = Math.min(1, t * 2);
          const g = Math.min(1, (1 - t) * 2);
          return new THREE.Color(r, g, 0.0);
        };

        // Find the main wing surface
        const mainSurf = parsed.surfaces[0];
        const tx = mainSurf?.translate ? mainSurf.translate[0] : 0;
        const ty = mainSurf?.translate ? mainSurf.translate[1] : 0;
        const tz = mainSurf?.translate ? mainSurf.translate[2] : 0;
        const sections = mainSurf?.sections || [];

        // Helper: interpolate wing surface position at a given Yle
        const interpSurf = (yle) => {
          if (sections.length === 0) return { xQC: tx, zLE: tz };
          // Find bounding sections
          let s0 = sections[0], s1 = sections[sections.length - 1];
          for (let k = 0; k < sections.length - 1; k++) {
            if (sections[k].Yle <= yle && sections[k + 1].Yle >= yle) {
              s0 = sections[k];
              s1 = sections[k + 1];
              break;
            }
          }
          // Interpolation factor
          const dy = s1.Yle - s0.Yle;
          const t = dy > 1e-6 ? (yle - s0.Yle) / dy : 0;
          const xle = s0.Xle + t * (s1.Xle - s0.Xle);
          const zle = s0.Zle + t * (s1.Zle - s0.Zle);
          const chord = s0.Chord + t * (s1.Chord - s0.Chord);
          // Quarter-chord X position
          return {
            xQC: xle + 0.25 * chord + tx,
            zLE: zle + tz,
          };
        };

        strips.forEach(strip => {
          const { Yle, cl } = strip;
          if (cl == null || Math.abs(cl) < 1e-6) return;

          const t = Math.abs(cl) / maxCl;
          const color = lerpColor(t);
          const arrowHeight = (cl / maxCl) * SCALE;

          // Get actual wing surface position at this span station
          const { xQC, zLE } = interpSurf(Math.abs(Yle));

          // Three.js coords: (span=X, vertical=Y, chord=-Z)
          // Must match getGlobalPoint which uses THREE.Vector3(gy, gz, -gx)
          // where gz = +Zle + tz → so THREE.js Y = +zLE (NOT -zLE)
          const baseX = Yle + ty;
          const baseY = zLE;         // wing surface Z → three.js Y = +Zle+tz
          const baseZ = -xQC;       // wing chord X -> three.js -Z

          // Arrow shaft
          const arrowPts = [
            new THREE.Vector3(baseX, baseY, baseZ),
            new THREE.Vector3(baseX, baseY + arrowHeight, baseZ),
          ];
          const arrowGeom = new THREE.BufferGeometry().setFromPoints(arrowPts);
          const arrowMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
          const arrowLine = new THREE.Line(arrowGeom, arrowMat);
          planeGroup.add(arrowLine);

          // Arrow tip cone
          const coneH = 0.08;
          const coneGeom = new THREE.ConeGeometry(0.03, coneH, 8);
          const coneMat = new THREE.MeshBasicMaterial({ color });
          const cone = new THREE.Mesh(coneGeom, coneMat);
          cone.position.set(baseX, baseY + arrowHeight + coneH / 2, baseZ);
          planeGroup.add(cone);

          // Mirror for symmetric wing
          if (Yle >= 0 && (parsed.iYsym === 1 || mainSurf?.yduplicate != null)) {
            const mx = -baseX;
            const mirrorPts = [
              new THREE.Vector3(mx, baseY, baseZ),
              new THREE.Vector3(mx, baseY + arrowHeight, baseZ),
            ];
            const mirrorGeom = new THREE.BufferGeometry().setFromPoints(mirrorPts);
            const mirrorLine = new THREE.Line(mirrorGeom, arrowMat.clone());
            planeGroup.add(mirrorLine);

            const coneMirror = new THREE.Mesh(coneGeom.clone(), coneMat.clone());
            coneMirror.position.set(mx, baseY + arrowHeight + coneH / 2, baseZ);
            planeGroup.add(coneMirror);
          }
        });
      }

      // ── Helper to dispose a group ──
      const disposeGroup = (grp) => {
        if (!grp) return;
        grp.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
            else obj.material.dispose();
          }
        });
        planeGroup.remove(grp);
      };

      // Helper: interpolate surface at Yle (same logic as arrows)
      const makeSurfInterp = (surf) => {
        const secs = surf.sections || [];
        const stx = surf.translate ? surf.translate[0] : 0;
        const sty = surf.translate ? surf.translate[1] : 0;
        const stz = surf.translate ? surf.translate[2] : 0;
        return (yle) => {
          let s0 = secs[0], s1 = secs[secs.length - 1];
          for (let k = 0; k < secs.length - 1; k++) {
            if (secs[k].Yle <= yle && secs[k + 1].Yle >= yle) { s0 = secs[k]; s1 = secs[k + 1]; break; }
          }
          const dy = s1.Yle - s0.Yle;
          const t = dy > 1e-6 ? (yle - s0.Yle) / dy : 0;
          return {
            xle: s0.Xle + t * (s1.Xle - s0.Xle) + stx,
            yle: s0.Yle + t * (s1.Yle - s0.Yle) + sty,
            zle: s0.Zle + t * (s1.Zle - s0.Zle) + stz,
            chord: s0.Chord + t * (s1.Chord - s0.Chord),
          };
        };
      };

      // ── Colour helper ──
      const clToRGB = (cl, maxCl) => {
        const t = Math.min(1, Math.abs(cl) / (maxCl || 0.001));
        return new THREE.Color(Math.min(1, t * 2), Math.min(1, (1 - t) * 2), 0.0);
      };

      // ══════════════════════════════════════════════════════
      // 1. VLM PANEL GRID
      // ══════════════════════════════════════════════════════
      disposeGroup(vlmGroupRef.current);
      const vlmGroup = new THREE.Group();
      vlmGroup.name = 'vlmGrid';
      vlmGroupRef.current = vlmGroup;
      planeGroup.add(vlmGroup);
      vlmGroup.visible = showVLM;

      const addVLMGrid = (surf, mirrorY = false) => {
        const secs = surf.sections;
        if (!secs || secs.length < 2) return;
        const nchord = surf.nchord || 12;
        const stx = surf.translate ? surf.translate[0] : 0;
        const sty = surf.translate ? surf.translate[1] : 0;
        const stz = surf.translate ? surf.translate[2] : 0;
        const gMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 });

        for (let si = 0; si < secs.length - 1; si++) {
          const s0 = secs[si], s1 = secs[si + 1];
          const nspan = Math.max(s0.Nspan || surf.nspan || 8, 3);

          // Spanwise lines (along chord)
          for (let j = 0; j <= nspan; j++) {
            const tS = j / nspan;
            const xle = s0.Xle + tS * (s1.Xle - s0.Xle) + stx;
            const yle = s0.Yle + tS * (s1.Yle - s0.Yle) + sty;
            const zle = s0.Zle + tS * (s1.Zle - s0.Zle) + stz;
            const ch  = s0.Chord + tS * (s1.Chord - s0.Chord);
            const pts = [];
            for (let k = 0; k <= nchord; k++) {
              const tc = k / nchord;
              const gY = mirrorY ? -yle : yle;
              // +zle matches getGlobalPoint: Three.js Y = +Zle+tz (NOT -zle)
              pts.push(new THREE.Vector3(gY, zle, -(xle + tc * ch)));
            }
            vlmGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gMat.clone()));
          }

          // Chordwise lines (along span)
          for (let k = 0; k <= nchord; k++) {
            const tc = k / nchord;
            const pts = [];
            for (let j = 0; j <= nspan; j++) {
              const tS = j / nspan;
              const xle = s0.Xle + tS * (s1.Xle - s0.Xle) + stx;
              const yle = s0.Yle + tS * (s1.Yle - s0.Yle) + sty;
              const zle = s0.Zle + tS * (s1.Zle - s0.Zle) + stz;
              const ch  = s0.Chord + tS * (s1.Chord - s0.Chord);
              const gY  = mirrorY ? -yle : yle;
              // +zle matches getGlobalPoint: Three.js Y = +Zle+tz (NOT -zle)
              pts.push(new THREE.Vector3(gY, zle, -(xle + tc * ch)));
            }
            vlmGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gMat.clone()));
          }
        }
      };

      parsed.surfaces.forEach(surf => {
        addVLMGrid(surf, false);
        const shouldMirror = surf.yduplicate != null || (parsed.iYsym === 1 && surf.sections.some(s => Math.abs(s.Yle) > 1e-5));
        if (shouldMirror) addVLMGrid(surf, true);
      });

      // ══════════════════════════════════════════════════════
      // 2. CL HEATMAP OVERLAY (main wing only)
      // ══════════════════════════════════════════════════════
      disposeGroup(clMapGroupRef.current);
      const clMapGroup = new THREE.Group();
      clMapGroup.name = 'clMap';
      clMapGroupRef.current = clMapGroup;
      planeGroup.add(clMapGroup);
      clMapGroup.visible = showClMap && strips.length > 0;

      if (strips.length > 0) {
        const maxClMap = Math.max(...strips.map(s => Math.abs(s.cl || 0)), 0.001);

        // Build lookup: Yle -> cl  (always use abs because strips come as Yle≥0)
        const getStripCl = (yle) => {
          const abs = Math.abs(yle);
          for (let i = 0; i < strips.length - 1; i++) {
            if (strips[i].Yle <= abs && strips[i + 1].Yle >= abs) {
              const dt = (abs - strips[i].Yle) / (strips[i + 1].Yle - strips[i].Yle + 1e-9);
              return strips[i].cl + dt * (strips[i + 1].cl - strips[i].cl);
            }
          }
          return strips[strips.length - 1]?.cl || 0;
        };

        // ── Only apply Cl map to the MAIN WING (surfaces[0]) ──
        const mainWingSurf = parsed.surfaces[0];
        if (mainWingSurf) {
          const addClHeatmap = (surf, mirrorY = false) => {
            const secs = surf.sections;
            if (!secs || secs.length < 2) return;
            const stx = surf.translate ? surf.translate[0] : 0;
            const sty = surf.translate ? surf.translate[1] : 0;
            const stz = surf.translate ? surf.translate[2] : 0;

            const positions = [], colors = [], indices = [];

            for (let si = 0; si < secs.length - 1; si++) {
              const s0 = secs[si], s1 = secs[si + 1];
              const nspan = Math.max(s0.Nspan || surf.nspan || 12, 6);

              for (let j = 0; j < nspan; j++) {
                const t0 = j / nspan, t1 = (j + 1) / nspan;
                const interp = (t) => ({
                  xle:   s0.Xle   + t * (s1.Xle   - s0.Xle)   + stx,
                  yle:   s0.Yle   + t * (s1.Yle   - s0.Yle)   + sty,
                  zle:   s0.Zle   + t * (s1.Zle   - s0.Zle)   + stz,
                  chord: s0.Chord + t * (s1.Chord  - s0.Chord),
                });
                const p0 = interp(t0), p1 = interp(t1);

                // 4 corners: LE and TE at t0 and t1
                const corners = [
                  { x: p0.xle,             y: p0.yle, z: p0.zle },
                  { x: p0.xle + p0.chord,  y: p0.yle, z: p0.zle },
                  { x: p1.xle + p1.chord,  y: p1.yle, z: p1.zle },
                  { x: p1.xle,             y: p1.yle, z: p1.zle },
                ];

                const base = positions.length / 3;
                corners.forEach(c => {
                  // Three.js(X,Y,Z) = (span, +Zle+stz, -Xle)
                  // +c.z matches getGlobalPoint which uses gz = +Zle+tz for Three.js Y
                  const gX = mirrorY ? -c.y : c.y;  // negate span for mirrored side
                  positions.push(gX, c.z, -c.x);
                  // Color lookup always uses abs(yle) since strips are defined for yle≥0
                  const col = clToRGB(getStripCl(c.y), maxClMap);
                  colors.push(col.r, col.g, col.b);
                });

                // Two triangles per quad
                indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
              }
            }

            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geom.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
            geom.setIndex(indices);
            geom.computeVertexNormals();

            // OPAQUE material - transparent meshes cause wrong depth sorting
            // (one wing half hides behind the other from isometric views)
            const mat = new THREE.MeshBasicMaterial({
              vertexColors: true,
              side: THREE.DoubleSide,
              depthWrite: true,
              depthTest: true,
            });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.renderOrder = 0;
            clMapGroup.add(mesh);
          };

          addClHeatmap(mainWingSurf, false);
          // Always add mirrored half for symmetric aircraft
          const shouldMirrorWing = mainWingSurf.yduplicate != null
            || parsed.iYsym === 1
            || mainWingSurf.sections.some(s => s.Yle >= 0);
          if (shouldMirrorWing) addClHeatmap(mainWingSurf, true);
        }

        // Hide the original shaded blue mesh when Cl map is visible (avoid overlap)
        if (showClMap) {
          planeGroup.children.forEach(child => {
            if (child.userData.isShaded) child.visible = false;
          });
        }
      }


      // ══════════════════════════════════════════════════════
      // 3. PRESSURE / CIRCULATION VECTORS (at 3/4 chord)
      // ══════════════════════════════════════════════════════
      disposeGroup(pvecGroupRef.current);
      const pvecGroup = new THREE.Group();
      pvecGroup.name = 'pvec';
      pvecGroupRef.current = pvecGroup;
      planeGroup.add(pvecGroup);
      pvecGroup.visible = showPVec && strips.length > 0;

      if (strips.length > 0) {
        const mainSurfPV = parsed.surfaces[0];
        const interpMainPV = makeSurfInterp(mainSurfPV);
        const maxCcl = Math.max(...strips.map(s => Math.abs(s.c_cl || 0)), 0.001);
        const PVSCALE = 0.6;
        // Y translation of main surface (same as strip arrows use)
        const sty_pv = mainSurfPV?.translate ? mainSurfPV.translate[1] : 0;

        const addPVec = (strip, mirrorY = false) => {
          const { Yle, c_cl } = strip;
          if (!c_cl || Math.abs(c_cl) < 1e-6) return;
          const pos = interpMainPV(Math.abs(Yle));   // geometry from abs(Yle)
          const x3c = pos.xle + 0.75 * pos.chord;
          // span position: use ACTUAL Yle (like strip arrows), mirror only when explicitly asked
          const gy = mirrorY ? -(Math.abs(Yle) + sty_pv) : (Yle + sty_pv);
          const base = new THREE.Vector3(gy, pos.zle, -x3c);
          const vecLen = (Math.abs(c_cl) / maxCcl) * PVSCALE;
          const tip = new THREE.Vector3(gy, pos.zle + vecLen, -x3c);
          const col = new THREE.Color(0.6, 0.1, 1.0); // purple
          const mat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.85 });
          pvecGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([base, tip]), mat));
          const dotG = new THREE.SphereGeometry(0.018, 6, 6);
          const dot = new THREE.Mesh(dotG, new THREE.MeshBasicMaterial({ color: col }));
          dot.position.copy(base);
          pvecGroup.add(dot);
        };

        const mainHasMirror = mainSurfPV?.yduplicate != null
          || (parsed.iYsym === 1 && mainSurfPV?.sections.some(s => Math.abs(s.Yle) > 1e-5));
        strips.forEach(strip => {
          addPVec(strip, false);                               // actual strip position (handles both ±Yle)
          if (strip.Yle >= 0 && mainHasMirror) addPVec(strip, true);  // mirror only for Yle≥0 strips
        });
      }


      // Only reset snap if the parsed model name changed
      if (lastSnappedModelRef.current !== parsed.name) {
        lastSnappedModelRef.current = '';
      }

      // ── Resize Observer Setup ──
      const resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
          const { width: w, height: h } = entry.contentRect;
          if (w > 0 && h > 0 && rendererRef.current && cameraRef.current) {
            rendererRef.current.setSize(w, h);
            cameraRef.current.aspect = w / h;
            cameraRef.current.updateProjectionMatrix();

            // ── Dynamic Auto-fit Snapping (Fires exactly when layout size becomes valid!) ──
            if (lastSnappedModelRef.current !== parsed.name && planeGroupRef.current) {
              const bounds = new THREE.Box3().setFromObject(planeGroupRef.current);
              if (!bounds.isEmpty()) {
                const center = new THREE.Vector3();
                bounds.getCenter(center);
                const size = new THREE.Vector3();
                bounds.getSize(size);

                const maxDim = Math.max(size.x, size.y, size.z);
                const fov = cameraRef.current.fov * (Math.PI / 180);
                let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
                cameraZ *= 1.8;

                cameraRef.current.position.set(center.x + cameraZ * 0.7, center.y + cameraZ * 0.6, center.z + cameraZ * 0.7);
                cameraRef.current.lookAt(center);
                if (controlsRef.current) {
                  controlsRef.current.target.copy(center);
                  controlsRef.current.update();
                }
                lastSnappedModelRef.current = parsed.name;
              }
            }
          }
        }
      });
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
      };
    } catch (err) {
      console.error('WebGL Render Error:', err);
      setWebglError(err.message + '\n' + err.stack);
    }
  }, [parsed, results, strips]);

  // ── Hover / Raycasting ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (!cameraRef.current || hoverTargetsRef.current.length === 0) return;
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      const hits = raycasterRef.current.intersectObjects(hoverTargetsRef.current);

      if (hits.length > 0) {
        const data = hits[0].object.userData.tooltip;
        container.style.cursor = 'pointer';
        setTooltip({ visible: true, x: e.clientX - rect.left + 16, y: e.clientY - rect.top - 10, data });
      } else {
        container.style.cursor = '';
        setTooltip(prev => ({ ...prev, visible: false }));
      }
    };

    const onMouseLeave = () => {
      setTooltip(prev => ({ ...prev, visible: false }));
    };

    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseleave', onMouseLeave);
    return () => {
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseleave', onMouseLeave);
    };
  }, []);

  // ── 3. Handle Visibility Toggles without recreating scene ──
  useEffect(() => {
    if (!planeGroupRef.current) return;
    const group = planeGroupRef.current;

    const grid = group.getObjectByName('gridHelper');
    if (grid) grid.visible = showGrid;
    const axes = group.getObjectByName('axesHelper');
    if (axes) axes.visible = showAxes;

    group.children.forEach(child => {
      if (child.userData.isShaded)    child.visible = (viewMode === 'shaded' || viewMode === 'both');
      if (child.userData.isWireframe) child.visible = (viewMode === 'wireframe' || viewMode === 'both');
    });
  }, [viewMode, showGrid, showAxes]);

  useEffect(() => { if (vlmGroupRef.current)   vlmGroupRef.current.visible   = showVLM;  }, [showVLM]);
  useEffect(() => {
    if (clMapGroupRef.current) clMapGroupRef.current.visible = showClMap;
    // Show/hide the original blue shaded mesh depending on Cl Map toggle
    if (planeGroupRef.current) {
      planeGroupRef.current.children.forEach(child => {
        if (child.userData.isShaded) child.visible = !showClMap;
      });
    }
  }, [showClMap]);
  useEffect(() => { if (pvecGroupRef.current)   pvecGroupRef.current.visible   = showPVec;  }, [showPVec]);

  // View snapping presets
  const snapToView = (direction) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const target = controls.target;
    const dist = camera.position.distanceTo(target);

    switch (direction) {
      case 'iso':
        camera.position.set(target.x + dist * 0.7, target.y + dist * 0.6, target.z + dist * 0.7);
        break;
      case 'top':
        camera.position.set(target.x, target.y + dist, target.z);
        break;
      case 'side':
        camera.position.set(target.x + dist, target.y, target.z);
        break;
      case 'front':
        camera.position.set(target.x, target.y, target.z + dist);
        break;
      default:
        break;
    }
    camera.lookAt(target);
    controls.update();
  };

  if (webglError) {
    return (
      <div className="error-panel" style={{ padding: '24px', color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)', margin: '16px', textAlignment: 'left' }}>
        <h3>3D Geometry Rendering Error</h3>
        <pre style={{ overflowX: 'auto', fontSize: '0.8rem', marginTop: '12px', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '6px', fontFamily: 'monospace' }}>{webglError}</pre>
        <button className="toolbar-btn" onClick={() => window.location.reload()} style={{ marginTop: '16px' }}>🔄 Reload Studio</button>
      </div>
    );
  }

  // Tooltip component
  const Tooltip = () => {
    if (!tooltip.visible || !tooltip.data) return null;
    const d = tooltip.data;
    return (
      <div style={{
        position: 'absolute',
        left: Math.min(tooltip.x, (containerRef.current?.clientWidth || 800) - 260),
        top: tooltip.y,
        zIndex: 100,
        background: 'rgba(10, 14, 30, 0.96)',
        border: `1px solid ${d.color}55`,
        borderLeft: `3px solid ${d.color}`,
        borderRadius: '10px',
        padding: '12px 16px',
        width: '240px',
        boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 16px ${d.color}22`,
        pointerEvents: 'none',
        backdropFilter: 'blur(12px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: d.color, boxShadow: `0 0 8px ${d.color}` }} />
          <span style={{ color: d.color, fontWeight: 700, fontSize: '0.9rem', letterSpacing: '0.05em' }}>{d.label}</span>
          <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{d.fullName}</span>
        </div>
        <div style={{ color: '#e2e8f0', fontSize: '0.8rem', lineHeight: '1.5', marginBottom: '8px' }}>
          {d.description}
        </div>
        <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '6px 10px', color: d.color, fontSize: '0.82rem', fontFamily: 'monospace', fontWeight: 600 }}>
          {d.value}
        </div>
      </div>
    );
  };

  return (
    <div className="airplane-3d-wrapper" style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Top Toolbar for 100% reliable clicks */}
      <div className="controls-toolbar" style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(17, 24, 39, 0.9)', borderBottom: '1px solid rgba(99, 102, 241, 0.2)', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="toolbar-btn" onClick={() => snapToView('iso')} title="Isometric View">ISO</button>
          <button className="toolbar-btn" onClick={() => snapToView('top')} title="Top View">TOP</button>
          <button className="toolbar-btn" onClick={() => snapToView('side')} title="Side View">SIDE</button>
          <button className="toolbar-btn" onClick={() => snapToView('front')} title="Front View">FRONT</button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            className={`toolbar-btn ${viewMode === 'shaded' ? 'active' : ''}`} 
            onClick={() => setViewMode('shaded')}
          >
            Glass Body
          </button>
          <button 
            className={`toolbar-btn ${viewMode === 'wireframe' ? 'active' : ''}`} 
            onClick={() => setViewMode('wireframe')}
          >
            Wireframe
          </button>
          <button 
            className={`toolbar-btn ${viewMode === 'both' ? 'active' : ''}`} 
            onClick={() => setViewMode('both')}
          >
            Both
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button className={`toolbar-btn ${showGrid ? 'active' : ''}`} onClick={() => setShowGrid(!showGrid)}>Grid</button>
          <button className={`toolbar-btn ${showAxes ? 'active' : ''}`} onClick={() => setShowAxes(!showAxes)}>Axes</button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button className={`toolbar-btn ${showVLM ? 'active' : ''}`} onClick={() => setShowVLM(v => !v)} title="Vortex Lattice Panel Grid" style={{ borderColor: showVLM ? '#38bdf8' : '' }}>VLM Grid</button>
          <button className={`toolbar-btn ${showClMap ? 'active' : ''}`} onClick={() => setShowClMap(v => !v)} title="Cl Heatmap on wing surface" style={{ borderColor: showClMap ? '#10b981' : '' }}>Cl Map</button>
          <button className={`toolbar-btn ${showPVec ? 'active' : ''}`} onClick={() => setShowPVec(v => !v)} title="Pressure/Circulation Vectors at 3/4 chord" style={{ borderColor: showPVec ? '#a855f7' : '' }}>∮ Press.</button>
        </div>
      </div>
      {/* Legend Overlay */}
      <div style={{ position: 'absolute', bottom: '16px', right: '16px', background: 'rgba(5, 8, 16, 0.82)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.2)', fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '5px', pointerEvents: 'none' }}>
        <LegendDot color="#ef4444" label="Center of Gravity (CG)" />
        <LegendDot color="#3b82f6" label="Neutral Point (NP)" />
        <LegendDot color="#10b981" label="Aero. Center (AC)" />
        {strips.length > 0 && <>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '3px 0' }} />
          <LegendGrad label="Lift arrows (Cl)" />
          <LegendDot color="#a855f7" label="Circ. vectors (3/4c)" shape="line" />
          <LegendDot color="#38bdf8" label="VLM grid" shape="line" />
        </>}
      </div>

      <div style={{ width: '100%', flex: 1, position: 'relative' }}>
        <div ref={containerRef} className="canvas-container" style={{ width: '100%', height: '100%', position: 'relative' }} />
        <Tooltip />
      </div>
    </div>
  );
}

function LegendDot({ color, label, shape = 'dot' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {shape === 'dot'
        ? <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: color, flexShrink: 0 }} />
        : <div style={{ width: '14px', height: '2px', background: color, flexShrink: 0, borderRadius: '1px' }} />
      }
      <span style={{ color: '#cbd5e1' }}>{label}</span>
    </div>
  );
}

function LegendGrad({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '40px', height: '8px', borderRadius: '3px', background: 'linear-gradient(to right, #00ff00, #ffff00, #ff0000)', flexShrink: 0 }} />
      <span style={{ color: '#cbd5e1' }}>{label}</span>
    </div>
  );
}

