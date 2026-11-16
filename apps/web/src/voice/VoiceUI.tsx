import { cx, Icon } from "@agenteschat/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { VideoTrack } from "livekit-client";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { PersonAvatar } from "@/components/AgentAvatar";
import {
  allowAudio,
  clearVoiceError,
  joinVoice,
  leaveVoice,
  subscribeVoice,
  toggleCamera,
  toggleDeafen,
  toggleMic,
  type VoiceMember,
  voiceSnapshot,
} from "./call";
import { DeviceMenu, ScreenShareMenu, VoiceSettingsDialog } from "./VoiceSettings";
import { showVoiceView } from "./views";
import "./voice.css";

/*
 * VPS Zen: voice channels, drawn like Discord's. Under a channel in the sidebar, who is in its voice room (with the
 * one talking ringed in green and a red AO VIVO on a screen share); at the sidebar's foot, the "Voz conectada" panel
 * with the microphone, deafen, camera, screen and leave; on the channel's page, the call itself: tiles, a shared
 * screen in focus, fullscreen.
 */

export const useVoiceCall = () => useSyncExternalStore(subscribeVoice, voiceSnapshot, voiceSnapshot);

export interface RoomPerson {
  userId: string;
  name: string;
  muted: boolean;
  camera: boolean;
  screen: boolean;
  speaking?: boolean;
}
interface RoomsAnswer {
  enabled: boolean;
  rooms: { channelId: string; participants: RoomPerson[] }[];
  /** Channels made for voice only (a room first, the chat beside it). */
  voiceChannels?: string[];
}

export const roomsKey = (orgId: string) => ["vps-zen", "voice-rooms", orgId];

/** Who is in each voice room of my channels: read every 5 s (3 s while I'm in a call), only while the tab shows. */
export function useVoiceRooms(orgId: string) {
  const call = useVoiceCall();
  const q = useQuery({
    queryKey: roomsKey(orgId),
    queryFn: async (): Promise<RoomsAnswer> => {
      const res = await fetch(`/api/app/organizations/${orgId}/voice-rooms`, { credentials: "same-origin" });
      if (!res.ok) return { enabled: false, rooms: [], voiceChannels: [] };
      return res.json();
    },
    refetchInterval: call.status === "connected" ? 3000 : 5000,
    staleTime: 2000,
  });
  const byChannel = new Map<string, RoomPerson[]>();
  for (const r of q.data?.rooms ?? []) byChannel.set(r.channelId, r.participants);
  // The room I'm in, live from the call itself: who talks now, without waiting for the next read.
  if (call.orgId === orgId && call.channelId && call.status !== "idle" && call.status !== "connecting")
    byChannel.set(
      call.channelId,
      call.members.map((m) => ({
        userId: m.userId ?? m.sid,
        name: m.name,
        muted: !m.micOn,
        camera: Boolean(m.camera),
        screen: Boolean(m.screen),
        speaking: m.speaking,
      })),
    );
  return { enabled: q.data?.enabled ?? false, byChannel, voiceChannels: new Set(q.data?.voiceChannels ?? []) };
}

/** After a join or a leave, the sidebar reads again at once. */
function useRefreshRooms(orgId: string) {
  const qc = useQueryClient();
  const call = useVoiceCall();
  const last = useRef(call.channelId);
  useEffect(() => {
    if (last.current === call.channelId && call.status !== "connected") return;
    last.current = call.channelId;
    const t = setTimeout(() => void qc.invalidateQueries({ queryKey: roomsKey(orgId) }), 600);
    return () => clearTimeout(t);
  }, [call.channelId, call.status, orgId, qc]);
}

// ── Icons: drawn on the design system's 20×20 grid, 1.5 strokes, round ends ──
const paths: Record<string, ReactNode> = {
  headset: (
    <>
      <path d="M3.5 12.5v-2a6.5 6.5 0 0 1 13 0v2" />
      <rect x="3" y="11.5" width="3.5" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="3.5" height="5" rx="1.5" />
    </>
  ),
  headsetOff: (
    <>
      <path d="M3.5 12.5v-2a6.5 6.5 0 0 1 11.2-4.5M16.5 10.5v2" />
      <rect x="3" y="11.5" width="3.5" height="5" rx="1.5" />
      <path d="M13.5 15v-2M3 17 17 3" />
    </>
  ),
  mic: (
    <>
      <rect x="7.5" y="2.5" width="5" height="9.5" rx="2.5" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
    </>
  ),
  micOff: (
    <>
      <path d="M12.5 8V5a2.5 2.5 0 0 0-5 0v4.5a2.5 2.5 0 0 0 3.8 2.1M4.5 9.5a5.5 5.5 0 0 0 8.6 4.5M15.5 9.5c0 .7-.1 1.4-.4 2M10 15v2.5" />
      <path d="M3 3l14 14" />
    </>
  ),
  camera: (
    <>
      <rect x="2.5" y="5.5" width="10.5" height="9" rx="2" />
      <path d="m13 9 4.5-2.5v7L13 11" />
    </>
  ),
  cameraOff: (
    <>
      <path d="M13 11.5v1a2 2 0 0 1-2 2H4.5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2H7m3 0h1a2 2 0 0 1 2 2V9l4.5-2.5v7" />
      <path d="M3 3l14 14" />
    </>
  ),
  screen: (
    <>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M7 17h6M10 13.5V17M10 11V6.5M8 8.5l2-2 2 2" />
    </>
  ),
  screenOff: (
    <>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M7 17h6M10 13.5V17M8 6.5l4 4M12 6.5l-4 4" />
    </>
  ),
  leave: <path d="M3 11.2c3.9-3.6 10.1-3.6 14 0l-1.7 2.3-2.8-1.2V10a8.7 8.7 0 0 0-5 0v2.3l-2.8 1.2z" />,
  speaker: (
    <>
      <path d="M3.5 8h2.5l4-3.5v11L6 12H3.5z" />
      <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15 5.5a6.5 6.5 0 0 1 0 9" />
    </>
  ),
  expand: <path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4" />,
  shrink: <path d="M7.5 3.5v4h-4M16.5 7.5h-4v-4M12.5 16.5v-4h4M3.5 12.5h4v4" />,
  gear: (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
    </>
  ),
  room: (
    <>
      <path d="M3.5 8h2.5l4-3.5v11L6 12H3.5z" />
      <path d="M13 7.5a3.5 3.5 0 0 1 0 5" />
    </>
  ),
  chat: <path d="M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-3.5 3v-3H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />,
};

export function VoiceIcon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="voice-icon"
    >
      {paths[name]}
    </svg>
  );
}

function VideoView({ track, mirror, contain }: { track: VideoTrack; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      className={cx("voice-video", mirror && "voice-video--mirror", contain && "voice-video--contain")}
      autoPlay
      playsInline
      muted
    />
  );
}

// ── Sidebar: who is in a channel's voice room, under its row ──

export function SidebarVoiceMembers({ people }: { people: RoomPerson[] }) {
  const { t } = useTranslation();
  if (people.length === 0) return null;
  return (
    <ul className="voice-side" aria-label={t("voiceRooms.inVoice", { count: people.length })}>
      {people.map((p) => (
        <li key={p.userId} className="voice-side__person" data-speaking={p.speaking || undefined}>
          <span className="voice-side__face">
            <PersonAvatar id={p.userId} name={p.name} size="xs" />
          </span>
          <span className="voice-side__name">{p.name}</span>
          <span className="voice-side__marks">
            {p.screen && <span className="voice-live">{t("voiceRooms.live")}</span>}
            {p.camera && <VoiceIcon name="camera" size={14} />}
            {p.muted && <VoiceIcon name="micOff" size={14} />}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── Sidebar foot: "Voz conectada" ──

export function VoiceDock({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const call = useVoiceCall();
  useRefreshRooms(orgId);
  if (call.error && call.status === "idle")
    return (
      <div className="voice-dock voice-dock--error" role="alert">
        <span>{t(`voiceRooms.errors.${call.error}`)}</span>
        <button type="button" className="voice-dock__x" aria-label={t("voiceRooms.dismiss")} onClick={clearVoiceError}>
          <Icon name="close" size={14} />
        </button>
      </div>
    );
  if (call.status === "idle" || call.orgId !== orgId || !call.channelId) return null;
  const live = call.status === "connected";
  return (
    <section className="voice-dock" aria-label={t("voiceRooms.connected")}>
      <div className="voice-dock__head">
        <div className="voice-dock__where">
          <span className="voice-dock__state" data-state={call.status}>
            <VoiceIcon name="speaker" size={16} />
            {live
              ? t("voiceRooms.connected")
              : call.status === "reconnecting"
                ? t("voiceRooms.reconnecting")
                : t("voiceRooms.connecting")}
          </span>
          <Link
            to="/org/$orgId/c/$channelId"
            params={{ orgId, channelId: call.channelId }}
            className="voice-dock__channel"
            title={`#${call.channelName}`}
          >
            #{call.channelName}
          </Link>
        </div>
        <DockButton label={t("voiceRooms.leave")} icon="leave" danger onClick={() => void leaveVoice()} />
      </div>
      {call.error && (
        <button type="button" className="voice-dock__note" onClick={clearVoiceError}>
          {t(`voiceRooms.errors.${call.error}`)}
        </button>
      )}
      {call.audioBlocked && live && (
        <button type="button" className="voice-dock__note voice-dock__note--act" onClick={() => void allowAudio()}>
          {t("voiceRooms.allowAudio")}
        </button>
      )}
      {call.talking && <span className="voice-dock__ptt">{t("voiceRooms.settings.talking")}</span>}
      <CallControls live={live} />
    </section>
  );
}

const canShareScreen = () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);

/**
 * The call's buttons, in the dock and on the stage: the microphone and the headset each with ⌃ for its device and
 * volume, the camera, the screen (its quality first) and the gear for the rest of Voz e vídeo.
 */
function CallControls({ live, big }: { live: boolean; big?: boolean }) {
  const { t } = useTranslation();
  const call = useVoiceCall();
  const [settings, setSettings] = useState(false);
  const open = () => setSettings(true);
  return (
    <div className={cx("voice-dock__acts", big && "voice-controls--big")}>
      <span className="voice-split">
        <DockButton
          big={big}
          label={call.micOn ? t("voiceRooms.mute") : t("voiceRooms.unmute")}
          icon={call.micOn ? "mic" : "micOff"}
          off={!call.micOn}
          disabled={!live}
          onClick={() => void toggleMic()}
        />
        <DeviceMenu kind="input" onSettings={open} big={big} />
      </span>
      <span className="voice-split">
        <DockButton
          big={big}
          label={call.deafened ? t("voiceRooms.undeafen") : t("voiceRooms.deafen")}
          icon={call.deafened ? "headsetOff" : "headset"}
          off={call.deafened}
          disabled={!live}
          onClick={() => void toggleDeafen()}
        />
        <DeviceMenu kind="output" onSettings={open} big={big} />
      </span>
      <DockButton
        big={big}
        label={call.cameraOn ? t("voiceRooms.cameraOff") : t("voiceRooms.cameraOn")}
        icon={call.cameraOn ? "camera" : "cameraOff"}
        on={call.cameraOn}
        disabled={!live}
        onClick={() => void toggleCamera()}
      />
      <ScreenShareMenu
        sharing={call.screenOn}
        disabled={!live || !canShareScreen()}
        trigger={({ label, disabled }) => (
          <button
            type="button"
            className={cx("voice-btn", big && "voice-btn--big")}
            data-on={call.screenOn || undefined}
            aria-label={label}
            title={label}
            disabled={disabled}
          >
            <VoiceIcon name="screen" size={big ? 22 : 18} />
          </button>
        )}
      />
      <DockButton big={big} label={t("voiceRooms.settings.open")} icon="gear" onClick={open} />
      <VoiceSettingsDialog open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}

function DockButton({
  label,
  icon,
  onClick,
  danger,
  off,
  on,
  disabled,
  big,
}: {
  label: string;
  icon: keyof typeof paths;
  onClick: () => void;
  danger?: boolean;
  off?: boolean;
  on?: boolean;
  disabled?: boolean;
  big?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx("voice-btn", big && "voice-btn--big")}
      data-danger={danger || undefined}
      data-off={off || undefined}
      data-on={on || undefined}
      aria-label={label}
      aria-pressed={on || off ? true : undefined}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <VoiceIcon name={icon} size={big ? 22 : 18} />
    </button>
  );
}

// ── The channel's header: join or leave its voice ──

export function VoiceHeaderButton({
  orgId,
  channelId,
  channelName,
}: {
  orgId: string;
  channelId: string;
  channelName: string;
}) {
  const { t } = useTranslation();
  const call = useVoiceCall();
  const { enabled, byChannel, voiceChannels } = useVoiceRooms(orgId);
  if (!enabled) return null;
  // A voice-only channel's chat: the way back to its room.
  if (voiceChannels.has(channelId))
    return (
      <button
        type="button"
        className="ac-btn ac-btn--ghost ac-btn--icon channel__icon voice-head"
        aria-label={t("voiceRooms.room.backToRoom")}
        title={t("voiceRooms.room.backToRoom")}
        onClick={() => showVoiceView(channelId, "room")}
      >
        <VoiceIcon name="room" />
      </button>
    );
  const here = call.channelId === channelId && call.status !== "idle";
  const count = byChannel.get(channelId)?.length ?? 0;
  const label = here ? t("voiceRooms.leave") : t("voiceRooms.join");
  return (
    <button
      type="button"
      className="ac-btn ac-btn--ghost ac-btn--icon channel__icon voice-head"
      data-here={here || undefined}
      aria-label={label}
      title={count > 0 && !here ? `${label} · ${t("voiceRooms.inVoice", { count })}` : label}
      onClick={() => void (here ? leaveVoice() : joinVoice(orgId, channelId, channelName))}
    >
      <VoiceIcon name={here ? "leave" : "headset"} />
      {count > 0 && !here && <span className="voice-head__count">{count}</span>}
    </button>
  );
}

// ── The call on the channel's page ──

interface Tile {
  key: string;
  member: VoiceMember;
  kind: "person" | "screen";
}

export function VoiceStage({
  orgId,
  channelId,
  channelName,
  room,
}: {
  orgId: string;
  channelId: string;
  channelName: string;
  /** A voice-only channel's page: the stage fills it, no chat under it to grow over. */
  room?: boolean;
}) {
  const { t } = useTranslation();
  const call = useVoiceCall();
  const { enabled, byChannel } = useVoiceRooms(orgId);
  const [focus, setFocus] = useState<string | null>(null);
  const [tall, setTall] = useState(false);
  const stage = useRef<HTMLElement>(null);
  const here = call.channelId === channelId && call.orgId === orgId && call.status !== "idle";
  if (!enabled) return null;
  if (!here) {
    const people = byChannel.get(channelId) ?? [];
    if (people.length === 0) return null;
    return (
      <div className="voice-invite">
        <span className="voice-invite__faces">
          {people.slice(0, 5).map((p) => (
            <span key={p.userId} className="voice-invite__face" data-speaking={p.speaking || undefined}>
              <PersonAvatar id={p.userId} name={p.name} size="sm" />
            </span>
          ))}
        </span>
        <span className="voice-invite__text">
          {people.some((p) => p.screen) && (
            <strong>{t("voiceRooms.sharingNow", { name: people.find((p) => p.screen)?.name })}</strong>
          )}
          <span>{t("voiceRooms.inVoice", { count: people.length })}</span>
        </span>
        <button
          type="button"
          className="voice-invite__join"
          onClick={() => void joinVoice(orgId, channelId, channelName)}
        >
          <VoiceIcon name="headset" size={18} />
          {t("voiceRooms.joinNow")}
        </button>
      </div>
    );
  }

  const tiles: Tile[] = [
    ...call.members
      .filter((m) => m.screen)
      .map((m) => ({ key: `${m.sid}:screen`, member: m, kind: "screen" as const })),
    ...call.members.map((m) => ({ key: `${m.sid}:person`, member: m, kind: "person" as const })),
  ];
  // A shared screen takes the stage by itself, as Discord's; a click on any tile puts it there instead.
  const focused = tiles.find((x) => x.key === focus) ?? tiles.find((x) => x.kind === "screen") ?? null;
  const rest = focused ? tiles.filter((x) => x !== focused) : tiles;
  const fullscreen = () => {
    const el = stage.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };
  const live = call.status === "connected";

  return (
    <section
      ref={stage}
      className={cx("voice-stage", room && "voice-stage--room")}
      data-tall={tall || undefined}
      aria-label={t("voiceRooms.callIn", { name: channelName })}
    >
      <div className="voice-stage__top">
        <span className="voice-stage__title">
          <VoiceIcon name="speaker" size={16} />
          {channelName}
          {call.status !== "connected" && (
            <span className="voice-stage__state">
              {call.status === "reconnecting" ? t("voiceRooms.reconnecting") : t("voiceRooms.connecting")}
            </span>
          )}
        </span>
        <span className="voice-stage__tools">
          {!room && (
            <button
              type="button"
              className="voice-stage__tool"
              title={tall ? t("voiceRooms.showChat") : t("voiceRooms.expand")}
              aria-label={tall ? t("voiceRooms.showChat") : t("voiceRooms.expand")}
              onClick={() => setTall((v) => !v)}
            >
              <VoiceIcon name={tall ? "chat" : "expand"} size={16} />
            </button>
          )}
          <button
            type="button"
            className="voice-stage__tool"
            title={t("voiceRooms.fullscreen")}
            aria-label={t("voiceRooms.fullscreen")}
            onClick={fullscreen}
          >
            <VoiceIcon name="expand" size={16} />
          </button>
        </span>
      </div>
      <div className={cx("voice-stage__tiles", focused && "voice-stage__tiles--focus")} data-count={rest.length}>
        {focused && (
          <TileView
            tile={focused}
            focused
            you={t("voiceRooms.you")}
            sharing={t("voiceRooms.sharing")}
            onClick={() => setFocus(null)}
          />
        )}
        <div className="voice-stage__grid" data-count={Math.min(rest.length, 9)}>
          {rest.map((tile) => (
            <TileView
              key={tile.key}
              tile={tile}
              you={t("voiceRooms.you")}
              sharing={t("voiceRooms.sharing")}
              onClick={() => setFocus(tile.key)}
            />
          ))}
        </div>
      </div>
      {call.audioBlocked && live && (
        <button type="button" className="voice-stage__note" onClick={() => void allowAudio()}>
          {t("voiceRooms.allowAudio")}
        </button>
      )}
      <div className="voice-stage__bar">
        <CallControls live={live} big />
        <DockButton big danger label={t("voiceRooms.leave")} icon="leave" onClick={() => void leaveVoice()} />
      </div>
    </section>
  );
}

function TileView({
  tile,
  focused,
  you,
  sharing,
  onClick,
}: {
  tile: Tile;
  focused?: boolean;
  you: string;
  sharing: string;
  onClick: () => void;
}) {
  const m = tile.member;
  const track = tile.kind === "screen" ? m.screen : m.camera;
  const name = m.isLocal ? `${m.name} (${you})` : m.name;
  return (
    <button
      type="button"
      className="voice-tile"
      data-focused={focused || undefined}
      data-kind={tile.kind}
      data-speaking={(tile.kind === "person" && m.speaking) || undefined}
      onClick={onClick}
      title={tile.kind === "screen" ? `${m.name} · ${sharing}` : name}
    >
      {track ? (
        <VideoView track={track} mirror={m.isLocal && tile.kind === "person"} contain={tile.kind === "screen"} />
      ) : (
        <span className="voice-tile__face">
          {m.userId ? <PersonAvatar id={m.userId} name={m.name} size="xl" /> : null}
        </span>
      )}
      <span className="voice-tile__name">
        {tile.kind === "person" && !m.micOn && <VoiceIcon name="micOff" size={14} />}
        {tile.kind === "screen" && <span className="voice-live">{sharing}</span>}
        {name}
      </span>
    </button>
  );
}
