"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Character } from "@campus/game/characters";
import { studioFraming, type StudioFocus } from "@campus/game/studio-framing";
import { GameIcon } from "./GameIcon";

interface Props {
  look: string;
  focus?: StudioFocus;
  turn?: number;
}

export default function StudioViewport({ look, focus = "full", turn = 0 }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const charRef = useRef<Character | null>(null);
  const options = useRef({ focus, turn });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  options.current = { focus, turn };

  useEffect(() => {
    const mount = mountRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      setStatus("error");
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.setAttribute("aria-label", "Student preview. Drag to rotate.");
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentMap = pmrem.fromScene(environment, 0.04);
    scene.environment = environmentMap.texture;
    scene.environmentIntensity = 0.6;
    environment.dispose();
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xe7efff, 0x80705e, 1.6));
    const key = new THREE.DirectionalLight(0xfff3dd, 3.2);
    key.position.set(-2.2, 3.8, 3.5);
    key.target.position.set(0, 0.9, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -1.8;
    key.shadow.camera.right = 1.8;
    key.shadow.camera.top = 2.6;
    key.shadow.camera.bottom = -1;
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 10;
    key.shadow.normalBias = 0.025;
    scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xe0eaff, 2.1);
    fill.position.set(2, 1.8, 3.5);
    fill.target.position.set(0, 1.25, 0);
    const rim = new THREE.DirectionalLight(0xffefd5, 2.4);
    rim.position.set(-0.3, 2.8, -2.2);
    scene.add(fill, fill.target, rim);

    const floor = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.025, 64), new THREE.MeshStandardMaterial({ color: 0x77796f, roughness: 0.88 }));
    floor.position.y = -0.026;
    floor.receiveShadow = true;
    scene.add(floor);
    const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 50);
    const char = new Character(look);
    char.root.rotation.y = 0.12;
    scene.add(char.root);
    charRef.current = char;
    let width = 1;
    let height = 1;
    let cameraCenter = 0.96;
    let cameraDistance = 4.4;
    let yaw = 0.12;
    let targetYaw = 0.12;
    let lastTurn = options.current.turn;
    let dragging = false;
    let lastX = 0;
    let last = performance.now();
    let painted = last;
    let previewTime = 0;
    let greeted = false;
    let observedStatus = "loading";
    let loadedModel: THREE.Object3D | undefined;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const resize = () => {
      width = mount.clientWidth || 1;
      height = mount.clientHeight || 1;
      const pixelBudget = 1_400_000;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 500 ? 1.5 : 1.75, Math.sqrt(pixelBudget / (width * height))));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();
    const framing = studioFraming(options.current.focus, camera.aspect, char.look.body);
    cameraCenter = framing.center;
    cameraDistance = framing.distance;

    const down = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      targetYaw += (event.clientX - lastX) * 0.01;
      yaw = targetYaw;
      lastX = event.clientX;
    };
    const up = () => { dragging = false; };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointercancel", up);
    const contextLost = (event: Event) => { event.preventDefault(); setStatus("error"); };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);

    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || now - painted < 1000 / 30) {
        if (document.hidden) last = now;
        return;
      }
      painted = now;
      const dt = Math.min(0.08, (now - last) / 1000);
      last = now;
      if (char.status !== observedStatus) {
        observedStatus = char.status;
        setStatus(char.status);
      }
      if (options.current.turn !== lastTurn) {
        targetYaw += (options.current.turn - lastTurn) * Math.PI / 4;
        lastTurn = options.current.turn;
      }
      if (char.ready && char.root.children[0] !== loadedModel) {
        loadedModel = char.root.children[0];
        char.root.traverse((object) => { if ((object as THREE.Mesh).isMesh) object.castShadow = true; });
      }
      const target = studioFraming(options.current.focus, camera.aspect, char.look.body);
      const ease = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 7);
      cameraCenter += (target.center - cameraCenter) * ease;
      cameraDistance += (target.distance - cameraDistance) * ease;
      yaw += (targetYaw - yaw) * ease;
      char.root.rotation.y = yaw;
      camera.position.set(0, cameraCenter + (options.current.focus === "shoes" ? 0.18 : 0.035), cameraDistance);
      camera.lookAt(0, cameraCenter, 0);
      if (char.ready && !reducedMotion.matches) {
        previewTime += dt;
        if (!greeted && previewTime > 1.7 && !dragging && options.current.focus === "full") {
          char.playEmote("Wave");
          greeted = true;
        }
      }
      char.update(reducedMotion.matches ? 0 : dt, 0);
      char.root.updateMatrixWorld(true);
      char.lookAt(camera.position);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      char.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      key.shadow.map?.dispose();
      environmentMap.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      charRef.current = null;
    };
  }, [retry]);

  useEffect(() => {
    charRef.current?.setLook(look);
  }, [look]);

  return <div ref={mountRef} className="preview-3d studio-viewport" aria-busy={status === "loading"}>
    {status !== "ready" && <div className={`studio-preview-status studio-preview-${status}`} role="status">
      {status === "loading" ? <><GameIcon name="person" /><span>Getting your student ready…</span></> : <><span>We couldn’t load your student.</span><button className="btn btn-ghost" onClick={() => { setStatus("loading"); setRetry((value) => value + 1); }}>Try again</button></>}
    </div>}
  </div>;
}
