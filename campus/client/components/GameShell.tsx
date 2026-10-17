"use client";

/**
 * Top-level game UI. Owns the flow: start screen -> character creator
 * (first visit) -> joining -> campus.
 *
 * React handles the DOM UI (start screen, creator, HUD, minimap, menus);
 * three.js only draws the world. Future UI (chat, needs bars) belongs here.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { EMOTES } from "@campuslife/shared/avatar";
import { vitalityMessage } from "@campuslife/shared";
import type { PoliticsPanel } from "@campus/game/politics";
import type { CampusView, ClockView, OrdersView, Prompt, Stats, TravelChoice, Whereabouts } from "@campus/game/CampusView";
import { DEFAULT_CONTROLS, DEFAULT_SOUND, loadControls, loadSound, saveControls, saveSound, type ControlSettings, type SoundSettings } from "@campus/lib/settings";
import { signOut } from "@campus/lib/api/auth";
import { clearResume, loadResume, saveResume } from "@campus/lib/resume";
import { MAP_CREDIT } from "@campus/lib/site";
import { AvatarCreator, LOOK_STORAGE_KEY, loadSavedLook } from "./AvatarCreator";
import { StartScreen, type EnterDetails } from "./StartScreen";
import type { ConnectionStatus } from "./GameCanvas";
import { Brand } from "./Brand";
import { ContextIcon, GameIcon, type GameIconName } from "./GameIcon";
import { GamePanel } from "./GamePanel";
import { TravelOptions } from "./TravelOptions";
import { GistChip } from "./gist/gist-chip";

// three.js + Colyseus SDK live in these chunks. ssr:false = never runs on the server.
const loadGameCanvas = () => import("./GameCanvas");
const GameCanvas = dynamic(loadGameCanvas, {
  ssr: false,
  loading: () => (
    <div className="overlay">
      <Brand compact />
      <p>Loading campus…</p>
      <span className="loading-track" aria-hidden="true" />
    </div>
  ),
});
const Minimap = dynamic(() => import("./Minimap"), { ssr: false });
const FullMap = dynamic(() => import("./FullMap"), { ssr: false });
const Joystick = dynamic(() => import("./Joystick"), { ssr: false });
const JobsSheet = dynamic(() => import("./JobsSheet"), { ssr: false });
const PhoneSheet = dynamic(() => import("./PhoneSheet"), { ssr: false });
const PoliticsSheet = dynamic(() => import("./politics/politics-sheet"), { ssr: false });
const SettingsSheet = dynamic(() => import("./SettingsSheet"), { ssr: false });

/** True on phones/tablets (coarse pointer), where we show the joystick. */
function useTouchDevice() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse), (max-width: 700px)");
    const sync = () => setTouch(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return touch;
}

type Phase = "start" | "creator" | "playing";

function hasSavedLook() {
  try {
    return !!localStorage.getItem(LOOK_STORAGE_KEY);
  } catch {
    return false;
  }
}

export function GameShell({ student }: { student?: EnterDetails & { look?: string } }) {
  const [phase, setPhase] = useState<Phase>("start");
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [level, setLevel] = useState("");
  const [department, setDepartment] = useState("");
  const [fresh, setFresh] = useState(false);
  const [look, setLook] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [online, setOnline] = useState(0);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<CampusView | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const [routeActive, setRouteActive] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [where, setWhere] = useState<Whereabouts>({});
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [trip, setTrip] = useState<string | null>(null);
  const [travel, setTravel] = useState<TravelChoice | null>(null);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [politicsPanel, setPoliticsPanel] = useState<PoliticsPanel | null>(null);
  const [orders, setOrders] = useState<OrdersView | null>(null);
  const [clock, setClock] = useState<ClockView | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controls, setControls] = useState<ControlSettings>(DEFAULT_CONTROLS);
  const [sound, setSound] = useState<SoundSettings>(DEFAULT_SOUND);
  const [freeCamera, setFreeCamera] = useState(false);
  const touch = useTouchDevice();
  const [gistOpen, setGistOpen] = useState(false);
  const [externalPhone, setExternalPhone] = useState(false);
  const panelOpen = externalPhone || settingsOpen || mapOpen || jobsOpen || phoneOpen || wardrobeOpen || gistOpen || !!politicsPanel;

  useEffect(() => {
    view?.setControls(panelOpen ? { ...controls, keyboard: false, tapToWalk: false } : controls);
  }, [view, controls, panelOpen]);

  useEffect(() => setControls(loadControls()), []);

  const changeControls = useCallback(
    (next: ControlSettings) => {
      setControls(next);
      saveControls(next);
      view?.setControls(next);
    },
    [view],
  );

  useEffect(() => {
    view?.setSound(sound);
  }, [view, sound]);

  useEffect(() => setSound(loadSound()), []);

  const changeSound = useCallback((next: SoundSettings) => {
    setSound(next);
    saveSound(next);
  }, []);

  // Warm the game chunk while the player types their name, unless Data Saver is on.
  useEffect(() => {
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) return;
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const id = ric(() => void loadGameCanvas());
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(id);
  }, []);

  // iOS Safari ignores user-scalable=no; block its pinch gesture explicitly.
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", block);
    return () => document.removeEventListener("gesturestart", block);
  }, []);

  useEffect(() => {
    if (!view) return;
    view.onRouteChange = setRouteActive;
    view.onPrompt = setPrompt;
    view.onStats = setStats;
    view.onWhere = setWhere;
    view.onNotice = (text) => setToast({ text, id: Date.now() });
    view.onTrip = setTrip;
    view.onTravelChoice = setTravel;
    view.onOrders = setOrders;
    view.onClock = setClock;
    view.onFreeCamera = setFreeCamera;
    view.politics.link.onPanel = setPoliticsPanel;
    view.resendUi();
    return () => {
      view.onRouteChange = view.onPrompt = view.onStats = view.onWhere = view.onNotice = view.onTrip = undefined;
      view.onOrders = undefined;
      view.onTravelChoice = undefined;
      view.onClock = undefined;
      view.onFreeCamera = undefined;
      view.politics.link.onPanel = undefined;
    };
  }, [view]);

  // Toasts fade after a few seconds.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const inside = !!where.place;

  const enter = useCallback((details: EnterDetails) => {
    setError(undefined);
    setName(details.name);
    setSchool(details.school);
    setLevel(details.level);
    setDepartment(details.department);
    setFresh(details.fresh);
    saveResume({ name: details.name, school: details.school, level: details.level, department: details.department });
    const saved = loadSavedLook();
    setLook(saved);
    if (hasSavedLook()) {
      setStatus("connecting");
      setPhase("playing");
    } else {
      setPhase("creator");
    }
  }, []);

  const leave = useCallback(() => {
    clearResume();
    setPhase("start");
  }, []);

  const leaveAccount = useCallback(() => {
    setSettingsOpen(false);
    void signOut().then(() => {
      clearResume();
      window.location.assign("/");
    }).catch(() => setToast({ text: "Could not sign out. Try again.", id: Date.now() }));
  }, [leave]);

  const fail = useCallback(
    (message: string) => {
      setError(message);
      leave();
    },
    [leave],
  );

  // A refresh mid-game goes straight back to campus instead of the start screen.
  useLayoutEffect(() => {
    if (student) {
      enter({ ...student, fresh: false });
      if (student.look) { setLook(student.look); setPhase("playing"); }
      return;
    }
    const saved = loadResume();
    if (saved && hasSavedLook()) enter({ ...saved, fresh: false });
  }, [enter, student]);

  useEffect(() => {
    const onPhone = (event: Event) => setExternalPhone(!!(event as CustomEvent).detail);
    window.addEventListener("oau:phone-state", onPhone);
    return () => window.removeEventListener("oau:phone-state", onPhone);
  }, []);

  if (phase === "start" && student) return <div className="app"><div className="overlay" role="alert"><p>{error || "Joining OAU campus…"}</p><a href="/home">Return home</a><button className="btn" onClick={() => enter({ ...student, fresh: false })}>Rejoin campus</button></div></div>;

  if (phase === "start") {
    return (
      <div className="app">
        <StartScreen onEnter={enter} error={error} />
      </div>
    );
  }

  if (phase === "creator") {
    return (
      <div className="app">
        <AvatarCreator
          initialLook={look}
          title="Create your student"
          confirmLabel="Enter campus"
          onConfirm={(l) => {
            setLook(l);
            setStatus("connecting");
            setPhase("playing");
          }}
          onCancel={leave}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <GameCanvas key={attempt} name={name} look={look} school={school} level={level} department={department} fresh={fresh && attempt === 0} onStatus={setStatus} onOnline={setOnline} onError={fail} onView={setView} />

      {status !== "connecting" && (
        <div className="campus-hud">
          <div className="player-badge">
            <Brand compact />
            <span><b>{name}</b><small>{level || "Student"}</small></span>
          </div>
          <span className="pill hud-presence" role="status">
            <span className="dot" />
            {online} {online === 1 ? "student" : "students"} online
          </span>
          {status === "reconnecting" && (
            <span className="pill">
              <span className="dot warn" />
              Reconnecting…
            </span>
          )}
          {stats && <Needs stats={stats} />}
          {view && <GistChip view={view} onOpenChange={setGistOpen} />}
          {where.place && <span className="pill where-pill"><GameIcon name="pin" />{where.place}</span>}
          {where.queue && (
            <span className="pill where-pill">
              <GameIcon name="person" />In queue for {where.queue.what} · #{where.queue.position}
            </span>
          )}
          {where.riding && (
            <span className="pill where-pill">
              <GameIcon name="bus" />{where.riding.line} · {where.riding.atStop ? "Stopped" : where.riding.next ? `Next: ${where.riding.next}` : "Moving"}
            </span>
          )}
          {where.driving && (
            <span className="pill where-pill">
              <GameIcon name="bus" />On shift · {where.driving.passengers} passenger{where.driving.passengers === 1 ? "" : "s"}
            </span>
          )}
          {view && trip && <button className="pill route-pill trip-pill" onClick={() => view.cancelTrip()}>{trip} · <u>Cancel</u></button>}
          {view && routeActive && !trip && <button className="pill route-pill" onClick={() => view.cancelRoute()}><GameIcon name="compass" />Walking to destination · Stop</button>}
        </div>
      )}

      {clock && status !== "connecting" && (
        <div className={clock.night ? "clock night" : "clock"} aria-label="Campus time">
          <b>
            <GameIcon name={clock.night ? "moon" : "sun"} />{clock.time}
          </b>
          <small className="clock-term">{clock.term}</small>
          {(clock.now ?? clock.next) && <small>{clock.now ? `Now: ${clock.now}` : `Next: ${clock.next}`}</small>}
        </div>
      )}

      {toast && (
        <div className="toast" key={toast.id} role="status">
          {toast.text}
        </div>
      )}

      {view && status !== "connecting" && (
        <>
          {!inside && <Minimap view={view} onOpen={() => setMapOpen(true)} />}
          {!inside && <span className="map-credit">{MAP_CREDIT}</span>}
          {touch && <Joystick view={view} />}
          <button className="settings-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            <GameIcon name="settings" />
          </button>
          {freeCamera && (
            <button className="pill camera-pill" onClick={() => view.recenterCamera()}>
              <GameIcon name="locate" />Back to me
            </button>
          )}

          {prompt && (
            <button
              className={touch ? "prompt-btn prompt-touch" : "prompt-btn"}
              disabled={prompt.disabled}
              onClick={() => view.usePrompt()}
            >
              <span aria-hidden className="prompt-icon">
                <ContextIcon symbol={prompt.icon} />
              </span>
              <span className="prompt-text">
                {prompt.label}
                {prompt.detail && <small>{prompt.detail}</small>}
              </span>
              {!touch && !prompt.disabled && <kbd>F</kbd>}
            </button>
          )}
          {prompt?.alt && (
            <button className={touch ? "prompt-alt prompt-alt-touch" : "prompt-alt"} onClick={() => view.usePromptAlt()}>
              <ContextIcon symbol={prompt.alt.icon} />{prompt.alt.label}
            </button>
          )}

          <nav className={touch ? "actionbar actionbar-touch" : "actionbar"} aria-label="Actions">
            <a className="action" href="/home"><GameIcon name="home" />Home</a>
            <button className="action" onClick={() => { window.dispatchEvent(new Event("oau:phone")); }}><GameIcon name="phone" />OAU apps</button>
            <button className="action" onClick={() => view.emote(EMOTES.indexOf("wave"))}>
              <GameIcon name="wave" />
              Wave
            </button>
            <button className="action" onClick={() => setWardrobeOpen(true)}>
              <GameIcon name="shirt" />
              Wardrobe
            </button>
            <button className="action" onClick={() => setJobsOpen(true)}>
              <GameIcon name="work" />
              Hustle
            </button>
            <button className="action" onClick={() => setPhoneOpen(true)}>
              <GameIcon name="phone" />
              Phone{orders?.packs ? ` (${orders.packs})` : ""}
            </button>
            {inside ? (
              <button className="action" onClick={() => view.exitBuilding()}>
                <GameIcon name="door" />
                Exit
              </button>
            ) : (
              <button className="action" onClick={() => setMapOpen(true)}>
                <GameIcon name="map" />
                Map
              </button>
            )}
          </nav>
          {!touch && controls.keyboard && <div className="controls-hint"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Walk</span><span>Drag to look</span></div>}
        </>
      )}

      {settingsOpen && <SettingsSheet controls={controls} sound={sound} touch={touch} handle={name} onChange={changeControls} onSoundChange={changeSound} onSignOut={leaveAccount} onClose={() => setSettingsOpen(false)} />}
      {mapOpen && view && <FullMap view={view} onClose={() => setMapOpen(false)} />}
      {jobsOpen && view && <JobsSheet view={view} stats={stats} background={stats?.background ?? ""} rider={!!orders?.rider} onClose={() => setJobsOpen(false)} />}
      {travel && view && (
        <TravelOptions
          destination={travel.name}
          cash={travel.cash}
          options={travel.options}
          onPick={(option) => {
            view.travelBy(travel.target, option);
            setTravel(null);
          }}
          onBack={() => setTravel(null)}
        />
      )}
      {politicsPanel && view && <PoliticsSheet view={view} panel={politicsPanel} onClose={() => setPoliticsPanel(null)} />}
      {phoneOpen && view && <PhoneSheet view={view} orders={orders} onClose={() => setPhoneOpen(false)} />}

      {view && orders?.rider && !orders.job && orders.open.length > 0 && (
        <div className="rider-board" aria-label="Open delivery orders">
          <b><GameIcon name="rider" />Orders</b>
          {orders.open.slice(0, 3).map((o) => (
            <button key={o.id} className="rider-order" onClick={() => view.acceptOrder(o.id)}>
              <span>
                {o.label} → {o.customer}
                <small>{o.meters} m · tap to accept</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {orders?.job && (
        <span className="pill rider-job">
          <GameIcon name="rider" />{orders.job.stage === "pickup" ? `Pick up ${orders.job.label}` : `Deliver to ${orders.job.customer}`}
        </span>
      )}

      {wardrobeOpen && view && (
        <GamePanel className="sheet wardrobe-sheet" label="Wardrobe" onClose={() => setWardrobeOpen(false)}>
          <AvatarCreator
            initialLook={look}
            title="Wardrobe"
            confirmLabel="Save look"
            onConfirm={(l) => {
              setLook(l);
              view.setLook(l);
              setWardrobeOpen(false);
            }}
            onCancel={() => setWardrobeOpen(false)}
          />
        </GamePanel>
      )}

      {status === "connecting" && (
        <div className="overlay">
          <Brand compact />
          <p>Joining campus…</p>
          <span className="loading-track" aria-hidden="true" />
        </div>
      )}

      {status === "disconnected" && (
        <div className="overlay">
          <GameIcon name="warning" className="overlay-icon" />
          <p>You were disconnected from campus.</p>
          <button
            className="btn"
            onClick={() => {
              setStatus("connecting");
              setAttempt((a) => a + 1);
            }}
          >
            Rejoin
          </button>
          <button className="btn btn-ghost" onClick={leave}>
            Back to start
          </button>
        </div>
      )}
    </div>
  );
}

/** Food / energy / fun bars plus cash and study points (top-left). */
function Needs({ stats }: { stats: Stats }) {
  const bars: [GameIconName, string, number][] = [
    ["food", "Food", stats.food],
    ["energy", "Energy", stats.energy],
    ["fun", "Fun", stats.fun],
  ];
  return (
    <div className="needs" aria-label="Your needs">
      {bars.map(([icon, label, v]) => (
        <div className={`need need-${icon}`} key={label} title={`${label} ${Math.round(v)}%`}>
          <GameIcon name={icon} />
          <span className="need-label">{label}</span>
          <span className="need-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
            <span className={v < 25 ? "need-fill low" : "need-fill"} style={{ width: `${Math.min(100, Math.max(0, v))}%` }} />
          </span>
          <small className="need-value">{Math.round(v)}</small>
        </div>
      ))}
      <div className="need-money">
        <span><GameIcon name="wallet" />₦{stats.cash.toLocaleString("en-NG")}</span>
        <span title="Study points"><GameIcon name="book" />{stats.study}</span>
      </div>
      {stats.debt > 0 && <div className="need-debt">Loan: ₦{stats.debt.toLocaleString("en-NG")}</div>}
      {vitalityMessage(stats) && <div className="need-weak" role="status">{vitalityMessage(stats)}</div>}
    </div>
  );
}
