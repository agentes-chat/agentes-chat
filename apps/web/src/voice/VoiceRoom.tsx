import type { Channel, MemberPresence } from "@agenteschat/client";
import { useChannelMembers } from "@agenteschat/client";
import { Button, cx, Icon, Popover } from "@agenteschat/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PersonAvatar } from "@/components/AgentAvatar";
import { NavToggle } from "@/components/NavDrawer";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import { usePresences } from "@/hooks/usePresence";
import { requestChannelDetails } from "@/lib/channel-details";
import { useToast } from "@/lib/toast";
import { joinVoice } from "./call";
import { useDevices, useVoicePrefs, VoiceSettingsDialog } from "./VoiceSettings";
import { roomsKey, useVoiceCall, useVoiceRooms, VoiceIcon, VoiceStage } from "./VoiceUI";
import { setVoiceOnly, showVoiceView } from "./views";

/*
 * VPS Zen: a channel made for voice only, Discord's voice channel. Its page is the room: the call (or, before
 * joining, who is in it and a big Entrar), and beside it the channel's people in three groups, in the room, online
 * and offline. The chat is one click away ("Chat") and back ("Sala de voz"), so a link or a note still has a place.
 */

const isOnline = (p: MemberPresence | undefined) => p !== undefined && p !== "offline" && p !== "hidden";

export function VoiceChannelRoom({ channel }: { channel: Channel }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const call = useVoiceCall();
  const rooms = useVoiceRooms(org.id);
  const members = useChannelMembers(org.id, channel.id);
  const dir = useDirectory(org.id);
  const presences = usePresences();
  const prefs = useVoicePrefs();
  const devices = useDevices();
  const qc = useQueryClient();
  const toast = useToast();
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState(false);
  const here = call.channelId === channel.id && call.orgId === org.id && call.status !== "idle";
  const inRoom = rooms.byChannel.get(channel.id) ?? [];
  const inRoomIds = new Set(inRoom.map((p) => p.userId));
  const people = (members.data ?? [])
    .filter((m) => m.type === "person" && !inRoomIds.has(m.id))
    .map((m) => ({ id: m.id, name: dir.memberById.get(m.id)?.name ?? "", presence: presences.get(m.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const online = people.filter((p) => isOnline(p.presence));
  const offline = people.filter((p) => !isOnline(p.presence));
  const mic = devices.input.find((d) => d.deviceId === prefs.input)?.label || t("voiceRooms.settings.systemDefault");
  const manages = channel.can?.manage ?? false;

  const toText = async () => {
    setMenu(false);
    try {
      await setVoiceOnly(org.id, channel.id, false);
      await qc.invalidateQueries({ queryKey: roomsKey(org.id) });
    } catch {
      toast.show(t("voiceRooms.room.changeFailed"), "error");
    }
  };

  return (
    <main className="shell__main voice-room">
      <header className="channel__header">
        <NavToggle />
        <div className="ac-actline channel__line">
          <div className="channel__head-text">
            <h1 className="channel__title">
              <span className="voice-room__title-icon">
                <VoiceIcon name="speaker" size={18} />
              </span>
              <span>{channel.name}</span>
            </h1>
            {channel.topic && (
              <span className="channel__topic">
                <span>{channel.topic}</span>
              </span>
            )}
          </div>
          <div className="channel__acts">
            <button
              type="button"
              className="ac-btn ac-btn--ghost ac-btn--icon channel__icon"
              aria-label={t("voiceRooms.room.openChat")}
              title={t("voiceRooms.room.openChat")}
              onClick={() => showVoiceView(channel.id, "chat")}
            >
              <VoiceIcon name="chat" />
            </button>
            <Popover
              open={menu}
              onOpenChange={setMenu}
              label={t("shell.sidebarMenu.channelSettings")}
              side="bottom"
              align="end"
              className="voice-pop"
              trigger={
                <button
                  type="button"
                  className="ac-btn ac-btn--ghost ac-btn--icon channel__icon"
                  aria-label={t("shell.sidebarMenu.channelSettings")}
                  title={t("shell.sidebarMenu.channelSettings")}
                >
                  <Icon name="cog" />
                </button>
              }
            >
              <button
                type="button"
                className="voice-pop__item"
                onClick={() => {
                  setMenu(false);
                  showVoiceView(channel.id, "chat");
                  requestChannelDetails(channel.id);
                }}
              >
                {t("shell.sidebarMenu.channelSettings")}
              </button>
              <button
                type="button"
                className="voice-pop__item"
                onClick={() => {
                  setMenu(false);
                  setSettings(true);
                }}
              >
                {t("voiceRooms.settings.title")}
              </button>
              {manages && (
                <button type="button" className="voice-pop__item" onClick={() => void toText()}>
                  {t("voiceRooms.room.makeText")}
                </button>
              )}
            </Popover>
          </div>
        </div>
      </header>
      <div className="voice-room__body">
        <section className="voice-room__main">
          {here ? (
            <VoiceStage orgId={org.id} channelId={channel.id} channelName={channel.name} room />
          ) : (
            <div className="voice-lobby">
              <span className="voice-lobby__emblem" aria-hidden="true">
                <VoiceIcon name="speaker" size={34} />
              </span>
              <h2 className="voice-lobby__name">{channel.name}</h2>
              {inRoom.length > 0 ? (
                <div className="voice-lobby__faces">
                  {inRoom.slice(0, 8).map((p) => (
                    <span key={p.userId} className="voice-lobby__face" data-speaking={p.speaking || undefined}>
                      <PersonAvatar id={p.userId} name={p.name} size="lg" />
                    </span>
                  ))}
                  <span className="voice-lobby__line">
                    {inRoom.some((p) => p.screen)
                      ? t("voiceRooms.sharingNow", { name: inRoom.find((p) => p.screen)?.name })
                      : t("voiceRooms.inVoice", { count: inRoom.length })}
                  </span>
                </div>
              ) : (
                <p className="voice-lobby__line">{t("voiceRooms.room.empty")}</p>
              )}
              <Button
                size="lg"
                disabled={!rooms.enabled || call.status === "connecting"}
                onClick={() => void joinVoice(org.id, channel.id, channel.name)}
              >
                {call.status === "connecting" && call.channelId === channel.id
                  ? t("voiceRooms.connecting")
                  : t("voiceRooms.room.join")}
              </Button>
              <button type="button" className="voice-lobby__device" onClick={() => setSettings(true)}>
                <VoiceIcon name="mic" size={14} />
                <span>{mic}</span>
                <span className="voice-lobby__device-sep">·</span>
                <span>
                  {prefs.detect === "ptt" ? t("voiceRooms.settings.detectPtt") : t("voiceRooms.settings.detectVoice")}
                </span>
              </button>
              {!rooms.enabled && <p className="voice-lobby__note">{t("voiceRooms.errors.off")}</p>}
            </div>
          )}
        </section>
        <aside className="voice-room__people" aria-label={t("voiceRooms.room.people")}>
          <PeopleGroup title={t("voiceRooms.room.inRoom")} count={inRoom.length}>
            {inRoom.map((p) => (
              <li key={p.userId} className="voice-person" data-speaking={p.speaking || undefined}>
                <span className="voice-person__face">
                  <PersonAvatar id={p.userId} name={p.name} size="sm" />
                </span>
                <span className="voice-person__name">{p.name}</span>
                <span className="voice-person__marks">
                  {p.screen && <span className="voice-live">{t("voiceRooms.live")}</span>}
                  {p.camera && <VoiceIcon name="camera" size={14} />}
                  {p.muted && <VoiceIcon name="micOff" size={14} />}
                </span>
              </li>
            ))}
          </PeopleGroup>
          <PeopleGroup title={t("presence.online")} count={online.length}>
            {online.map((p) => (
              <li key={p.id} className="voice-person">
                <span className="voice-person__face">
                  <PersonAvatar id={p.id} name={p.name} size="sm" presence />
                </span>
                <span className="voice-person__name">{p.name}</span>
              </li>
            ))}
          </PeopleGroup>
          <PeopleGroup title={t("presence.offline")} count={offline.length} quiet>
            {offline.map((p) => (
              <li key={p.id} className="voice-person">
                <span className="voice-person__face">
                  <PersonAvatar id={p.id} name={p.name} size="sm" presence />
                </span>
                <span className="voice-person__name">{p.name}</span>
              </li>
            ))}
          </PeopleGroup>
        </aside>
      </div>
      <VoiceSettingsDialog open={settings} onClose={() => setSettings(false)} />
    </main>
  );
}

function PeopleGroup({
  title,
  count,
  quiet,
  children,
}: {
  title: string;
  count: number;
  quiet?: boolean;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className={cx("voice-group", quiet && "voice-group--quiet")}>
      <h3 className="voice-group__title">
        {title} <span className="voice-group__count">{count}</span>
      </h3>
      <ul className="voice-group__list">{children}</ul>
    </section>
  );
}
