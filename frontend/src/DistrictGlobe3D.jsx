import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// A stylised 3D platform shaped like Sri Lanka's silhouette, with one bar per
// district: height + color encode the soil-health score, position comes from
// each district's real lat/lng (the same SL_DISTRICTS table the 2D map uses).
// Built with plain three.js + refs (no react-three-fiber) to match this
// codebase's existing vanilla-imperative approach for map libraries — see the
// comment on SoilHealthHeatmap in App.jsx.

const LAT_MIN = 5.85, LAT_MAX = 9.85, LNG_MIN = 79.55, LNG_MAX = 81.95;
const PLATFORM_W = 3.0, PLATFORM_D = 4.4;

// The coastline as real lat/lng, so the platform and the district bars are
// built from ONE projection — markers can't drift off the island they belong to.
const COAST = [
  [9.82, 80.22], [9.70, 80.45], [9.50, 80.42], [9.27, 80.81], [9.00, 80.95],
  [8.57, 81.23], [8.45, 81.30], [7.72, 81.70], [7.40, 81.82], [6.87, 81.83],
  [6.30, 81.50], [6.12, 81.12], [5.99, 80.79], [5.92, 80.57], [6.03, 80.22],
  [6.24, 80.05], [6.58, 79.96], [6.93, 79.84], [7.21, 79.84], [7.57, 79.79],
  [8.03, 79.83], [8.23, 79.76], [8.98, 79.90], [9.50, 80.20],
];

function project(lat, lng) {
  const nx = (lng - LNG_MIN) / (LNG_MAX - LNG_MIN) - 0.5;
  const nz = (lat - LAT_MIN) / (LAT_MAX - LAT_MIN) - 0.5;
  return { x: nx * PLATFORM_W, z: -nz * PLATFORM_D };
}

// ExtrudeGeometry builds in XY, then we lay it flat with rotateX(-90°), which
// sends a shape point (sx, sy) to world (sx, 0, -sy). So sy = -z inverts it.
function toShapeXY(lat, lng) {
  const { x, z } = project(lat, lng);
  return [x, -z];
}

function barHeight(health) {
  if (health == null) return 0.12;
  return 0.12 + (Math.max(0, Math.min(100, health)) / 100) * 0.85;
}

export default function DistrictGlobe3D({ districts, colorForHealth, selectedKey, onSelectDistrict, labels, reduceMotion }) {
  const mountRef = useRef(null);
  const stateRef = useRef(null); // everything three.js-related lives here, not in React state
  const [tooltip, setTooltip] = useState(null); // { x, y, d } in container-local px
  const [supported, setSupported] = useState(true);
  const [autoRotate, setAutoRotate] = useState(!reduceMotion);

  // ---- one-time scene setup ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setSupported(false);
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 4.6, 4.5);
    camera.lookAt(0, 0, 0);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x4a5a52, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 8, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fcf97, 0.35);
    rim.position.set(-5, 2, -4);
    scene.add(rim);

    // Platform — built from the same projection as the bars, so both share one frame.
    const shape = new THREE.Shape();
    const p0 = toShapeXY(COAST[0][0], COAST[0][1]);
    shape.moveTo(p0[0], p0[1]);
    for (let i = 1; i < COAST.length; i++) {
      const p = toShapeXY(COAST[i][0], COAST[i][1]);
      shape.lineTo(p[0], p[1]);
    }
    shape.closePath();
    const platformGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 6, curveSegments: 24 });
    platformGeo.rotateX(-Math.PI / 2);
    const platformMat = new THREE.MeshPhongMaterial({ color: 0x1e4a2c, emissive: 0x0c2216, shininess: 30, transparent: true, opacity: 0.96 });
    const platform = new THREE.Mesh(platformGeo, platformMat);

    const wire = new THREE.Mesh(platformGeo.clone(), new THREE.MeshBasicMaterial({ color: 0x6fcf97, wireframe: true, transparent: true, opacity: 0.11 }));

    // Soft glow ring under the platform
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(1.9, 2.5, 48),
      new THREE.MeshBasicMaterial({ color: 0x6fcf97, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.05;
    scene.add(glow);

    // Ambient starfield (very subtle — this is a control-room backdrop, not a game)
    const starCount = 260;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 7 + Math.random() * 6, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      starPos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.5 + 0.5;
      starPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.025, transparent: true, opacity: 0.25 }));
    scene.add(stars);

    // Platform + bars rotate together as one rigid world, so markers never
    // drift off the surface they're standing on.
    const worldGroup = new THREE.Group();
    worldGroup.add(platform, wire);
    scene.add(worldGroup);

    const barsGroup = new THREE.Group();
    worldGroup.add(barsGroup);

    const raycaster = new THREE.Raycaster();
    // Off-screen until the pointer actually moves — (0,0) is dead-centre and
    // would hover-select whatever bar sits there before the user touches anything.
    const pointerNdc = new THREE.Vector2(-10, -10);

    stateRef.current = {
      renderer, scene, camera, worldGroup, barsGroup, raycaster, pointerNdc,
      rotY: 0.5, rotX: -0.08, dragging: false, lastX: 0, lastY: 0, hoveredMesh: null,
      frame: 0, disposed: false, selectedKey, onSelectDistrict,
    };

    function resize() {
      const w = mount.clientWidth, h = mount.clientHeight || 420;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    function onPointerDown(e) {
      const st = stateRef.current;
      st.dragging = true; st.lastX = e.clientX; st.lastY = e.clientY;
    }
    function onPointerUp() { if (stateRef.current) stateRef.current.dragging = false; }
    function onPointerMove(e) {
      const st = stateRef.current;
      if (!st) return;
      const rect = mount.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (st.dragging) {
        const dx = e.clientX - st.lastX, dy = e.clientY - st.lastY;
        st.lastX = e.clientX; st.lastY = e.clientY;
        st.rotY += dx * 0.006;
        st.rotX = Math.max(-0.5, Math.min(0.15, st.rotX + dy * 0.004));
      }
    }
    function onLeave() { if (stateRef.current) stateRef.current.dragging = false; setTooltip(null); }
    function onClick() {
      const st = stateRef.current;
      const d = st?.hoveredMesh?.userData?.district;
      if (d) st.onSelectDistrict?.(d.key === st.selectedKey ? null : d.key);
    }

    mount.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("pointerleave", onLeave);
    mount.addEventListener("click", onClick);

    function animate() {
      const st = stateRef.current;
      if (!st || st.disposed) return;
      st.frame = requestAnimationFrame(animate);

      worldGroup.rotation.y = st.rotY;
      worldGroup.rotation.x = st.rotX;

      // raycast for hover
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(barsGroup.children, true);
      const hitMesh = hits.find((h) => h.object.userData?.district)?.object || null;
      if (hitMesh !== st.hoveredMesh) {
        if (st.hoveredMesh) st.hoveredMesh.scale.set(1, 1, 1);
        st.hoveredMesh = hitMesh;
        if (hitMesh) {
          hitMesh.scale.set(1.25, 1, 1.25);
          const d = hitMesh.userData.district;
          const v = hitMesh.position.clone();
          v.y += hitMesh.userData.h / 2 + 0.1;
          v.applyMatrix4(barsGroup.matrixWorld);
          v.project(camera);
          const rect = mount.getBoundingClientRect();
          setTooltip({ x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height, d });
        } else {
          setTooltip(null);
        }
      }

      renderer.render(scene, camera);
    }
    stateRef.current.frame = requestAnimationFrame(animate);

    return () => {
      const st = stateRef.current;
      if (st) { st.disposed = true; cancelAnimationFrame(st.frame); }
      ro.disconnect();
      mount.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerleave", onLeave);
      mount.removeEventListener("click", onClick);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      stateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the click handler (registered once, above) seeing live values —
  // it reads these off stateRef instead of closing over stale props.
  useEffect(() => {
    if (stateRef.current) {
      stateRef.current.selectedKey = selectedKey;
      stateRef.current.onSelectDistrict = onSelectDistrict;
    }
  }, [selectedKey, onSelectDistrict]);

  // ---- slow idle auto-rotate ----
  useEffect(() => {
    if (!autoRotate) return;
    let raf;
    const tick = () => {
      const st = stateRef.current;
      if (st && !st.dragging && !st.hoveredMesh) st.rotY += 0.0018;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate]);

  // ---- rebuild bars whenever the data (or selection) changes ----
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    const { barsGroup } = st;
    while (barsGroup.children.length) {
      const c = barsGroup.children.pop();
      c.geometry?.dispose();
      c.material?.dispose();
    }
    (districts || []).forEach((d) => {
      const { x, z } = project(d.lat, d.lng);
      const h = barHeight(d.health);
      const color = new THREE.Color(colorForHealth(d.health));
      const isSelected = selectedKey && d.key === selectedKey;

      const TOP = 0.15; // platform surface height (extrude depth + bevel)

      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, h, 0.1),
        new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: isSelected ? 0.55 : 0.22, transparent: true, opacity: 0.92 })
      );
      bar.position.set(x, TOP + h / 2, z);
      bar.userData = { district: d, h };
      barsGroup.add(bar);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.055, 0.1, 20),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isSelected ? 0.9 : 0.5, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, TOP + 0.01, z);
      barsGroup.add(ring);

      if (isSelected) {
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.006, 0.03, 0.7, 6),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25 })
        );
        beam.position.set(x, TOP + h + 0.4, z);
        barsGroup.add(beam);
      }
    });
  }, [districts, selectedKey, colorForHealth]);

  if (!supported) {
    return (
      <div className="gov-glass" style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.6)" }}>
        {labels?.unsupported || "3D view isn't supported in this browser."}
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <div ref={mountRef} className="gov-globe" />
      {tooltip && (
        <div className="gov-globe-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <strong>{tooltip.d.label}</strong>
          <div>{labels?.lands}: {tooltip.d.lands ?? "—"}</div>
          <div>{labels?.health}: {tooltip.d.health ?? "—"}</div>
          <div className="gov-globe-tooltip-nutrients">N {tooltip.d.avg_n ?? "—"} · P {tooltip.d.avg_p ?? "—"} · K {tooltip.d.avg_k ?? "—"} · pH {tooltip.d.avg_ph ?? "—"}</div>
        </div>
      )}
      <div className="gov-globe-controls">
        <button type="button" onClick={() => setAutoRotate((v) => !v)}>{autoRotate ? (labels?.pause || "Pause") : (labels?.rotate || "Rotate")}</button>
        <span className="gov-globe-hint">{labels?.drag || "Drag to rotate"}</span>
      </div>
    </div>
  );
}
