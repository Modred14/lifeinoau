/**
 * CampusView: the 3D campus. Renders the world, building interiors, the
 * shuttles/buses and every player, and turns keyboard / tap input into
 * movement INTENT for the server.
 *
 * Netcode (the simulation is 2D on the ground plane, in map pixels):
 *  - Local player: predicted every frame with the shared stepMovement(),
 *    eased toward the server's authoritative position. While sitting,
 *    sleeping or riding, the server alone decides where you are.
 *  - Remote players + vehicles: rendered INTERPOLATION_DELAY_MS in the past,
 *    blending between buffered server updates.
 *  - Interiors are slots south of the map in the same room, so entering a
 *    building is just a teleport; this view swaps the campus for the room.
 */
import * as THREE from "three";
import { Callbacks } from "@colyseus/sdk";
import {
  ACTS,
  ACT_POSE,
  ACT_VERB,
  BOARD_DISTANCE,
  BUILDINGS,
  EMOTES,
  INTERIORS,
  LINES,
  PLACES,
  PX_PER_METER,
  IDLE,
  INTERPOLATION_DELAY_MS,
  MAP_WIDTH_PX,
  Msg,
  SERVER_TICK_MS,
  SPOTS,
  STALLS,
  ServerMsg,
  USE_DISTANCE,
  BOARD_PROMPT_BIAS,
  noticeBoardNear,
  readNoticeBoard,
  VEHICLE_SPECS,
  WORLD_WIDTH_PX,
  MAP_HEIGHT_PX,
  byteToAngle,
  findPath,
  paperName,
  semesterView,
  floorHeightAt,
  planTrip,
  lineRidePx,
  PLAYER_SPEED,
  MOTOR_PARK,
  JOB_DISTANCE,
  BACKGROUNDS,
  stepCar,
  QUEUES,
  QUEUE_JOIN_DISTANCE,
  lineFare,
  queueOfSpot,
  queueOfStop,
  type QueueState,
  type OrderState,
  ORDER,
  DELIVER_DISTANCE,
  activeEvents,
  daylight,
  formatClock,
  gameTime,
  EVENTS,
  eventPlace,
  degreeClass,
  REAL_SECONDS_PER_GAME_MINUTE,
  type Car,
  interiorAt,
  isBlocked,
  stepMovement,
  conditionPace,
  type EmotePayload,
  type Interior,
  stallOfSpot,
  stallOpen,
  type MoveDirPayload,
  type MoveToPayload,
  type Mover,
  type PlayerState,
  type Point,
  type SetLookPayload,
  type TripPlan,
  type VehicleState,
} from "@campuslife/shared";
import {
  DEFAULT_TRANSPORT,
  HAIL_LINE,
  PUSH_SPEED,
  TRAFFIC_BUS_NAME,
  TRAFFIC_LINE,
  TRAFFIC_RENDER_DELAY_MS,
  pushOut,
  vehicleBody,
  HAIL_MIN_RIDE_PX,
  HAIL_MODES,
  TRAVEL_CHOICE_MIN_PX,
  TRAVEL_MODE_LABEL,
  VEHICLE_KINDS,
  allowsMode,
  fareFor,
  findRoadPath,
  nearestRoadPoint,
  parseHailUpdate,
  parseTransportConfig,
  pathLength,
  type HailMode,
  type HailPayload,
  type HailUpdate,
  type TransportConfig,
  type TravelMode,
} from "@campuslife/shared";
import { sanitizePhoneId, type BuyPhonePayload, type BuyItemPayload, type ShopReceipt } from "@campuslife/shared";
import { encodeLook, randomLook, type AnimationName } from "@campuslife/shared/avatar";
import { loadCamera, saveCamera } from "@campus/lib/camera-store";
import { loadControls, loadSound, type ControlSettings, type SoundSettings } from "@campus/lib/settings";
import { Ambience } from "./ambience";
import { CameraRig, INDOOR_LIMITS, OUTDOOR_LIMITS, type CameraPose } from "./camera";
import { Character, type Pose } from "./characters";
import { toMap, toWorld, yawForDir, yawForVector } from "./coords";
import { buildInterior, type BuiltInterior } from "./interior";
import { NO_RECORD, hudClassNext, hudClassNow, readRecord, timetableView, venueClass, type StudentRecord } from "./academics-view";
import { NO_ADMIN, adminPrompts, adminView, readAdmin, type AdminAction, type AdminLive } from "./admin-view";
import { ClassScene } from "./interior/classmates";
import { createVenueLife, type VenueLife } from "./interior/stage";
import { activityLook } from "./interior/activity";
import { interiorGround } from "./interior/ground";
import { disposeLabel, makeLabel } from "./labels";
import type { CampusRoom } from "./network";
import { disposeVehicle, makeVehicle, setVehiclePassengers } from "./vehicles";
import { buildWorld, type BuiltWorld } from "./world";
import { PoliticsLayer, playerTag, retag } from "./politics";
import { pickBuilding } from "./pick-building";
import { fareNow, gistView, noteAdmin, spotlight, spotlightDoor } from "./gist-view";
import { SocialLayer } from "./social";
import { ConditionsLayer } from "./conditions";
import { SubscriptionScope } from "./lifecycle";

const WALK_DETOUR = 1.3;
const HAIL_PICKUP_SECONDS = 25;
const HAIL_PACE = 0.75;
const TRIP_ANY_SPEED = 1.6;
const HAIL_REPLY_MS = 6000;
const HAIL_SETTLE_MS = 400;
const HAIL_PICKUP_REACH_PX = 5 * PX_PER_METER;

export interface TravelChoice {
  target: Point;
  name: string;
  /** Cash in hand when the choice was offered. */
  cash: number;
  options: TravelOption[];
}

export interface TravelOption {
  mode: TravelMode;
  label: string;
  fare: number;
  seconds: number;
  /** Distance covered by this option, in metres. */
  meters: number;
  detail?: string;
  plan?: TripPlan;
  blocked?: string;
}

interface HailTrip {
  hail: HailMode;
  target: Point;
  phase: "calling" | "coming" | "waiting" | "riding" | "final";
  pickup?: Point;
  fare: number;
  rode: boolean;
  lastSend: number;
  retries: number;
}

interface Snapshot {
  t: number;
  x: number;
  y: number;
  dir: number;
}

interface Entity {
  id: string;
  isLocal: boolean;
  holder: THREE.Group;
  char: Character;
  tag: THREE.Sprite;
  blob: THREE.Mesh;
  /** Current rendered position (map px) and facing. */
  x: number;
  y: number;
  yaw: number;
  speed: number;
  /** Remote only. */
  buffer: Snapshot[];
  lastEmoteSeq: number;
  state: PlayerState;
  subscriptions: SubscriptionScope;
}

interface LocalState {
  entity: Entity;
  mover: Mover;
  server: { x: number; y: number };
}

interface VehicleEntity {
  index: number;
  state: VehicleState;
  mesh: THREE.Group;
  buffer: { t: number; x: number; y: number; rot: number }[];
  x: number;
  y: number;
  yaw: number;
  /** Ground speed (m/s), from interpolation; used for boarding student-driven buses. */
  speed: number;
  subscriptions: SubscriptionScope;
}

interface Npc {
  char: Character;
  x: number;
  y: number;
}

/** What the minimap needs each frame. */
export interface Radar {
  me?: { x: number; y: number; yaw: number };
  /** Camera spin, so the minimap can rotate with the view (GTA-style). */
  cameraYaw: number;
  others: { x: number; y: number }[];
  vehicles: { x: number; y: number; kind: "shuttle" | "bus" | "student" }[];
  route: Point[];
  inside: boolean;
}

/** The context action button ("Enter Moremi Hall", "Sit", "Board shuttle"...). */
export interface Prompt {
  id: string;
  icon: string;
  label: string;
  detail?: string;
  disabled?: boolean;
  /** Optional second, riskier action (e.g. copying in an exam). */
  alt?: { icon: string; label: string };
}

export interface Stats {
  food: number;
  energy: number;
  fun: number;
  cash: number;
  study: number;
  debt: number;
  skills: { drive: number; cook: number; teach: number };
  /** From the server (a saved profile keeps its background). */
  background: string;
}

/** Food orders as the UI needs them. */
export interface OrdersView {
  /** Your own order, if any. */
  mine?: { label: string; status: "cooking" | "waiting" | "picking" | "coming" | "campus"; rider?: string };
  /** Riders: open orders you could take (closest first). */
  open: { id: string; label: string; customer: string; meters: number }[];
  /** Riders: the delivery you're doing. */
  job?: { id: string; label: string; customer: string; stage: "pickup" | "deliver" };
  packs: number;
  rider: boolean;
}

/** The campus clock line for the HUD. */
export interface ClockView {
  /** "Fri 21:30" */
  time: string;
  /** What's on now, or what's next today ("📚 GST 101 at AUD I till 11:50"). */
  now?: string;
  next?: string;
  /** "Harmattan Semester · Lectures" */
  term: string;
  night: boolean;
}

/** Where the local player is: a building, a vehicle, or out on campus. */
export interface Whereabouts {
  place?: string;
  queue?: { what: string; position: number };
  riding?: { line: string; next: string; atStop: boolean };
  driving?: { passengers: number };
}

const SNAP_DISTANCE = 96;
const MOVING_TOLERANCE = 40;
const TAP_MAX_DRAG = 12;
const CULL_DISTANCE = 60; // metres
const NPC_DISTANCE = 70;
const STATUS_PROMPT_BELOW = -300;
const SELLER_DROP_DISTANCE = NPC_DISTANCE * 2;
/** Radians of camera spin per pixel dragged. */
const ROTATE_SPEED = 0.006;
const TILT_SPEED = 0.0045;
/** Keyboard spin speed (Q/E), radians per second. */
const KEY_ROTATE_SPEED = 2.2;
const KEY_TILT_SPEED = 1.2;
const KEY_ZOOM_SPEED = 1.6;
const WHEEL_ZOOM = 0.0015;
const WHEEL_PINCH_ZOOM = 0.012;
const WHEEL_ROTATE = 0.003;
const WHEEL_MAX_STEP = 120;
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 100;
const FLING_BLEND = 0.35;
const FLING_MIN_SPEED = 220;
const FLING_MAX_SPEED = 3200;
const FLING_MAX_PAUSE_MS = 70;
const CAMERA_SAVE_FRAMES = 30;
const CAMERA_SAVE_EPSILON = 0.001;
const VIEW_FAR_BASE = 260;
const VIEW_FAR_MARGIN = 20;
const VIEW_NEAR_MIN = 0.5;
const VIEW_NEAR_MAX = 5;
const VIEW_NEAR_RATIO = 0.01;
const SHADOW_HALF = 38;
const SHADOW_FAR = 180;
const SHADOW_NORMAL_BIAS = 0.05;
const SHADOW_STEP = 45;
const SHADOW_MAX_SCALE = 6;
const SHADOW_FADE_FROM = 240;
const SHADOW_FADE_TO = 330;
const VEHICLE_DISTANCE = 160;
const SOLID_CHECK_PX = 12 * PX_PER_METER;
const AMBIENCE_EVERY_FRAMES = 15;
const TRAFFIC_EARSHOT = 60;
const TRAFFIC_FULL_ROAR = 2.5;
const VEHICLE_DISTANCE_RATIO = 1.5;
const TAP_MAX_DISTANCE = 150;
/** Walk up to a door this close (map px) to get the "Enter" button. */
const DOOR_PROMPT_DISTANCE = 4.5 * PX_PER_METER;
const SUN_OFFSET = new THREE.Vector3(-28, 60, 34);
const NO_STOP = 255;

const KEY_AXES: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

const CAMERA_KEYS = new Set(["KeyQ", "KeyE", "KeyR", "KeyV", "KeyZ", "KeyX", "Equal", "Minus"]);
const RECENTER_KEY = "KeyC";

interface PointerTrack {
  x: number;
  y: number;
  startX: number;
  startY: number;
  dragging: boolean;
  pan: boolean;
  vx: number;
  vy: number;
  movedAt: number;
}

const ACT_ICON: Record<string, string> = {
  sit: "🪑", sleep: "🛏️", eat: "🍲", study: "📚", pray: "🙏", tv: "📺", play: "🎱", atm: "🏧",
  cook: "🍳", tutor: "🧑🏾‍🏫", loan: "🏦", dance: "💃", exam: "📝",
};

/** Shadows cost a second render pass; skip them on low-memory phones or Data Saver. */
function wantShadows(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (nav.deviceMemory ?? 8) >= 4 && !nav.connection?.saveData;
}

export class CampusView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, VIEW_NEAR_MIN, VIEW_FAR_BASE);
  private world: BuiltWorld;
  politics: PoliticsLayer;
  social: SocialLayer;
  conditions: ConditionsLayer;
  private sun: THREE.DirectionalLight;
  private shadows: boolean;
  private entities = new Map<string, Entity>();
  private vehicles: VehicleEntity[] = [];
  private local?: LocalState;
  private subscriptions = new SubscriptionScope();
  private raf = 0;
  private lastFrame = performance.now();
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private frameN = 0;

  // camera
  private cam = new CameraRig();
  private freeCamera = false;
  private savedCamera: CameraPose | null = loadCamera();
  private outdoorCamera?: CameraPose;
  private shadowScale = 1;
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private controls: ControlSettings = loadControls();
  private ambience = new Ambience(loadSound());
  private camTarget = new THREE.Vector3(toWorld(MAP_WIDTH_PX / 2), 0, toWorld(MAP_WIDTH_PX / 4));
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // input
  private keys = new Set<string>();
  /** Virtual joystick direction (-1/0/1 per axis), merged with the keyboard. */
  private stick = { dx: 0, dy: 0 };
  /** Direction last sent to the server (map space, unit vector or 0,0). */
  private lastAxis = { dx: 0, dy: 0 };
  private pointers = new Map<number, PointerTrack>();
  private multiTouch = false;
  private gesture = { distance: 0, angle: 0, x: 0, y: 0 };

  // GPS route (map px waypoints)
  private route: Point[] = [];
  private routeKind: "gps" | "tap" = "gps";
  private routeRetries = 0;
  private routeLine?: THREE.Line;
  private destMarker: THREE.Mesh;
  private tapMarker: THREE.Mesh;
  private tapMarkerTime = 0;
  private blobGeo = new THREE.CircleGeometry(0.45, 20);
  private blobMat: THREE.MeshBasicMaterial;

  // interiors, NPCs, prompts
  private insidePlace = -1;
  private interior?: { built: BuiltInterior; npcs: Npc[] };
  private student: StudentRecord = NO_RECORD;
  private adminLive: AdminLive = NO_ADMIN;
  private classScene = new ClassScene();
  private venue?: VenueLife;
  private stallNpcs = new Map<number, Npc>();
  private prompt?: { p: Prompt; run?: () => void; alt?: () => void };
  private whereKey = "";
  private statsKey = "";
  /** Riding somewhere: walk to the stop, board, get off at the right stop, walk the rest. */
  private trip?: { plan: TripPlan; target: Point; phase: "toStop" | "waiting" | "riding" | "final"; lastSend: number; retries: number } | HailTrip;
  private transport: TransportConfig = DEFAULT_TRANSPORT;
  private tripText = "";
  /** Predicted car while driving a shift (the server stays authoritative). */
  private car?: Car;
  private driveInput = { t: 0, s: 0 };
  /** Simulated students standing in nearby queues (created lazily, by queue id). */
  private queueNpcs = new Map<number, Npc[]>();
  private ordersKey = "";
  private jobRouteAt = 0;
  private deliveryNpc?: { npc: Npc; until: number };
  private hemi!: THREE.HemisphereLight;
  /** Server clock (game minutes) and when we received it, for smooth local time. */
  private clockBase = { minutes: 0, at: performance.now() };
  private clockKey = "";
  /** Dev only: shift the local clock (minutes) to preview night, parties... Never sent to the server. */
  debugClockOffset = 0;

  /** Called when the GPS route changes (for the minimap / UI). */
  onRouteChange?: (active: boolean) => void;
  onPrompt?: (p: Prompt | null) => void;
  onNotice?: (text: string) => void;
  onStats?: (s: Stats) => void;
  onWhere?: (w: Whereabouts) => void;
  /** Trip status line ("Waiting for the Halls Shuttle at Moremi Hall"), or null when no trip. */
  onTrip?: (text: string | null) => void;
  onTravelChoice?: (choice: TravelChoice) => void;
  onOrders?: (o: OrdersView) => void;
  onClock?: (c: ClockView) => void;
  onFreeCamera?: (free: boolean) => void;

  constructor(
    private container: HTMLElement,
    private room: CampusRoom,
  ) {
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({
      antialias: dpr < 2, // high-DPI screens don't need MSAA; saves GPU on phones
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(dpr, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.shadows = wantShadows();
    Character.castShadows = this.shadows;
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.touchAction = "none";
    container.appendChild(this.renderer.domElement);

    // Tropical midday light: warm sun, bright sky bounce, a soft ground tint.
    const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x7d7158, 1.55);
    this.hemi = hemi;
    this.sun = new THREE.DirectionalLight(0xfff0d6, 2.7);
    if (this.shadows) {
      this.sun.castShadow = true;
      const phone = Math.min(window.innerWidth, window.innerHeight) < 700;
      this.sun.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);
      const c = this.sun.shadow.camera;
      c.left = c.bottom = -SHADOW_HALF;
      c.right = c.top = SHADOW_HALF;
      c.near = 1;
      c.far = SHADOW_FAR;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
    }
    this.scene.add(hemi, this.sun, this.sun.target);

    this.world = buildWorld(this.scene, { shadows: this.shadows });
    this.politics = new PoliticsLayer(this.scene, this.room, this.shadows);
    this.social = new SocialLayer(this.scene, this.room);
    this.conditions = new ConditionsLayer(this.scene, this.room, this.shadows);
    this.blobMat = new THREE.MeshBasicMaterial({ map: makeBlobTexture(), transparent: true, depthWrite: false });

    const ringMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.9, depthWrite: false });
    this.destMarker = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.7, 32), ringMat);
    this.destMarker.rotation.x = -Math.PI / 2;
    this.destMarker.visible = false;
    this.tapMarker = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 24), ringMat.clone());
    this.tapMarker.rotation.x = -Math.PI / 2;
    this.tapMarker.visible = false;
    this.scene.add(this.destMarker, this.tapMarker);

    this.cam.setBounds({ minX: 0, maxX: toWorld(MAP_WIDTH_PX), minZ: 0, maxZ: toWorld(MAP_HEIGHT_PX) });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.bindInput();
    this.bindRoom();
    window.addEventListener("pagehide", this.rememberCamera);
    this.raf = requestAnimationFrame(this.frame);
  }

  // ================================================================ public API

  emote(id: number) {
    const name = EMOTES[id];
    if (!name || name === "none" || !this.local || vehicleOf(this.local.entity.state)) return;
    this.local.entity.char.playEmote(emoteAnimation(id));
    this.local.entity.lastEmoteSeq = -1; // ignore our own echo
    this.room.send(Msg.Emote, { id } satisfies EmotePayload);
  }

  setLook(look: string) {
    this.room.send(Msg.SetLook, { look } satisfies SetLookPayload);
    this.local?.entity.char.setLook(look); // instant preview; server state confirms
  }

  /** Virtual joystick input in screen space (x right, y down), any length <= 1. */
  setStick(dx: number, dy: number) {
    this.stick.dx = dx;
    this.stick.dy = dy;
  }

  /** Spin the camera back to north-up. */
  resetCamera() {
    this.cam.reset();
  }

  recenterCamera() {
    this.cam.recenter();
  }

  setSound(sound: SoundSettings) {
    this.ambience.setSettings(sound);
  }

  setControls(controls: ControlSettings) {
    this.controls = { ...controls };
    if (!controls.keyboard) this.keys.clear();
  }

  /** Run the current context action (button, F or Enter key). */
  usePrompt() {
    if (this.prompt && !this.prompt.p.disabled) this.prompt.run?.();
  }

  /** Run the prompt's secondary action, if it has one. */
  usePromptAlt() {
    this.prompt?.alt?.();
  }

  /** Re-send stats / whereabouts / prompt (when the UI attaches its callbacks after we started). */
  resendUi() {
    this.statsKey = "";
    this.whereKey = "";
    if (this.local) this.reportStats(this.local.entity.state);
    this.onPrompt?.(this.prompt ? this.prompt.p : null);
    this.onTrip?.(this.trip ? this.tripText || "…" : null);
    this.ordersKey = "";
    this.updateOrders();
    this.clockKey = "";
    this.onFreeCamera?.(this.freeCamera);
  }

  orderFood(spot: number) {
    this.room.send(Msg.Order, { spot });
  }

  eatPack() {
    this.room.send(Msg.EatPack);
  }

  getPhone(): string {
    const st = this.local?.entity.state;
    return sanitizePhoneId(st?.phone, BACKGROUNDS[st?.bg ?? -1] ?? "regular");
  }

  getWallet(): { cash: number; debt: number } {
    const st = this.local?.entity.state;
    return { cash: st?.cash ?? 0, debt: st?.debt ?? 0 };
  }

  getVitals(): { food: number; energy: number; fun: number } {
    const st = this.local?.entity.state;
    return { food: st?.food ?? 100, energy: st?.energy ?? 100, fun: st?.fun ?? 100 };
  }

  buyItem(payload: BuyItemPayload, onReceipt: (receipt: ShopReceipt) => void): () => void {
    const remove = this.room.onMessage<ShopReceipt>(ServerMsg.Shop, (receipt) => {
      if (receipt.requestId === payload.requestId) onReceipt(receipt);
    });
    this.room.send(Msg.BuyItem, payload);
    return remove;
  }

  buyPhone(id: string) {
    const payload: BuyPhonePayload = { id };
    this.room.send(Msg.BuyPhone, payload);
  }

  setRiderDuty(on: boolean) {
    this.room.send(Msg.RiderDuty, { on });
  }

  acceptOrder(id: string) {
    this.room.send(Msg.Accept, { id });
  }

  exitBuilding() {
    this.room.send(Msg.Exit);
  }

  /** GPS: walk to a map point along a path around buildings. */
  navigateTo(target: Point) {
    this.cancelTrip();
    this.cam.recenter();
    this.routeTo(target);
  }

  /** Is riding a shuttle/bus there quicker than walking? Null if not worth it. */
  planTripTo(target: Point): TripPlan | null {
    if (!this.local || this.insidePlace >= 0) return null;
    return planTrip({ x: this.local.mover.x, y: this.local.mover.y }, target, PLAYER_SPEED, (kind) => allowsMode(this.transport, kind));
  }

  get cash(): number {
    return this.local?.entity.state.cash ?? 0;
  }

  get transportConfig(): TransportConfig {
    return this.transport;
  }

  travelOptions(target: Point): TravelOption[] {
    if (!this.local || this.insidePlace >= 0) return [];
    const from = { x: this.local.mover.x, y: this.local.mover.y };
    const walkPath = findPath(from, target);
    const walkPx = walkPath.length ? pathLength(from, walkPath) : Math.hypot(target.x - from.x, target.y - from.y) * WALK_DETOUR;
    const options: TravelOption[] = [{ mode: "walk", label: TRAVEL_MODE_LABEL.walk, fare: 0, seconds: walkPx / PLAYER_SPEED, meters: walkPx / PX_PER_METER }];
    if (walkPx < TRAVEL_CHOICE_MIN_PX || vehicleOf(this.local.entity.state)) return options;
    const cash = this.local.entity.state.cash;
    const hailModes = HAIL_MODES.filter((mode) => allowsMode(this.transport, mode));
    const pickup = hailModes.length ? nearestRoadPoint(from) : null;
    const dropOff = pickup ? nearestRoadPoint(target) : null;
    const road = pickup && dropOff ? findRoadPath(pickup, dropOff) : null;
    if (pickup && dropOff && road && road.length >= HAIL_MIN_RIDE_PX) {
      const onFoot = (Math.hypot(pickup.x - from.x, pickup.y - from.y) + Math.hypot(dropOff.x - target.x, dropOff.y - target.y)) * WALK_DETOUR;
      for (const mode of hailModes) {
        const fare = fareFor(this.transport, mode, road.length);
        const seconds = HAIL_PICKUP_SECONDS + road.length / (VEHICLE_SPECS[mode].cruise * HAIL_PACE) + onFoot / PLAYER_SPEED;
        options.push({ mode, label: TRAVEL_MODE_LABEL[mode], fare, seconds, meters: road.length / PX_PER_METER, detail: "Picks you up by the road", blocked: cash < fare ? "Not enough cash" : undefined });
      }
    }
    const plan = planTrip(from, target, PLAYER_SPEED, (kind) => allowsMode(this.transport, kind), TRIP_ANY_SPEED);
    const line = plan ? LINES[plan.line] : undefined;
    if (plan && line) {
      const fare = fareNow(lineFare(line.id, this.transport, lineRidePx(line, plan.board, plan.alight)), Math.floor(this.clockMinutes()));
      const short = (n: string) => n.replace(/ Hall of Residence$/, " Hall");
      options.push({ mode: line.kind, label: line.name, fare, seconds: plan.seconds, meters: lineRidePx(line, plan.board, plan.alight) / PX_PER_METER, detail: `${short(line.stops[plan.board].name)} to ${short(line.stops[plan.alight].name)}`, plan, blocked: cash < fare ? "Not enough cash" : undefined });
    }
    return options;
  }

  goTo(target: Point, name: string) {
    const options = this.travelOptions(target);
    if (options.length > 1 && this.onTravelChoice) this.onTravelChoice({ target, name, cash: this.cash, options });
    else this.navigateTo(target);
  }

  travelBy(target: Point, option: TravelOption) {
    if (option.mode === "okada" || option.mode === "keke") this.hailTo(target, option.mode);
    else if (option.plan) this.rideTo(target, option.plan);
    else this.navigateTo(target);
  }

  hailTo(target: Point, mode: HailMode) {
    if (!this.local || this.insidePlace >= 0 || vehicleOf(this.local.entity.state)) return;
    this.cancelTrip();
    this.cancelRoute();
    this.cam.recenter();
    const goal = { x: Math.round(target.x), y: Math.round(target.y) };
    this.trip = { hail: mode, target: goal, phase: "calling", fare: 0, rode: false, lastSend: performance.now(), retries: 0 };
    this.room.send(Msg.Hail, { ...goal, mode } satisfies HailPayload);
    this.updateTrip();
  }

  /** Go somewhere by shuttle/bus: walk to the stop, board, ride, get off, walk to the door. */
  rideTo(target: Point, plan: TripPlan) {
    const line = LINES[plan.line];
    if (!this.local || !line) return;
    this.cancelTrip();
    this.cam.recenter();
    this.trip = { plan, target, phase: "toStop", lastSend: 0, retries: 0 };
    if (this.local.entity.state.ride) this.trip.phase = "riding";
    else this.routeTo(line.stops[plan.board].kerb);
    this.updateTrip();
  }

  cancelTrip() {
    if (!this.trip) return;
    if ("hail" in this.trip && this.trip.phase !== "final") this.room.send(Msg.HailCancel);
    this.trip = undefined;
    this.tripText = "";
    this.onTrip?.(null);
  }

  private routeTo(target: Point, kind: "gps" | "tap" = "gps"): boolean {
    if (!this.local || this.insidePlace >= 0 || vehicleOf(this.local.entity.state)) return false;
    const m = this.local.mover;
    const path = findPath({ x: m.x, y: m.y }, target);
    if (!path.length) return false;
    this.standUpLocally();
    this.route = path;
    this.routeKind = kind;
    this.routeRetries = 0;
    this.sendNextWaypoint();
    this.updateRouteVisual();
    this.onRouteChange?.(kind === "gps");
    return true;
  }

  cancelRoute() {
    if (!this.route.length) return;
    this.route = [];
    this.updateRouteVisual();
    this.onRouteChange?.(false);
  }

  getRadar(): Radar {
    const me = this.local ? { x: this.local.entity.x, y: this.local.entity.y, yaw: this.local.entity.yaw } : undefined;
    const others: Radar["others"] = [];
    for (const e of this.entities.values()) if (!e.isLocal && !vehicleOf(e.state)) others.push({ x: e.x, y: e.y });
    const vehicles = this.vehicles.filter((v) => v && v.state.active && v.state.line !== TRAFFIC_LINE).map((v) => ({ x: v.x, y: v.y, kind: v.state.line === 255 ? ("student" as const) : (LINES[v.state.line]?.kind ?? "shuttle") }));
    return { me, others, vehicles, route: this.route, cameraYaw: this.cam.viewYaw, inside: this.insidePlace >= 0 };
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener("pagehide", this.rememberCamera);
    this.rememberCamera();
    this.unbindInput();
    this.ambience.dispose();
    this.politics.dispose();
    this.social.dispose();
    this.conditions.dispose();
    this.subscriptions.dispose();
    for (const e of this.entities.values()) this.disposeEntity(e);
    this.entities.clear();
    for (const v of this.vehicles) if (v) { v.subscriptions.dispose(); disposeVehicle(v.mesh); }
    for (const n of this.stallNpcs.values()) n.char.dispose();
    for (const list of this.queueNpcs.values()) for (const n of list) n?.char.dispose();
    this.deliveryNpc?.npc.char.dispose();
    this.leaveInterior();
    this.world.dispose();
    this.routeLine?.geometry.dispose();
    this.blobGeo.dispose();
    this.blobMat.map?.dispose();
    this.blobMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ================================================================== network

  private bindRoom() {
    const $ = Callbacks.get(this.room);
    this.subscriptions.add(
      $.onAdd("players", (p, id) => this.addPlayer(p, id)),
      $.onRemove("players", (_p, id) => this.removePlayer(id)),
      $.onAdd("vehicles", (v, i) => this.addVehicle(v, i)),
      $.listen("clock", (m: number) => {
        this.clockBase = { minutes: m, at: performance.now() };
      }),
    );
    this.subscriptions.add(this.room.onMessage(ServerMsg.Notice, (text: unknown) => {
      if (typeof text === "string") this.onNotice?.(text);
    }));
    this.subscriptions.add(this.room.onMessage(ServerMsg.Delivered, (at: unknown) => {
      const p = at as { x?: unknown; y?: unknown };
      if (typeof p?.x !== "number" || typeof p?.y !== "number") return;
      // A campus delivery rider pops up beside you for a few seconds.
      this.deliveryNpc?.npc.char.dispose();
      const npc = this.makeNpc(p.x, p.y, Math.PI, "m|hivis|hivis|casual|hivis|1|0|8|3|0");
      npc.char.playEmote("Wave");
      this.deliveryNpc = { npc, until: performance.now() + 5000 };
    }));
    this.subscriptions.add(this.room.onMessage(ServerMsg.Knock, (at: unknown) => {
      const p = at as { x?: unknown; y?: unknown };
      const l = this.local;
      if (!l || typeof p?.x !== "number" || typeof p?.y !== "number") return;
      this.cancelRoute();
      l.mover.intent = IDLE;
      l.mover.x = l.server.x = p.x;
      l.mover.y = l.server.y = p.y;
    }));
    this.subscriptions.add(this.room.onMessage(ServerMsg.Transport, (payload: unknown) => {
      const config = parseTransportConfig(payload);
      if (config) this.transport = config;
    }));
    this.subscriptions.add(this.room.onMessage(ServerMsg.Hail, (payload: unknown) => {
      const update = parseHailUpdate(payload);
      if (update) this.onHailUpdate(update);
    }));
    this.subscriptions.add(this.room.onMessage(ServerMsg.Admin, (payload: unknown) => {
      this.adminLive = readAdmin(payload, performance.now()) ?? this.adminLive;
      noteAdmin(this.adminLive.payload.record);
    }));
    this.room.send(Msg.Admin, { a: "sync" });
    this.subscriptions.add(this.room.onMessage(ServerMsg.Classes, (payload: unknown) => {
      this.student = readRecord(payload) ?? this.student;
    }));
    this.room.send(Msg.Transport);
    this.room.send(Msg.Classes);
  }

  private addVehicle(state: VehicleState, index: number) {
    const old = this.vehicles[index];
    if (old) { old.subscriptions.dispose(); disposeVehicle(old.mesh); }
    const line = LINES[state.line];
    const passing = state.line === TRAFFIC_LINE;
    const mesh = line
      ? makeVehicle(line.kind, line.name, this.shadows)
      : makeVehicle(VEHICLE_KINDS[state.kind] ?? "shuttle", passing ? TRAFFIC_BUS_NAME : "Student Shuttle", this.shadows, passing ? "town" : "campus");
    this.scene.add(mesh);
    const v: VehicleEntity = {
      index,
      state,
      mesh,
      buffer: [{ t: performance.now(), x: state.x, y: state.y, rot: state.rot }],
      x: state.x,
      y: state.y,
      yaw: headingYaw(state.rot),
      speed: 0,
      subscriptions: new SubscriptionScope(),
    };
    this.vehicles[index] = v;
    this.placeVehicle(v);
    v.subscriptions.add(
      Callbacks.get(this.room).onChange(state, () => {
        const now = performance.now();
        const buf = v.buffer;
        const last = buf[buf.length - 1];
        if (last && now - last.t > SERVER_TICK_MS * 3) buf.push({ ...last, t: now - SERVER_TICK_MS });
        buf.push({ t: now, x: state.x, y: state.y, rot: state.rot });
        if (buf.length > 30) buf.splice(0, buf.length - 30);
      }),
    );
  }

  private addPlayer(p: PlayerState, id: string) {
    this.removePlayer(id); // after a reconnect the server may resend players
    const $ = Callbacks.get(this.room);
    const isLocal = id === this.room.sessionId;

    const holder = new THREE.Group();
    const char = new Character(p.look);
    holder.add(char.root);
    const blob = new THREE.Mesh(this.blobGeo, this.blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.025;
    holder.add(blob);
    const tag = makeLabel(playerTag(BACKGROUNDS[p.bg] === "nepo" ? `${p.name} 💸` : p.name, p.office, p.status), {
      screenHeight: 0.026,
      background: isLocal ? "rgba(250,204,21,0.95)" : "rgba(29,78,216,0.85)",
      color: isLocal ? "#1c1917" : "#ffffff",
    });
    tag.position.y = p.look.startsWith("f") ? 2.0 : 2.1; // just above the head
    holder.add(tag);
    this.scene.add(holder);

    const e: Entity = {
      id,
      isLocal,
      holder,
      char,
      tag,
      blob,
      x: p.x,
      y: p.y,
      yaw: yawForDir(p.dir),
      speed: 0,
      buffer: [{ t: performance.now(), x: p.x, y: p.y, dir: p.dir }],
      lastEmoteSeq: p.emoteSeq,
      state: p,
      subscriptions: new SubscriptionScope(),
    };
    this.entities.set(id, e);
    this.applyActivity(e);
    this.placeEntity(e);

    e.subscriptions.add(
      $.listen(p, "look", (look) => e.char.setLook(look)),
      $.listen(p, "act", () => this.applyActivity(e)),
      $.listen(p, "spot", () => this.applyActivity(e)),
      $.listen(p, "office", (office) => retag(tag, playerTag(BACKGROUNDS[p.bg] === "nepo" ? `${p.name} 💸` : p.name, office, p.status), isLocal), false),
      $.listen(p, "status", (status) => retag(tag, playerTag(BACKGROUNDS[p.bg] === "nepo" ? `${p.name} 💸` : p.name, p.office, status), isLocal), false),
      $.listen(p, "emoteSeq", (seq) => {
        if (seq === e.lastEmoteSeq) return;
        if (e.isLocal && e.lastEmoteSeq === -1) {
          e.lastEmoteSeq = seq; // our own emote, already playing
          return;
        }
        e.lastEmoteSeq = seq;
        if (p.emote) e.char.playEmote(emoteAnimation(p.emote));
      }),
    );

    if (isLocal) {
      const local: LocalState = {
        entity: e,
        mover: { x: p.x, y: p.y, dir: p.dir, intent: IDLE },
        server: { x: p.x, y: p.y },
      };
      this.local = local;
      this.lastAxis = { dx: 0, dy: 0 };
      this.camTarget.set(toWorld(p.x), 0, toWorld(p.y));
      this.cam.yaw = openSideYaw(p.x, p.y);
      if (this.savedCamera) this.cam.apply(this.savedCamera);
      this.cam.snap();
      e.subscriptions.add(
        $.onChange(p, () => {
          local.server.x = p.x;
          local.server.y = p.y;
          this.reportStats(p);
        }),
      );
      this.reportStats(p);
    } else {
      e.subscriptions.add($.onChange(p, () => pushSnapshot(e, p)));
    }
  }

  private removePlayer(id: string) {
    const e = this.entities.get(id);
    if (!e) return;
    this.disposeEntity(e);
    this.entities.delete(id);
    if (this.local?.entity === e) this.local = undefined;
  }

  private disposeEntity(e: Entity) {
    e.subscriptions.dispose();
    e.char.dispose();
    disposeLabel(e.tag);
    e.holder.removeFromParent();
  }

  /** Pose the character for whatever they're doing (sitting, sleeping, eating...). */
  private applyActivity(e: Entity) {
    const kind = ACTS[e.state.act] ?? "none";
    const look = activityLook(kind, e.state.spot ? SPOTS[e.state.spot - 1] : undefined);
    const pose: Pose = look.pose;
    e.char.setPose(pose, look.detail);
    e.blob.visible = !this.shadows && pose !== "lie";
    if (e.state.spot) {
      const spot = SPOTS[e.state.spot - 1];
      if (spot) e.yaw = spotYaw(spot.face, pose === "lie");
    }
  }

  private reportStats(p: PlayerState) {
    const s: Stats = {
      food: p.food ?? 0,
      energy: p.energy ?? 0,
      fun: p.fun ?? 0,
      cash: p.cash ?? 0,
      study: p.study ?? 0,
      debt: p.debt ?? 0,
      skills: { drive: p.drive ?? 0, cook: p.cook ?? 0, teach: p.teach ?? 0 },
      background: BACKGROUNDS[p.bg] ?? "regular",
    };
    const key = JSON.stringify(s);
    if (key === this.statsKey) return;
    this.statsKey = key;
    this.onStats?.(s);
  }

  // ==================================================================== input

  private onKeyDown = (ev: KeyboardEvent) => {
    if (isTyping() || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.code === "KeyF" || ev.code === "Enter") {
      this.usePrompt();
      ev.preventDefault();
      return;
    }
    if (!this.controls.keyboard) return;
    if (ev.code === RECENTER_KEY) {
      this.cam.reset();
      ev.preventDefault();
      return;
    }
    if (KEY_AXES[ev.code] || CAMERA_KEYS.has(ev.code)) {
      this.keys.add(ev.code);
      ev.preventDefault();
    }
  };
  private onKeyUp = (ev: KeyboardEvent) => this.keys.delete(ev.code);
  private onBlur = () => this.keys.clear();

  private onPointerDown = (ev: PointerEvent) => {
    this.renderer.domElement.setPointerCapture?.(ev.pointerId);
    this.cam.halt();
    const pan = ev.pointerType === "mouse" && (ev.button !== 0 || ev.shiftKey);
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, startX: ev.clientX, startY: ev.clientY, dragging: false, pan, vx: 0, vy: 0, movedAt: ev.timeStamp });
    if (this.pointers.size >= 2) {
      this.multiTouch = true;
      this.gesture = this.measureGesture();
    }
  };

  private onPointerMove = (ev: PointerEvent) => {
    const p = this.pointers.get(ev.pointerId);
    if (!p) return;
    const dx = ev.clientX - p.x;
    const dy = ev.clientY - p.y;
    p.x = ev.clientX;
    p.y = ev.clientY;
    const elapsed = ev.timeStamp - p.movedAt;
    if (elapsed > 0) {
      p.vx += ((dx / elapsed) * 1000 - p.vx) * FLING_BLEND;
      p.vy += ((dy / elapsed) * 1000 - p.vy) * FLING_BLEND;
      p.movedAt = ev.timeStamp;
    }
    if (this.pointers.size >= 2) {
      const prev = this.gesture;
      const next = this.measureGesture();
      this.gesture = next;
      if (prev.distance > 0 && next.distance > 0) this.cam.zoomBy(prev.distance / next.distance);
      this.cam.orbit(-shortestAngle(next.angle - prev.angle), 0);
      this.panCamera(next.x - prev.x, next.y - prev.y);
      return;
    }
    if (this.multiTouch) return;
    if (!p.dragging && Math.hypot(p.x - p.startX, p.y - p.startY) > TAP_MAX_DRAG) p.dragging = true;
    if (!p.dragging) return;
    if (p.pan) return this.panCamera(dx, dy);
    const speed = this.controls.sensitivity;
    this.cam.orbit(-dx * ROTATE_SPEED * speed, dy * TILT_SPEED * speed * (this.controls.invertY ? -1 : 1));
  };

  private onPointerUp = (ev: PointerEvent) => {
    const p = this.releasePointer(ev);
    if (!p) return;
    if (p.dragging) return this.flingCamera(p, ev.timeStamp);
    if (p.pan) return;
    this.tapToMove(ev.clientX, ev.clientY);
  };

  private flingCamera(p: PointerTrack, releasedAt: number) {
    if (this.reducedMotion || releasedAt - p.movedAt > FLING_MAX_PAUSE_MS) return;
    const speed = Math.hypot(p.vx, p.vy);
    if (speed < FLING_MIN_SPEED) return;
    const k = Math.min(1, FLING_MAX_SPEED / speed);
    const vx = p.vx * k;
    const vy = p.vy * k;
    if (p.pan) return this.cam.flingPixels(vx, vy, this.renderer.domElement.clientHeight, this.camera.fov);
    const s = this.controls.sensitivity;
    this.cam.fling(-vx * ROTATE_SPEED * s, vy * TILT_SPEED * s * (this.controls.invertY ? -1 : 1));
  }

  private onPointerCancel = (ev: PointerEvent) => {
    this.releasePointer(ev);
  };

  private releasePointer(ev: PointerEvent): PointerTrack | undefined {
    const p = this.pointers.get(ev.pointerId);
    const wasMulti = this.multiTouch;
    this.pointers.delete(ev.pointerId);
    if (this.pointers.size === 0) this.multiTouch = false;
    else if (this.pointers.size >= 2) this.gesture = this.measureGesture();
    return wasMulti ? undefined : p;
  }

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const unit = ev.deltaMode === 1 ? WHEEL_LINE_PX : ev.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
    const step = (v: number) => THREE.MathUtils.clamp(v * unit, -WHEEL_MAX_STEP, WHEEL_MAX_STEP);
    if (!ev.ctrlKey && Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
      this.cam.orbit(step(ev.deltaX) * WHEEL_ROTATE * this.controls.sensitivity, 0);
      return;
    }
    this.cam.zoomBy(Math.exp(step(ev.deltaY) * (ev.ctrlKey ? WHEEL_PINCH_ZOOM : WHEEL_ZOOM)));
  };

  private panCamera(dx: number, dy: number) {
    this.cam.panPixels(dx, dy, this.renderer.domElement.clientHeight, this.camera.fov);
  }

  private bindInput() {
    const el = this.renderer.domElement;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerCancel);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", preventDefault);
  }

  private unbindInput() {
    const el = this.renderer.domElement;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerCancel);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("contextmenu", preventDefault);
  }

  private measureGesture() {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return { distance: 0, angle: 0, x: 0, y: 0 };
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /** Mirror the server: moving while seated first puts you on your feet beside the seat. */
  private standUpLocally() {
    const l = this.local;
    if (!l || !l.entity.state.spot) return;
    const spot = SPOTS[l.entity.state.spot - 1];
    if (spot && ACT_POSE[spot.kind] !== "busy") {
      l.mover.x = spot.sx;
      l.mover.y = spot.sy;
    }
  }

  private tapToMove(clientX: number, clientY: number) {
    if (!this.local || vehicleOf(this.local.entity.state)) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const picked = this.insidePlace < 0 && !this.trip ? pickBuilding(this.raycaster.ray) : null;
    if (picked) return this.goTo(picked.place.door, picked.place.name);
    if (!this.controls.tapToWalk) return;
    if (this.trip || (this.route.length && this.routeKind === "gps")) return;
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return;
    if (hit.distanceTo(this.local.entity.holder.position) > TAP_MAX_DISTANCE) return;
    const target = {
      x: Math.round(THREE.MathUtils.clamp(toMap(hit.x), 0, WORLD_WIDTH_PX)),
      y: Math.round(THREE.MathUtils.clamp(toMap(hit.z), 0, MAP_HEIGHT_PX)),
    };
    this.cam.recenter();
    this.tapMarker.position.set(hit.x, 0.06, hit.z);
    this.tapMarker.visible = true;
    this.tapMarkerTime = performance.now();
    if (this.routeTo(target, "tap")) return;
    this.cancelRoute();
    this.standUpLocally();
    this.local.mover.intent = { kind: "target", ...target };
    this.room.send(Msg.MoveTo, target satisfies MoveToPayload);
  }

  private handleKeyboard(dt: number) {
    const held = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    const turn = (held("KeyQ") ? 1 : 0) - (held("KeyE") ? 1 : 0);
    const tilt = (held("KeyR") ? 1 : 0) - (held("KeyV") ? 1 : 0);
    const zoom = (held("KeyX", "Minus") ? 1 : 0) - (held("KeyZ", "Equal") ? 1 : 0);
    if (turn || tilt) this.cam.orbit(turn * KEY_ROTATE_SPEED * dt, tilt * KEY_TILT_SPEED * dt);
    if (zoom) this.cam.zoomBy(Math.exp(zoom * KEY_ZOOM_SPEED * dt));
    if (!this.local) return;
    if (this.local.entity.state.driving) return this.handleDriving();
    if (this.local.entity.state.ride) return;

    // Screen-space input: keyboard axes + joystick.
    let sx = this.stick.dx;
    let sy = this.stick.dy;
    for (const k of this.keys) {
      const axis = KEY_AXES[k];
      if (axis) {
        sx += axis[0];
        sy += axis[1];
      }
    }
    const len = Math.hypot(sx, sy);
    let dx = 0;
    let dy = 0;
    if (len > 0.2) {
      // Rotate screen input by the camera spin so "up" is always "away from the camera",
      // then snap to 32 directions so we only send a message when it really changes.
      const c = Math.cos(this.cam.viewYaw);
      const s = Math.sin(this.cam.viewYaw);
      const mx = sx * c - sy * s;
      const my = sx * s + sy * c;
      const step = Math.PI / 16;
      const a = Math.round(Math.atan2(my, mx) / step) * step;
      dx = Math.round(Math.cos(a) * 1000) / 1000;
      dy = Math.round(Math.sin(a) * 1000) / 1000;
    }
    if (dx === this.lastAxis.dx && dy === this.lastAxis.dy) return;
    this.lastAxis = { dx, dy };
    const mover = this.local.mover;
    if (dx || dy) {
      this.cancelRoute();
      this.cancelTrip();
      this.cam.recenter();
      this.standUpLocally();
      mover.intent = { kind: "dir", dx, dy };
      this.room.send(Msg.MoveDir, { dx, dy } satisfies MoveDirPayload);
    } else if (mover.intent.kind === "dir") {
      mover.intent = IDLE;
      this.room.send(Msg.MoveDir, { dx: 0, dy: 0 } satisfies MoveDirPayload);
    }
  }

  /** Driving controls: W/S (or joystick up/down) throttle, A/D (or left/right) steering. */
  private handleDriving() {
    let t = -this.stick.dy;
    let s = this.stick.dx;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) t += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) t -= 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) s -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) s += 1;
    const q = (v: number) => Math.round(THREE.MathUtils.clamp(v, -1, 1) * 4) / 4; // 9 levels: few messages
    const input = { t: q(t), s: q(s) };
    if (input.t === this.driveInput.t && input.s === this.driveInput.s) return;
    this.driveInput = input;
    this.room.send(Msg.Drive, input);
  }

  // ===================================================================== GPS

  private sendNextWaypoint() {
    if (!this.local || !this.route.length) return;
    const wp = this.route[0];
    const target = { x: Math.round(wp.x), y: Math.round(wp.y) };
    this.local.mover.intent = { kind: "target", ...target };
    this.room.send(Msg.MoveTo, target satisfies MoveToPayload);
  }

  private updateRoute() {
    if (!this.local || !this.route.length) return;
    const m = this.local.mover;
    if (m.intent.kind !== "idle") return; // still walking toward the current waypoint
    const wp = this.route[0];
    if (Math.hypot(m.x - wp.x, m.y - wp.y) < 10) {
      this.route.shift();
      this.routeRetries = 0;
    } else if (++this.routeRetries > 2) {
      this.cancelRoute(); // something (another player? lag) keeps blocking us
      return;
    }
    if (!this.route.length) {
      // Arrived: clear the line and tell the UI (cancelRoute() is a no-op on an empty route).
      this.updateRouteVisual();
      this.onRouteChange?.(false);
      return;
    }
    this.sendNextWaypoint();
    this.updateRouteVisual();
  }

  private updateRouteVisual() {
    this.routeLine?.removeFromParent();
    this.routeLine?.geometry.dispose();
    this.routeLine = undefined;
    if (!this.route.length || !this.local) {
      this.destMarker.visible = false;
      return;
    }
    const pts = [{ x: this.local.mover.x, y: this.local.mover.y }, ...this.route].map(
      (p) => new THREE.Vector3(toWorld(p.x), 0.08, toWorld(p.y)),
    );
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.routeLine = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xfacc15, dashSize: 0.8, gapSize: 0.5 }));
    this.routeLine.computeLineDistances();
    this.scene.add(this.routeLine);
    const end = pts[pts.length - 1];
    this.destMarker.position.set(end.x, 0.07, end.z);
    this.destMarker.visible = true;
  }

  // ==================================================================== frame

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dtMs = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    const dt = dtMs / 1000;
    this.frameN++;

    this.handleKeyboard(dt);
    this.updateLocal(dtMs);
    this.updateRoute();
    this.updateRemotes(dt);
    this.updateVehicles(dt);
    this.updateSpace();
    this.updateCamera(dt);
    this.updateLighting();
    this.updateEffects(now);
    this.conditions.frame(dt, this.cam.focus, gameTime(Math.floor(this.clockMinutes())), this.local?.mover, this.insidePlace, () => [...this.entities.values()].map((e) => e.state.spot - 1));
    this.social.frame(this.cam.focus, this.clockMinutes(), this.insidePlace < 0);
    if (this.frameN % 6 === 0) {
      this.politics.frame(this.cam.focus, gameTime(Math.floor(this.clockMinutes())), this.insidePlace < 0);
      this.updatePrompt();
      this.updateTrip();
    }
    if (this.frameN % 30 === 0) this.updateStallNpcs();
    if (this.frameN % 15 === 0) {
      this.updateQueueNpcs();
      this.updateOrders();
    }
    if (this.deliveryNpc) {
      this.deliveryNpc.npc.char.update(dt, 0);
      if (now > this.deliveryNpc.until) {
        this.deliveryNpc.npc.char.dispose();
        this.deliveryNpc = undefined;
      }
    }

    for (const e of this.entities.values()) {
      const visible = !vehicleOf(e.state) && (e.isLocal || e.holder.position.distanceTo(this.cam.focus) < CULL_DISTANCE);
      e.holder.visible = visible;
      if (visible) e.char.update(dt, e.speed);
    }
    for (const n of this.stallNpcs.values()) if (n.char.root.visible) n.char.update(dt, 0);
    for (const n of this.interior?.npcs ?? []) n.char.update(dt, 0);
    this.venue?.update(dt);
    for (const list of this.queueNpcs.values()) for (const n of list) if (n?.char.root.visible) n.char.update(dt, 0);
    this.renderer.render(this.scene, this.camera);
  };

  private updateLocal(dtMs: number) {
    const l = this.local;
    if (!l) return;
    const m = l.mover;
    const st = l.entity.state;
    if (st.driving) {
      this.updateDriving(dtMs / 1000);
      if (this.car) {
        m.x = this.car.x;
        m.y = this.car.y;
      }
      m.intent = IDLE;
      this.moveEntity(l.entity, m.x, m.y, dtMs / 1000, m.dir, false);
      return;
    }
    this.car = undefined;
    if (st.ride || st.spot || st.queue) {
      // Seated / riding / queueing: the server places us; no prediction.
      m.intent = IDLE;
      m.x = l.server.x;
      m.y = l.server.y;
      if (st.ride) {
        const v = this.vehicles[st.ride - 1];
        if (v) {
          m.x = v.x;
          m.y = v.y;
        }
      }
      this.moveEntity(l.entity, m.x, m.y, dtMs / 1000, m.dir, false);
      return;
    }
    stepMovement(m, dtMs * conditionPace(st.status), st);
    this.stepAside(m, dtMs / 1000);

    const ex = l.server.x - m.x;
    const ey = l.server.y - m.y;
    const err = Math.hypot(ex, ey);
    if (err > SNAP_DISTANCE) {
      m.x = l.server.x;
      m.y = l.server.y;
    } else if (m.intent.kind === "idle" || err > MOVING_TOLERANCE) {
      const idle = m.intent.kind === "idle";
      const k = Math.min(1, dtMs / (idle ? 100 : 300));
      const nx = m.x + ex * k;
      const ny = m.y + ey * k;
      if (!isBlocked(nx, ny)) {
        m.x = nx;
        m.y = ny;
      } else if (!isBlocked(nx, m.y)) m.x = nx;
      else if (!isBlocked(m.x, ny)) m.y = ny;
      else if (idle) {
        m.x = l.server.x;
        m.y = l.server.y;
      }
    }
    // Turn only while the player is actually steering, never for reconciliation nudges.
    this.moveEntity(l.entity, m.x, m.y, dtMs / 1000, m.dir, m.intent.kind !== "idle");
  }

  private stepAside(m: Mover, dt: number) {
    if (this.insidePlace >= 0) return;
    for (const v of this.vehicles) {
      if (!v || v.state.active === false) continue;
      if (Math.abs(v.x - m.x) > SOLID_CHECK_PX || Math.abs(v.y - m.y) > SOLID_CHECK_PX) continue;
      const kind = LINES[v.state.line]?.kind ?? VEHICLE_KINDS[v.state.kind] ?? "shuttle";
      const to = pushOut(vehicleBody(kind, v.x, v.y, byteToAngle(v.state.rot), v.speed * PX_PER_METER), m, isBlocked, { maxStep: PUSH_SPEED * dt });
      if (!to) continue;
      m.x = to.x;
      m.y = to.y;
      return;
    }
  }

  /** Predict our own bus with the shared physics; ease toward the server's copy. */
  private updateDriving(dt: number) {
    const st = this.local!.entity.state;
    const v = this.vehicles[st.driving - 1];
    if (!v) return;
    const server = { x: v.state.x, y: v.state.y, angle: byteToAngle(v.state.rot) };
    if (!this.car) this.car = { x: server.x, y: server.y, angle: server.angle, v: 0 };
    const car = this.car;
    stepCar(car, this.driveInput, dt);
    const err = Math.hypot(server.x - car.x, server.y - car.y);
    if (err > 8 * PX_PER_METER) {
      car.x = server.x;
      car.y = server.y;
      car.angle = server.angle;
    } else if (err > 1.5 * PX_PER_METER) {
      const k = Math.min(1, dt * 2);
      car.x += (server.x - car.x) * k;
      car.y += (server.y - car.y) * k;
    }
    // Draw our bus where we predict it is.
    v.x = car.x;
    v.y = car.y;
    v.yaw = yawForVector(Math.cos(car.angle), Math.sin(car.angle));
    this.placeVehicle(v);
    // Chase camera: swing round behind the bus when it's moving.
    if (Math.abs(car.v) > 2 * PX_PER_METER) {
      const behind = Math.atan2(Math.cos(car.angle), -Math.sin(car.angle));
      this.cam.yaw += shortestAngle(behind - this.cam.yaw) * Math.min(1, dt * 1.5);
    }
  }

  private updateRemotes(dt: number) {
    const renderT = performance.now() - INTERPOLATION_DELAY_MS;
    for (const e of this.entities.values()) {
      if (e.isLocal) continue;
      const buf = e.buffer;
      while (buf.length >= 2 && buf[1].t <= renderT) buf.shift();
      const a = buf[0];
      const b = buf[1];
      if (b && a.t <= renderT) {
        const k = (renderT - a.t) / (b.t - a.t || 1);
        this.moveEntity(e, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, dt, b.dir);
      } else {
        this.moveEntity(e, a.x, a.y, dt, a.dir);
      }
    }
  }

  private updateVehicles(dt: number) {
    const now = performance.now();
    const mine = this.local?.entity.state.driving ? this.local.entity.state.driving - 1 : -1;
    for (const v of this.vehicles) {
      if (!v) continue;
      if (v.index === mine && this.car) continue; // predicted in updateDriving()
      const renderT = now - (v.state.line === TRAFFIC_LINE ? TRAFFIC_RENDER_DELAY_MS : INTERPOLATION_DELAY_MS);
      const buf = v.buffer;
      while (buf.length >= 2 && buf[1].t <= renderT) buf.shift();
      const a = buf[0];
      const b = buf[1];
      let x = a.x;
      let y = a.y;
      let rot = a.rot;
      if (b && a.t <= renderT) {
        const k = (renderT - a.t) / (b.t - a.t || 1);
        x = a.x + (b.x - a.x) * k;
        y = a.y + (b.y - a.y) * k;
        rot = b.rot;
      }
      if (dt > 0) v.speed += (toWorld(Math.hypot(x - v.x, y - v.y)) / dt - v.speed) * Math.min(1, dt * 6);
      v.x = x;
      v.y = y;
      // Ease the heading so corners look like steering, not snapping.
      v.yaw += shortestAngle(headingYaw(rot) - v.yaw) * Math.min(1, dt * 5);
      if (v.state.line === HAIL_LINE || v.state.line === TRAFFIC_LINE) setVehiclePassengers(v.mesh, v.state.riders);
      this.placeVehicle(v);
    }
  }

  private placeVehicle(v: VehicleEntity) {
    v.mesh.position.set(toWorld(v.x), 0, toWorld(v.y));
    v.mesh.rotation.y = v.yaw;
    v.mesh.visible = v.state.active !== false && this.insidePlace < 0 && v.mesh.position.distanceTo(this.cam.focus) < Math.max(VEHICLE_DISTANCE, this.cam.distance * VEHICLE_DISTANCE_RATIO);
  }

  /** Move an entity to (x, y) map px; derives speed + facing from the motion. */
  private moveEntity(e: Entity, x: number, y: number, dt: number, dir: number, steering?: boolean) {
    const dx = x - e.x;
    const dy = y - e.y;
    const dist = Math.hypot(dx, dy);
    const instSpeed = dt > 0 ? toWorld(dist) / dt : 0;
    e.speed += (instSpeed - e.speed) * Math.min(1, dt * 10); // smooth for animation blending
    if (e.state.queue && !e.state.spot) {
      e.speed = 0;
      const q = QUEUES[e.state.queue - 1];
      if (q) e.yaw += shortestAngle(yawForVector(Math.cos(q.face), Math.sin(q.face)) - e.yaw) * Math.min(1, dt * 10);
      e.x = x;
      e.y = y;
      this.placeEntity(e);
      return;
    }
    if (e.state.spot || vehicleOf(e.state)) {
      // Seated/riding: facing comes from the seat, never from motion.
      e.speed = 0;
      if (e.state.spot) {
        const spot = SPOTS[e.state.spot - 1];
        const lie = spot && ACT_POSE[spot.kind] === "lie";
        if (spot) e.yaw += shortestAngle(spotYaw(spot.face, lie) - e.yaw) * Math.min(1, dt * 12);
      }
    } else {
      // Face the direction of real walking. Remote players: anything faster than ~1 m/s.
      // Local player: only while steering (corrections after stopping must not spin them).
      const walking = (steering ?? true) && dist > 0.01 && instSpeed > 1.2;
      const targetYaw = walking ? yawForVector(dx, dy) : e.speed < 0.3 && !e.isLocal ? yawForDir(dir) : e.yaw;
      e.yaw += shortestAngle(targetYaw - e.yaw) * Math.min(1, dt * 12);
    }
    e.x = x;
    e.y = y;
    this.placeEntity(e);
  }

  private placeEntity(e: Entity) {
    e.holder.position.set(toWorld(e.x), floorHeightAt(e.x, e.y), toWorld(e.y));
    e.char.root.rotation.y = e.yaw;
  }

  // ============================================================ interiors

  /** Swap between the campus and a building interior when the local player crosses over. */
  private updateSpace() {
    if (!this.local) return;
    const it = interiorAt(this.local.mover.x, this.local.mover.y);
    const place = it ? it.place : -1;
    if (place !== this.insidePlace) {
      this.leaveInterior();
      this.insidePlace = place;
      if (it) this.enterInterior(it);
      else this.world.setVisible(true);
      this.cam.setLimits(it ? INDOOR_LIMITS : OUTDOOR_LIMITS);
      if (!it) {
        this.cam.apply({ ...this.outdoorCamera, yaw: openSideYaw(this.local.mover.x, this.local.mover.y) });
        this.outdoorCamera = undefined;
      }
      this.cam.recenter();
      this.camTarget.copy(this.local.entity.holder.position);
      this.cam.snap();
    }
    const st = this.local.entity.state;
    let w: Whereabouts = {};
    if (st.queue) {
      const q = QUEUES[st.queue - 1];
      const pos = q ? q.slots.findIndex((sl) => Math.hypot(sl.x - this.local!.mover.x, sl.y - this.local!.mover.y) < 10) + 1 : 0;
      const what = q?.kind === "stop" ? `${LINES[q.line!]?.name ?? "bus"}` : SPOTS[q?.spot ?? 0]?.label ?? "food";
      w = { ...(it ? { place: PLACES[it.place].name } : {}), queue: { what, position: Math.max(1, pos) } };
    } else if (it) w = { place: PLACES[it.place].name };
    else if (st.driving) {
      const v = this.vehicles[st.driving - 1];
      w = { driving: { passengers: v?.state.riders ?? 0 } };
    } else if (st.ride) {
      const v = this.vehicles[st.ride - 1];
      const line = v && LINES[v.state.line];
      if (line) w = { riding: { line: line.name, next: line.stops[v.state.next]?.name ?? "", atStop: v.state.stop !== NO_STOP } };
      else if (v) w = { riding: { line: "Student shuttle", next: "", atStop: v.speed < 0.8 } };
    }
    const key = JSON.stringify(w);
    if (key !== this.whereKey) {
      this.whereKey = key;
      this.onWhere?.(w);
    }
  }

  private enterInterior(it: Interior) {
    this.cancelRoute();
    this.world.setVisible(false);
    this.scene.background = new THREE.Color(0x1a1714);
    this.scene.fog = null;
    const built = buildInterior(it, this.shadows);
    this.scene.add(built.group);
    Character.groundAt = interiorGround;
    const npcs = it.template.npcs.map((n) => this.makeNpc(it.ox + n.x * PX_PER_METER, it.oy + n.y * PX_PER_METER, n.face, n.look));
    this.interior = { built, npcs };
    this.venue = createVenueLife(it, built.group, { minutes: () => this.clockMinutes(), taken: () => new Set([...this.entities.values()].map((e) => e.state.spot - 1)) });
    this.classScene.enter(it, this.scene);
    this.conditions.enterInterior(it, this.scene);
    this.outdoorCamera ??= this.cam.pose;
    // Look into the room from the open (south) side.
    this.cam.yaw = 0;
    this.cam.pitch = Math.max(this.cam.pitch, THREE.MathUtils.degToRad(50));
    this.cam.zoom = Math.min(this.cam.zoom, 13);
    for (const v of this.vehicles) if (v) v.mesh.visible = false;
  }

  private leaveInterior() {
    if (!this.interior) return;
    this.classScene.leave();
    this.conditions.leaveInterior();
    this.venue?.dispose();
    this.venue = undefined;
    Character.groundAt = undefined;
    this.interior.built.dispose();
    this.interior.npcs.forEach((n) => n.char.dispose());
    this.interior = undefined;
  }

  private makeNpc(x: number, y: number, face: number, look: string): Npc {
    const char = new Character(look);
    char.root.position.set(toWorld(x), 0, toWorld(y));
    char.root.rotation.y = spotYaw(face, false);
    this.scene.add(char.root);
    return { char, x, y };
  }

  /** Sellers at the outdoor food stalls: created when you get near, hidden when far. */
  private updateStallNpcs() {
    if (!this.local) return;
    const { x, y } = this.local.mover;
    const stallT = gameTime(Math.floor(this.clockMinutes()));
    STALLS.forEach((s, i) => {
      const d = Math.hypot(s.npc.x - x, s.npc.y - y) / PX_PER_METER;
      const open = d < NPC_DISTANCE && stallOpen(i, stallT);
      let npc = this.stallNpcs.get(i);
      if (npc && d > SELLER_DROP_DISTANCE) {
        npc.char.dispose();
        this.stallNpcs.delete(i);
        return;
      }
      if (!npc && open && this.insidePlace < 0) {
        npc = this.makeNpc(s.npc.x, s.npc.y, s.npc.face, s.npc.look);
        this.stallNpcs.set(i, npc);
      }
      if (npc) npc.char.root.visible = this.insidePlace < 0 && open;
    });
  }

  /** People waiting in nearby queues: show a character on every NPC slot. */
  private updateQueueNpcs() {
    if (!this.local) return;
    const { x, y } = this.local.mover;
    const insideNow = this.insidePlace >= 0;
    QUEUES.forEach((q, qi) => {
      const head = q.slots[0];
      const near = Math.hypot(head.x - x, head.y - y) / PX_PER_METER < 45;
      let list = this.queueNpcs.get(qi);
      if (!near) {
        if (list) for (const n of list) if (n?.char) n.char.root.visible = false;
        return;
      }
      const mask = (this.room.state.queues?.[qi] as QueueState | undefined)?.mask ?? 0;
      if (!mask && !list) return;
      if (!list) this.queueNpcs.set(qi, (list = []));
      q.slots.forEach((slot, i) => {
        const on = (mask >> i) & 1;
        let n = list![i];
        if (on && !n) {
          n = this.makeNpc(slot.x, slot.y, q.face, encodeLook(randomLook()));
          list![i] = n;
        }
        if (n) n.char.root.visible = !!on && (interiorAt(slot.x, slot.y) ? !!insideNow : !insideNow);
      });
    });
  }

  /** How many are in a queue (simulated + players). */
  private queueCount(qi: number): number {
    let mask = (this.room.state.queues?.[qi] as QueueState | undefined)?.mask ?? 0;
    let n = 0;
    while (mask) {
      n += mask & 1;
      mask >>= 1;
    }
    for (const e of this.entities.values()) if (e.state.queue === qi + 1) n++;
    return n;
  }

  /** Orders for the UI, plus the rider's GPS to the vendor / customer. */
  private updateOrders() {
    const l = this.local;
    if (!l) return;
    const me = this.room.sessionId;
    const orders = this.room.state.orders as Map<string, OrderState> | undefined;
    const view: OrdersView = { open: [], packs: l.entity.state.packs ?? 0, rider: !!l.entity.state.rider };
    const nameOf = (id: string) => this.room.state.players.get(id)?.name ?? "someone";
    orders?.forEach((o, id) => {
      const spot = SPOTS[o.spot];
      if (!spot) return;
      if (o.customer === me) {
        const status =
          o.status === ORDER.cooking ? "cooking" : o.status === ORDER.open ? "waiting" : o.status === ORDER.accepted ? "picking" : o.rider ? "coming" : "campus";
        view.mine = { label: spot.label, status, rider: o.rider ? nameOf(o.rider) : undefined };
      }
      if (view.rider && o.rider === me && (o.status === ORDER.accepted || o.status === ORDER.carrying)) {
        view.job = { id, label: spot.label, customer: nameOf(o.customer), stage: o.status === ORDER.accepted ? "pickup" : "deliver" };
      }
      if (view.rider && o.status === ORDER.open && o.customer !== me) {
        const cust = this.entities.get(o.customer);
        const meters = cust ? Math.round(Math.hypot(spot.sx - l.mover.x, spot.sy - l.mover.y) / PX_PER_METER + Math.hypot(cust.x - spot.sx, cust.y - spot.sy) / PX_PER_METER) : 0;
        view.open.push({ id, label: spot.label, customer: nameOf(o.customer), meters });
      }
    });
    view.open.sort((a, b) => a.meters - b.meters);
    // Rider GPS: head to the vendor, then keep re-routing to the (moving) customer.
    const job = view.job;
    const now = performance.now();
    if (job && !this.trip && !vehicleOf(l.entity.state) && now - this.jobRouteAt > (job.stage === "deliver" ? 8000 : 20000)) {
      const o = orders?.get(job.id);
      const cust = o ? this.entities.get(o.customer) : undefined;
      const target = job.stage === "pickup" ? (o ? { x: SPOTS[o.spot].sx, y: SPOTS[o.spot].sy } : undefined) : cust ? { x: cust.x, y: cust.y } : undefined;
      if (target && Math.hypot(target.x - l.mover.x, target.y - l.mover.y) > 3 * PX_PER_METER && l.mover.intent.kind === "idle") this.routeTo(target);
      this.jobRouteAt = now;
    }
    const key = JSON.stringify(view);
    if (key !== this.ordersKey) {
      this.ordersKey = key;
      this.onOrders?.(view);
    }
  }

  // ============================================================ trips

  private updateTrip() {
    const trip = this.trip;
    const l = this.local;
    if (!trip || !l) return;
    if ("hail" in trip) return this.updateHailTrip(trip);
    const line = LINES[trip.plan.line];
    const board = line.stops[trip.plan.board];
    const alight = line.stops[trip.plan.alight];
    const st = l.entity.state;
    const now = performance.now();
    const { x, y } = l.mover;
    const short = (n: string) => n.replace(/ Hall of Residence$/, " Hall");
    let text = "";

    if (trip.phase === "toStop") {
      text = `🚶 Walking to the ${short(board.name)} stop for the ${line.name}`;
      if (!this.route.length) {
        if (Math.hypot(board.kerb.x - x, board.kerb.y - y) < 8 * PX_PER_METER) {
          trip.phase = "waiting";
          trip.retries = 0;
        }
        else if (++trip.retries > 3) return this.failTrip("Couldn't find a way to the stop.");
        else this.routeTo(board.kerb);
      }
    }
    if (trip.phase === "waiting") {
      text = `🚏 Waiting for the ${line.name} at ${short(board.name)}`;
      if (st.ride) trip.phase = "riding";
      else if (!st.queue && now - trip.lastSend > 1500) {
        // Join the stop's queue; the bus boards it in order. No queue there? Board directly.
        const qi = queueOfStop.get(`${line.id}:${trip.plan.board}`);
        if (qi !== undefined) this.room.send(Msg.Queue, { queue: qi });
        else {
          const v = this.vehicles.find((v) => v && v.state.line === line.id && v.state.stop === trip.plan.board);
          if (v && Math.hypot(v.x - x, v.y - y) <= BOARD_DISTANCE) this.room.send(Msg.Board, { vehicle: v.index });
        }
        trip.lastSend = now;
        if (++trip.retries > 12) return this.failTrip("Couldn't join the queue (do you have money for the ticket?).");
      }
    }
    if (trip.phase === "riding") {
      text = `🚐 On the ${line.name} · getting off at ${short(alight.name)}`;
      if (!st.ride) {
        trip.phase = "final";
        trip.retries = 0;
        this.routeTo(trip.target);
      } else {
        const v = this.vehicles[st.ride - 1];
        if (v && v.state.stop === trip.plan.alight && now - trip.lastSend > 800) {
          this.room.send(Msg.Alight);
          trip.lastSend = now;
        }
      }
    }
    if (trip.phase === "final") {
      text = "🚶 Walking to your destination";
      if (!this.route.length) {
        const there = Math.hypot(trip.target.x - x, trip.target.y - y) < 6 * PX_PER_METER;
        if (there || ++trip.retries > 3) {
          this.cancelTrip();
          if (there) this.onNotice?.("You've arrived.");
          return;
        }
        this.routeTo(trip.target);
      }
    }
    if (text !== this.tripText) {
      this.tripText = text;
      this.onTrip?.(text);
    }
  }

  private failTrip(msg: string) {
    this.cancelTrip();
    this.onNotice?.(msg);
  }

  private onHailUpdate(update: HailUpdate) {
    const trip = this.trip && "hail" in this.trip ? this.trip : undefined;
    if (!trip) {
      if (update.phase === "coming" || update.phase === "waiting") this.room.send(Msg.HailCancel);
      return;
    }
    if (update.phase === "ended") {
      this.trip = undefined;
      this.tripText = "";
      this.onTrip?.(null);
      return;
    }
    trip.fare = update.fare;
    trip.retries = 0;
    if (update.phase === "coming" || update.phase === "waiting") {
      const first = trip.phase === "calling";
      trip.phase = update.phase;
      trip.pickup = update.pickup ?? trip.pickup;
      if (first && trip.pickup) this.routeTo(trip.pickup);
    } else if (update.phase === "riding") {
      trip.phase = "riding";
      trip.rode = true;
      this.cancelRoute();
    } else {
      trip.phase = "final";
      trip.lastSend = performance.now();
    }
    this.updateTrip();
  }

  private updateHailTrip(trip: HailTrip) {
    const l = this.local;
    if (!l) return;
    const st = l.entity.state;
    const now = performance.now();
    const { x, y } = l.mover;
    const ride = TRAVEL_MODE_LABEL[trip.hail];
    const icon = trip.hail === "okada" ? "🛵" : "🛺";
    const fare = trip.fare ? ` · ₦${trip.fare}` : "";
    let text = "";
    if (trip.phase === "calling") {
      text = `${icon} Calling ${trip.hail === "okada" ? "an okada" : "a keke"}`;
      if (now - trip.lastSend > HAIL_REPLY_MS) return this.failTrip(`No ${ride.toLowerCase()} answered. Try again.`);
    }
    if (trip.phase === "coming" || trip.phase === "waiting") {
      text = trip.phase === "coming" ? `${icon} ${ride} is coming${fare}` : `${icon} ${ride} is waiting by the road${fare}`;
      if (st.ride) {
        trip.phase = "riding";
        trip.rode = true;
      } else if (trip.pickup && !this.route.length && Math.hypot(trip.pickup.x - x, trip.pickup.y - y) > HAIL_PICKUP_REACH_PX && trip.retries < 3) {
        trip.retries++;
        this.routeTo(trip.pickup);
      }
    }
    if (trip.phase === "riding") {
      text = `${icon} On the ${ride.toLowerCase()}${fare}`;
      if (st.ride) trip.rode = true;
      else if (trip.rode) {
        trip.phase = "final";
        trip.lastSend = now;
      }
    }
    if (trip.phase === "final") {
      text = "🚶 Walking to your destination";
      if (!st.ride && !this.route.length && now - trip.lastSend > HAIL_SETTLE_MS) {
        const there = Math.hypot(trip.target.x - x, trip.target.y - y) < 6 * PX_PER_METER;
        if (there || ++trip.retries > 3) {
          this.cancelTrip();
          if (there) this.onNotice?.("You've arrived.");
          return;
        }
        this.routeTo(trip.target);
      }
    }
    if (text !== this.tripText) {
      this.tripText = text;
      this.onTrip?.(text);
    }
  }

  // ============================================================ prompts

  private updatePrompt() {
    const next = this.findPrompt();
    const prevId = this.prompt?.p.id;
    const prevDisabled = this.prompt?.p.disabled;
    this.prompt = next ?? undefined;
    if (next?.p.id !== prevId || next?.p.disabled !== prevDisabled) this.onPrompt?.(next ? next.p : null);
  }

  private findPrompt(): { p: Prompt; run?: () => void; alt?: () => void } | null {
    const l = this.local;
    if (!l) return null;
    const st = l.entity.state;
    const { x, y } = l.mover;

    if (st.driving) {
      const v = this.vehicles[st.driving - 1];
      const moving = !!this.car && Math.abs(this.car.v) > 1 * PX_PER_METER;
      return {
        p: { id: `endshift-${moving}-${v?.state.riders ?? 0}`, icon: "🅿️", label: moving ? "Stop to end shift" : "End shift", detail: `${v?.state.riders ?? 0} passenger(s) on board`, disabled: moving },
        run: () => this.room.send(Msg.StopDriving),
      };
    }

    if (st.ride && this.vehicles[st.ride - 1]?.state.line === 255) {
      const v = this.vehicles[st.ride - 1];
      const stopped = v.speed < 0.8;
      return {
        p: { id: `alight-student-${stopped}`, icon: "🛑", label: stopped ? "Get off here" : "Wait for the driver to stop", detail: "Fare ₦150", disabled: !stopped },
        run: () => this.room.send(Msg.Alight),
      };
    }

    if (st.ride) {
      const v = this.vehicles[st.ride - 1];
      if (!v) return null;
      if (v.state.line === HAIL_LINE) return { p: { id: "alight-hail", icon: "🛑", label: "Stop here" }, run: () => this.room.send(Msg.Alight) };
      const line = LINES[v.state.line];
      const at = v.state.stop !== NO_STOP;
      return {
        p: {
          id: `alight-${at}`,
          icon: "🛑",
          label: at ? `Get off at ${line?.stops[v.state.stop]?.name ?? "this stop"}` : "Get off at next stop",
          detail: at ? undefined : `Next: ${line?.stops[v.state.next]?.name ?? ""}`,
          disabled: !at,
        },
        run: () => this.room.send(Msg.Alight),
      };
    }

    if (st.queue) {
      return { p: { id: "leave-queue", icon: "🚶", label: "Leave queue" }, run: () => this.room.send(Msg.StopAct) };
    }

    if (st.spot && ACTS[st.act] === "exam") {
      return {
        p: { id: "exam", icon: "📝", label: "Submit exam", detail: "Writing… (submits when time is up)", alt: { icon: "🤫", label: "Copy neighbour" } },
        run: () => this.room.send(Msg.StopAct),
        alt: () => this.room.send(Msg.Cheat),
      };
    }

    if (st.spot) {
      const spot = SPOTS[st.spot - 1];
      if (!spot) return null;
      const busy = ACT_POSE[spot.kind] === "busy";
      const doing: Record<string, string> = { eat: "Eating…", atm: "Withdrawing…", play: "Stop playing" };
      const seatedAlt = this.politics.seatedAlt(spot.place, gameTime(Math.floor(this.clockMinutes())));
      return {
        p: { id: `stop-${st.spot}-${seatedAlt?.p.label ?? ""}`, icon: busy ? ACT_ICON[spot.kind] : "🧍", label: busy ? doing[spot.kind] ?? "Stop" : spot.kind === "dance" ? "Stop dancing" : "Stand up", disabled: spot.kind === "eat" || spot.kind === "atm", alt: seatedAlt?.p },
        run: () => this.room.send(Msg.StopAct),
        alt: seatedAlt?.run,
      };
    }

    let best: { d: number; p: Prompt; run: () => void } | null = null;
    let bestOff: { d: number; p: Prompt; run: () => void } | null = null;
    const consider = (d: number, p: Prompt, run: () => void) => {
      if (p.disabled && d > STATUS_PROMPT_BELOW) {
        if (!bestOff || d < bestOff.d) bestOff = { d, p, run };
      } else if (!best || d < best.d) best = { d, p, run };
    };

    // Delivery rider: pick up at the vendor, hand over to the customer.
    const orders = this.room.state.orders as Map<string, OrderState> | undefined;
    orders?.forEach((o, id) => {
      if (o.rider !== this.room.sessionId) return;
      const spot = SPOTS[o.spot];
      if (o.status === ORDER.accepted && spot) {
        const d = Math.hypot(spot.sx - x, spot.sy - y);
        if (d < USE_DISTANCE) consider(d - 100, { id: `pickup-${id}`, icon: "📦", label: `Pick up ${spot.label}` }, () => this.room.send(Msg.Pickup, { id }));
      }
      if (o.status === ORDER.carrying) {
        const c = this.entities.get(o.customer);
        if (!c) return;
        const d = Math.hypot(c.x - x, c.y - y);
        if (d < DELIVER_DISTANCE) consider(d - 100, { id: `deliver-${id}`, icon: "🛵", label: `Deliver to ${c.state.name}` }, () => this.room.send(Msg.Deliver, { id }));
      }
    });

    // Seats, counters, ATMs in this building (or the outdoor food stalls).
    const taken = new Set<number>();
    for (const e of this.entities.values()) if (!e.isLocal && e.state.spot) taken.add(e.state.spot - 1);
    const it = interiorAt(x, y);
    const candidates: number[] = [];
    if (it) for (let i = it.spotStart; i < it.spotEnd; i++) candidates.push(i);
    else for (const s of STALLS) candidates.push(s.spot);
    const nowT = gameTime(Math.floor(this.clockMinutes()));
    const examEv = activeEvents(nowT).find((e) => e.id === "exam");
    const examAt = examEv ? eventPlace(examEv) : -2;
    for (const i of candidates) {
      const s = SPOTS[i];
      const d = Math.hypot(s.sx - x, s.sy - y);
      if (d > USE_DISTANCE || (taken.has(i) && queueOfSpot.get(i) === undefined)) continue;
      if (!it && stallOfSpot(i) >= 0 && !stallOpen(stallOfSpot(i), nowT)) continue;
      const qi = queueOfSpot.get(i);
      const waiting = qi !== undefined ? this.queueCount(qi) : 0;
      const examNow = s.kind === "study" && examAt === s.place;
      const base = examNow ? `Write the ${paperName(nowT.weekday)}` : s.kind === "eat" ? `Buy ${s.label}` : s.kind === "play" ? `Play ${s.label.toLowerCase()}` : s.kind === "atm" ? "Withdraw allowance" : ACT_VERB[s.kind];
      const label = waiting ? `Join queue: ${s.label}` : base;
      const price = s.price ? `₦${s.price.toLocaleString("en-NG")}` : undefined;
      consider(d, { id: `use-${i}-${waiting}`, icon: waiting ? "🧍" : ACT_ICON[s.kind], label, detail: waiting ? `${price} · ${waiting} ahead` : price }, () => {
        this.cancelRoute();
        this.room.send(Msg.Use, { spot: i });
      });
    }
    for (const o of this.politics.prompts(x, y, it ? it.place : -1, nowT).map((o) => spotlight(o))) consider(o.d, o.p, o.run);
    for (const o of this.social.prompts(x, y, it ? it.place : -1, nowT, taken, (spot) => (this.cancelRoute(), this.room.send(Msg.Use, { spot })), (text) => this.onNotice?.(text)).map((o) => spotlight(o))) consider(o.d, o.p, o.run);
    for (const o of adminPrompts(this.adminLive, x, y, nowT, this.local?.entity.state.energy ?? 100, performance.now(), (action) => this.sendAdmin(action)).map((o) => spotlight(o))) consider(o.d, o.p, o.run);
    for (const o of this.conditions.prompts(x, y, it ? it.place : -1, nowT)) consider(o.d, o.p, o.run);

    if (!it) {
      const board = noticeBoardNear(x, y);
      if (board) consider(board.distance + BOARD_PROMPT_BIAS, { id: `board-${board.spot.id}`, icon: "📌", label: "Read notice board" }, () => this.onNotice?.(readNoticeBoard(board.spot, nowT)));
      // Building doors.
      PLACES.forEach((pl, i) => {
        if (!INTERIORS[i]) return;
        const d = Math.hypot(pl.door.x - x, pl.door.y - y);
        if (d < DOOR_PROMPT_DISTANCE) {
          const door = spotlightDoor({ d, p: { id: `enter-${i}`, icon: "🚪", label: `Enter ${pl.name}` }, run: () => {
            this.cancelRoute();
            this.room.send(Msg.Enter, { place: i });
          } }, i, nowT);
          consider(door.d, door.p, door.run);
        }
      });
      // Bus stop queues.
      QUEUES.forEach((q, qi) => {
        if (q.kind !== "stop") return;
        const n = this.queueCount(qi);
        const tail = q.slots[Math.min(n, q.slots.length - 1)];
        const d = Math.min(Math.hypot(q.slots[0].x - x, q.slots[0].y - y), Math.hypot(tail.x - x, tail.y - y));
        if (d > QUEUE_JOIN_DISTANCE) return;
        const line = LINES[q.line!];
        consider(d + 10, { id: `queue-${qi}-${n}`, icon: "🚏", label: `Join queue: ${line.name}`, detail: `From ₦${fareNow(lineFare(line.id, this.transport), nowT.total)} · ${n} waiting` }, () => {
          this.cancelRoute();
          this.room.send(Msg.Queue, { queue: qi });
        });
      });

      // The motor park: start a shuttle-driving shift.
      const dPark = Math.hypot(MOTOR_PARK.x - x, MOTOR_PARK.y - y);
      if (dPark < JOB_DISTANCE) {
        consider(dPark, { id: "startshift", icon: "🚐", label: "Start shift: shuttle driver", detail: "Get paid per passenger" }, () => {
          this.cancelRoute();
          this.cancelTrip();
          this.room.send(Msg.StartDriving);
        });
      }
      // Student-driven buses that have stopped.
      for (const v of this.vehicles) {
        if (!v || v.state.line !== 255 || !v.state.active || v.state.driver === this.room.sessionId || v.speed > 0.8) continue;
        const d = Math.hypot(v.x - x, v.y - y);
        if (d > BOARD_DISTANCE) continue;
        const driverName = this.room.state.players.get(v.state.driver)?.name ?? "a student";
        consider(d - 40, { id: `board-student-${v.index}`, icon: "🚐", label: `Enter ${driverName}'s shuttle`, detail: "Fare ₦150 when you get off" }, () => {
          this.cancelRoute();
          this.room.send(Msg.Board, { vehicle: v.index });
        });
      }
      // Vehicles waiting at a stop.
      for (const v of this.vehicles) {
        if (!v || v.state.stop === NO_STOP || v.state.line === 255) continue;
        const sq = queueOfStop.get(`${v.state.line}:${v.state.stop}`);
        if (sq !== undefined && this.queueCount(sq) > 0) continue; // there's a line: join it instead
        const d = Math.hypot(v.x - x, v.y - y);
        if (d > BOARD_DISTANCE) continue;
        const line = LINES[v.state.line];
        const spec = line ? VEHICLE_SPECS[line.kind] : undefined;
        const full = spec ? v.state.riders >= spec.seats : false;
        const nextStop = line?.stops[(v.state.stop + 1) % line.stops.length]?.name;
        consider(d - 40, { id: `board-${v.index}-${full}`, icon: line?.kind === "bus" ? "🚌" : "🚐", label: full ? "Full" : `Board ${line?.name ?? "bus"}`, detail: nextStop ? `Next: ${nextStop}` : undefined, disabled: full }, () => {
          this.cancelRoute();
          this.room.send(Msg.Board, { vehicle: v.index });
        });
      }
    }
    const found = (best ?? bestOff) as { d: number; p: Prompt; run: () => void } | null;
    // (alt actions only come from the exam prompt above)
    return found ? { p: found.p, run: found.run } : null;
  }

  // ============================================================ time of day

  /** Game minutes now (fractional), from the last server sync. */
  private clockMinutes() {
    return this.clockBase.minutes + (performance.now() - this.clockBase.at) / (1000 * REAL_SECONDS_PER_GAME_MINUTE) + this.debugClockOffset;
  }

  /** Sun, moon, sky and the HUD clock follow the campus clock. */
  private updateLighting() {
    if (!this.clockBase.minutes) return;
    const total = this.clockMinutes();
    const t = gameTime(Math.floor(total));
    const minuteOfDay = t.minute + (total % 1);
    const inside = this.insidePlace >= 0;
    const outdoorLight = daylight(minuteOfDay);
    const k = inside ? this.conditions.indoorLight() : outdoorLight;
    this.world.setDaylight(k);
    this.world.setGameTime(t);
    if (this.frameN % AMBIENCE_EVERY_FRAMES === 0) this.ambience.update({ daylight: outdoorLight, minuteOfDay, indoors: inside, traffic: this.trafficNearby(), generator: this.conditions.hum });
    // Sun travels east -> west from 6:00 to 18:00; at night a dim bluish moon.
    const sunT = (minuteOfDay / 60 - 6) / 12;
    const elev = Math.max(0.15, Math.sin(Math.PI * Math.min(1, Math.max(0, sunT))));
    const az = Math.PI * (1 - sunT);
    if (k > 0.02) SUN_OFFSET.set(Math.cos(az) * 70, 25 + elev * 50, 30);
    else SUN_OFFSET.set(-30, 60, -20);
    this.sun.intensity = 0.25 + 2.45 * k;
    this.sun.color.setRGB(0.7 + 0.3 * k, 0.75 + 0.19 * k, 0.95 - 0.11 * k);
    this.hemi.intensity = 0.45 + 1.1 * k;
    this.hemi.color.setRGB(0.55 + 0.37 * k, 0.62 + 0.34 * k, 0.85 + 0.15 * k);
    this.renderer.toneMappingExposure = 0.95 + 0.17 * k;

    if (inside) this.classScene.retake(this.entities.values());
    // HUD clock: once per game minute.
    const key = `${t.total}|${inside}`;
    if (key === this.clockKey) return;
    this.clockKey = key;
    const term = semesterView(t);
    const view: ClockView = { time: formatClock(t), term: `Campus week ${term.semester + 1} · ${term.phase.title}`, night: k < 0.3 };
    const lec = hudClassNow(this.student, t);
    const ev = activeEvents(t)[0];
    const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    if (ev) view.now = `${ev.title} till ${hhmm(ev.end)}`;
    else if (lec) view.now = `📚 ${lec.course.split(" ").slice(0, 2).join(" ")} at ${PLACES[lec.place].name} till ${hhmm(lec.end)}`;
    const upcoming = hudClassNext(this.student, t);
    const nextEv = EVENTS.find((e) => e.weekdays.includes(t.weekday) && e.start > t.minute);
    if (nextEv && (!upcoming || nextEv.start < upcoming.start)) view.next = `${nextEv.title} at ${hhmm(nextEv.start)}`;
    else if (upcoming) view.next = `📚 ${hhmm(upcoming.start)} ${upcoming.course.split(" ").slice(0, 2).join(" ")} · ${PLACES[upcoming.place].name}`;
    this.onClock?.(view);
    this.classScene.refresh(venueClass(this.insidePlace, this.student, t), [...this.entities.values()].map((e) => e.state.spot - 1), this.interior?.npcs[0]?.char.root);
  }

  private trafficNearby(): number {
    const l = this.local;
    if (!l || this.insidePlace >= 0) return 0;
    let sum = 0;
    for (const v of this.vehicles) {
      if (!v || v.state.active === false || v.speed < 1 || VEHICLE_KINDS[v.state.kind] === "bicycle") continue;
      const d = Math.hypot(v.x - l.mover.x, v.y - l.mover.y) / PX_PER_METER;
      if (d < TRAFFIC_EARSHOT) sum += 1 - d / TRAFFIC_EARSHOT;
    }
    return Math.min(1, sum / TRAFFIC_FULL_ROAR);
  }

  /** CGPA and exam prep, for the phone. */
  getAcademics() {
    const st = this.local?.entity.state;
    const cgpa = (st?.cgpa ?? 0) / 100;
    const now = Math.floor(this.clockMinutes());
    return {
      cgpa,
      exams: st?.exams ?? 0,
      lastGrade: st?.lastGrade ?? "",
      degree: st?.exams ? degreeClass(cgpa) : "No results yet",
      attended: st?.attended ?? 0,
      weekStudy: st?.weekStudy ?? 0,
      weekAttended: st?.weekAttended ?? 0,
      malpractice: st?.malpractice ?? 0,
      rusticatedFor: Math.max(0, (st?.rusticatedUntil ?? 0) - now),
    };
  }

  getGist() {
    const at = this.local ? { x: this.local.mover.x, y: this.local.mover.y } : undefined;
    return gistView({ department: this.student.department, level: this.student.level, book: this.student.book, at, place: this.insidePlace, status: this.politics.link.status }, gameTime(Math.floor(this.clockMinutes())));
  }

  getSemester() {
    return semesterView(gameTime(Math.floor(this.clockMinutes())));
  }

  getAdmin() {
    const at = this.local ? { x: this.local.mover.x, y: this.local.mover.y } : { x: 0, y: 0 };
    return adminView(this.adminLive, gameTime(Math.floor(this.clockMinutes())), at, this.local?.entity.state.energy ?? 100, performance.now());
  }

  sendAdmin(action: AdminAction) {
    this.room.send(Msg.Admin, action);
  }

  /** Today's timetable + this week's events, for the phone. */
  getTimetable() {
    return timetableView(this.student, gameTime(Math.floor(this.clockMinutes())));
  }

  // ============================================================ camera & effects

  private updateCamera(dt: number) {
    if (this.local) {
      const p = this.local.entity.holder.position;
      const st = this.local.entity.state;
      const v = vehicleOf(st) ? this.vehicles[vehicleOf(st) - 1] : undefined;
      this.camTarget.lerp(v ? v.mesh.position : p, Math.min(1, dt * (v ? 4 : 6)));
      if (v && this.cam.zoom < 16) this.cam.zoom += (16 - this.cam.zoom) * Math.min(1, dt * 2); // pull back to see the road
    }
    this.cam.update(dt, this.camTarget, this.camera);
    if (this.cam.free !== this.freeCamera) {
      this.freeCamera = this.cam.free;
      this.onFreeCamera?.(this.freeCamera);
    }
    this.updateViewRange();
    const t = this.cam.focus;
    // The shadow-casting sun follows the view so shadows are always sharp where you look.
    this.sun.position.copy(t).addScaledVector(SUN_OFFSET, this.shadowScale);
    this.sun.target.position.copy(t);
    if (this.frameN % CAMERA_SAVE_FRAMES === 0) this.rememberCamera();
  }

  private updateViewRange() {
    const d = this.cam.distance;
    const outdoors = this.insidePlace < 0;
    const far = outdoors ? this.world.setViewDistance(d) + VIEW_FAR_MARGIN : VIEW_FAR_BASE;
    const near = THREE.MathUtils.clamp(d * VIEW_NEAR_RATIO, VIEW_NEAR_MIN, VIEW_NEAR_MAX);
    if (far !== this.camera.far || near !== this.camera.near) {
      this.camera.far = far;
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    if (!this.shadows) return;
    const fade = outdoors ? 1 - THREE.MathUtils.smoothstep(d, SHADOW_FADE_FROM, SHADOW_FADE_TO) : 1;
    this.sun.shadow.intensity = fade;
    this.renderer.shadowMap.autoUpdate = fade > 0;
    const scale = outdoors ? THREE.MathUtils.clamp(Math.ceil(d / SHADOW_STEP), 1, SHADOW_MAX_SCALE) : 1;
    if (scale === this.shadowScale) return;
    this.shadowScale = scale;
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -SHADOW_HALF * scale;
    c.right = c.top = SHADOW_HALF * scale;
    c.far = SHADOW_FAR * scale;
    c.updateProjectionMatrix();
    this.sun.shadow.normalBias = SHADOW_NORMAL_BIAS * scale;
  }

  private rememberCamera = () => {
    if (!this.local || this.insidePlace >= 0 || vehicleOf(this.local.entity.state)) return;
    const pose = this.cam.pose;
    const last = this.savedCamera;
    if (last && Math.abs(last.yaw - pose.yaw) < CAMERA_SAVE_EPSILON && Math.abs(last.pitch - pose.pitch) < CAMERA_SAVE_EPSILON && Math.abs(last.zoom - pose.zoom) < CAMERA_SAVE_EPSILON) return;
    this.savedCamera = pose;
    saveCamera(pose);
  };

  private updateEffects(now: number) {
    // See-through cutout around the player + label culling.
    const st = this.local?.entity.state;
    const focus = st && vehicleOf(st) ? this.camTarget : this.local?.entity.holder.position ?? null;
    this.world.update(this.camera, focus, this.cam.focus, this.cam.distance);

    // Tap marker: shrink + fade over 600 ms.
    if (this.tapMarker.visible) {
      const k = (now - this.tapMarkerTime) / 600;
      if (k >= 1) this.tapMarker.visible = false;
      else {
        this.tapMarker.scale.setScalar(1 + k);
        (this.tapMarker.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      }
    }
    if (this.destMarker.visible) this.destMarker.scale.setScalar(1 + 0.12 * Math.sin(now / 200));
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait phones: widen the view a little so you can see around you.
    this.camera.fov = w < h ? 50 : 42;
    this.camera.updateProjectionMatrix();
  }
}

// ==================================================================== helpers

/** Vehicle index + 1 the player is in (as passenger or driver), 0 if on foot. */
function vehicleOf(st: PlayerState): number {
  return st.driving || st.ride || 0;
}

/** three.js yaw for a vehicle heading byte (map angle). */
function headingYaw(rot: number) {
  const a = byteToAngle(rot);
  return yawForVector(Math.cos(a), Math.sin(a));
}

/** three.js yaw for a seat's facing (map angle). Lying down: feet point the other way. */
function spotYaw(face: number, lie: boolean) {
  const a = lie ? face + Math.PI : face;
  return yawForVector(Math.cos(a), Math.sin(a));
}

/**
 * Camera yaw that puts the camera on the open side of the nearest building,
 * so a player spawning by a wall isn't hidden behind its roof.
 */
function openSideYaw(x: number, y: number): number {
  let best: { cx: number; cy: number; d: number } | null = null;
  for (const b of BUILDINGS) {
    const cx = b.bbox.x + b.bbox.w / 2;
    const cy = b.bbox.y + b.bbox.h / 2;
    const d = Math.hypot(cx - x, cy - y) - Math.max(b.bbox.w, b.bbox.h) / 2;
    if (!best || d < best.d) best = { cx, cy, d };
  }
  if (!best || best.d > 30 * PX_PER_METER) return 0;
  // Camera offset direction for yaw t is (-sin t, cos t); point it away from the building.
  const dx = x - best.cx;
  const dy = y - best.cy;
  return Math.atan2(-dx, dy);
}

function pushSnapshot(e: Entity, p: PlayerState) {
  const now = performance.now();
  const buf = e.buffer;
  const last = buf[buf.length - 1];
  if (last) {
    if (Math.hypot(p.x - last.x, p.y - last.y) > 200) buf.length = 0; // teleport
    else if (now - last.t > SERVER_TICK_MS * 2) buf.push({ ...last, t: now - SERVER_TICK_MS }); // resume from rest
  }
  buf.push({ t: now, x: p.x, y: p.y, dir: p.dir });
  if (buf.length > 30) buf.splice(0, buf.length - 30);
}

function emoteAnimation(id: number): AnimationName {
  return EMOTES[id] === "interact" ? "Interact" : "Wave";
}

function shortestAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function isTyping() {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
}

function preventDefault(e: Event) {
  e.preventDefault();
}

function makeBlobTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, "rgba(0,0,0,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
