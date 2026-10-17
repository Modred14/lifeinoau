"use client";

/**
 * Small 3D preview of a look (used by the avatar creator). Drag to spin.
 * Client-only: imported through next/dynamic from the creator.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Character, prefetchLook } from "@campus/game/characters";
import { decodeLook } from "@campuslife/shared/avatar";

export default function AvatarPreview({ look }: { look: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const charRef = useRef<Character | null>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.8));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
    key.position.set(2, 4, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xf0f5ff, 1.2);
    fill.position.set(-1.5, 1.8, 4);
    fill.target.position.set(0, 1.2, 0);
    scene.add(fill, fill.target);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 40),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 1.15, 4.4);
    camera.lookAt(0, 0.92, 0);

    const char = new Character(look);
    char.root.rotation.y = 0.15;
    scene.add(char.root);
    charRef.current = char;

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    // Drag to rotate; idle spin otherwise.
    let dragging = false;
    let lastX = 0;
    let idleSince = performance.now();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      char.root.rotation.y += (e.clientX - lastX) * 0.012;
      lastX = e.clientX;
      idleSince = performance.now();
    };
    const up = () => {
      dragging = false;
      idleSince = performance.now();
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointercancel", up);

    let raf = 0;
    let last = performance.now();
    let previewTime = 0;
    let greeted = false;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (char.ready && !reducedMotion.matches) {
        previewTime += dt;
        if (!greeted && previewTime > 1.4 && !dragging) {
          char.playEmote("Wave");
          greeted = true;
          idleSince = now;
        }
        if (!dragging && now - idleSince > 6000) char.root.rotation.y += dt * 0.2;
      }
      char.update(reducedMotion.matches ? 0 : dt, 0);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      char.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
      charRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    prefetchLook(decodeLook(look));
    charRef.current?.setLook(look);
  }, [look]);

  return <div ref={mountRef} className="preview-3d" />;
}
