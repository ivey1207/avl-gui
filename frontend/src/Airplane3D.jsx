import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export default function Airplane3D({ parsed, results }) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const planeGroupRef = useRef(null);
  const lastSnappedModelRef = useRef('');

  const [webglError, setWebglError] = useState(null);
  const [viewMode, setViewMode] = useState('shaded'); // 'shaded' | 'wireframe' | 'both'
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);

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

      // ── Helper for Text Sprites ──
      const createTextSprite = (message, color) => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 128;
        context.font = "Bold 48px 'Inter', sans-serif";
        context.fillStyle = color;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(message, 128, 64);
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(1.5, 0.75, 1);
        sprite.renderOrder = 999;
        return sprite;
      };

      // ── Center of Gravity (CG - Red) ──
      if (parsed.Xref != null) {
        // Z is negated to match getGlobalPoint's Y-up mapping (-sec.Zle)
        const cgPos = new THREE.Vector3(parsed.Yref, -parsed.Zref, -parsed.Xref);
        
        const cgGeom = new THREE.SphereGeometry(0.12, 16, 16);
        const cgMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
        const cgMesh = new THREE.Mesh(cgGeom, cgMat);
        cgMesh.position.copy(cgPos);
        planeGroup.add(cgMesh);

        const ringGeom = new THREE.RingGeometry(0.18, 0.22, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.copy(cgPos);
        ring.rotation.x = Math.PI / 2;
        planeGroup.add(ring);

        const cgLabel = createTextSprite("CG", "#ef4444");
        cgLabel.position.copy(cgPos).add(new THREE.Vector3(0, 0.4, 0));
        planeGroup.add(cgLabel);
      }

      // ── Neutral Point (NP - Blue) ──
      if (results?.Xnp != null) {
        const npPos = new THREE.Vector3(parsed.Yref || 0, -(parsed.Zref || 0), -results.Xnp);
        const npGeom = new THREE.SphereGeometry(0.1, 16, 16);
        const npMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
        const npMesh = new THREE.Mesh(npGeom, npMat);
        npMesh.position.copy(npPos);
        planeGroup.add(npMesh);

        const npLabel = createTextSprite("NP", "#3b82f6");
        npLabel.position.copy(npPos).add(new THREE.Vector3(0, 0.4, 0));
        planeGroup.add(npLabel);
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
        const acGeom = new THREE.SphereGeometry(0.1, 16, 16);
        const acMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
        const acMesh = new THREE.Mesh(acGeom, acMat);
        acMesh.position.copy(acPos);
        planeGroup.add(acMesh);

        const acLabel = createTextSprite("AC", "#10b981");
        acLabel.position.copy(acPos).add(new THREE.Vector3(0, 0.4, 0));
        planeGroup.add(acLabel);
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
  }, [parsed, results]); // Re-run when model or simulation results change

  // ── 3. Handle Visibility Toggles without recreating scene ──
  useEffect(() => {
    if (!planeGroupRef.current) return;
    const group = planeGroupRef.current;
    
    // Toggle Grid and Axes
    const grid = group.getObjectByName('gridHelper');
    if (grid) grid.visible = showGrid;
    const axes = group.getObjectByName('axesHelper');
    if (axes) axes.visible = showAxes;

    // Toggle Shaded / Wireframe
    group.children.forEach(child => {
      if (child.userData.isShaded) {
        child.visible = (viewMode === 'shaded' || viewMode === 'both');
      }
      if (child.userData.isWireframe) {
        child.visible = (viewMode === 'wireframe' || viewMode === 'both');
      }
    });
  }, [viewMode, showGrid, showAxes]);

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
          <button 
            className={`toolbar-btn ${showGrid ? 'active' : ''}`} 
            onClick={() => setShowGrid(!showGrid)}
          >
            Grid
          </button>
          <button 
            className={`toolbar-btn ${showAxes ? 'active' : ''}`} 
            onClick={() => setShowAxes(!showAxes)}
          >
            Axes
          </button>
        </div>
      </div>
      {/* Legend Overlay */}
      <div style={{ position: 'absolute', bottom: '16px', right: '16px', background: 'rgba(5, 8, 16, 0.7)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.2)', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '6px', pointerEvents: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }}></div>
          <span style={{ color: '#e2e8f0' }}>Center of Gravity (CG)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#3b82f6' }}></div>
          <span style={{ color: '#e2e8f0' }}>Neutral Point (NP)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }}></div>
          <span style={{ color: '#e2e8f0' }}>Aerodynamic Center (AC)</span>
        </div>
      </div>

      <div ref={containerRef} className="canvas-container" style={{ width: '100%', flex: 1, position: 'relative' }} />
    </div>
  );
}
