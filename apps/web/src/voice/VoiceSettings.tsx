import { Button, Card, CardHeader, cx, Dialog, DialogBody, Popover, Segmented, Select, Switch } from "@agenteschat/ui";
import { type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { PrefRow } from "@/components/NoticePrefs";
import {
  allowDevices,
  canPickOutput,
  changeScreenQuality,
  deviceLists,
  gateReading,
  gateSettings,
  inCall,
  micOptions,
  playTestSound,
  subscribeDevices,
  subscribeReading,
  toggleScreen,
} from "./call";
import { type GateReading, testMicrophone } from "./gate";
import {
  keyName,
  SCREEN_PRESETS,
  type ScreenFps,
  type ScreenPrefs,
  type ScreenPreset,
  type ScreenResolution,
  screenSetup,
  setVoicePrefs,
  subscribePrefs,
  type VoicePrefs,
  voicePrefs,
} from "./prefs";

/*
 * VPS Zen: "Voz e vídeo", Discord's way. The same rows in Configurações › Conta and in the call's own gear: which
 * microphone, speakers and camera, their volumes, how the microphone opens (voice detection with a meter to set its
 * sensitivity by eye, or push to talk), the browser's processing, and the screen's default quality. Beside the
 * call's buttons, quick menus switch the microphone or the speakers without leaving the call, and the screen button
 * opens its quality before sharing (or while sharing, live).
 */

export const useVoicePrefs = () => useSyncExternalStore(subscribePrefs, voicePrefs, voicePrefs);
export const useDevices = () => useSyncExternalStore(subscribeDevices, deviceLists, deviceLists);
const useLiveReading = () => useSyncExternalStore(subscribeReading, gateReading, gateReading);

type DeviceKind = "input" | "output" | "camera";

function useDeviceOptions(kind: DeviceKind) {
  const { t } = useTranslation();
  const lists = useDevices();
  const prefs = useVoicePrefs();
  const list = lists[kind];
  const options = [
    { value: "default", label: t("voiceRooms.settings.systemDefault") },
    ...list.map((d, i) => ({
      value: d.deviceId,
      label: d.label || t("voiceRooms.settings.unnamed", { n: i + 1 }),
    })),
  ];
  // A device unplugged since it was picked: the call is on the system's, and the list says so.
  const chosen = list.some((d) => d.deviceId === prefs[kind]) ? prefs[kind] : "default";
  return { options, chosen, named: lists.named };
}

function DeviceSelect({ kind, label }: { kind: DeviceKind; label: string }) {
  const { options, chosen } = useDeviceOptions(kind);
  return (
    <Select
      size="sm"
      aria-label={label}
      value={chosen}
      options={options}
      onValueChange={(v) => setVoicePrefs({ [kind]: v } as Partial<VoicePrefs>)}
      className="voice-set__select"
    />
  );
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  shown,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  shown: string;
}) {
  return (
    <span className="voice-range">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="voice-range__value">{shown}</span>
    </span>
  );
}

// ── The meter: the microphone's level, the threshold over it, green while it opens ──

const METER_MIN = -80;
const pct = (db: number) => `${Math.max(0, Math.min(100, ((db - METER_MIN) / -METER_MIN) * 100))}%`;

function Meter({ reading, prefs, idle }: { reading: GateReading | null; prefs: VoicePrefs; idle: boolean }) {
  const { t } = useTranslation();
  const manual = !prefs.autoSensitivity;
  const threshold = manual ? prefs.threshold : (reading?.threshold ?? prefs.threshold);
  return (
    <div className="voice-meter" data-idle={idle || undefined} data-open={reading?.open || undefined}>
      <div className="voice-meter__track" aria-hidden="true">
        <span className="voice-meter__fill" style={{ width: pct(reading?.level ?? -100) }} />
        <span className="voice-meter__below" style={{ width: pct(threshold) }} />
        <span className="voice-meter__mark" style={{ left: pct(threshold) }} />
      </div>
      {manual && (
        <input
          type="range"
          className="voice-meter__slider"
          aria-label={t("voiceRooms.settings.sensitivity")}
          min={METER_MIN}
          max={-10}
          step={1}
          value={prefs.threshold}
          onChange={(e) => setVoicePrefs({ threshold: Number(e.target.value) })}
        />
      )}
    </div>
  );
}

/**
 * In a call, the live gate; outside one, "Testar microfone" opens the same gate on the microphone picked (sent
 * nowhere), with "Ouvir a mim mesmo" to hear what the others would.
 */
function MicCheck() {
  const { t } = useTranslation();
  const prefs = useVoicePrefs();
  const live = useLiveReading();
  const calling = inCall();
  const [testing, setTesting] = useState(false);
  const [hear, setHear] = useState(false);
  const [reading, setReading] = useState<GateReading | null>(null);
  const [failed, setFailed] = useState(false);
  const test = useRef<Awaited<ReturnType<typeof testMicrophone>> | null>(null);
  const constraints = JSON.stringify(micOptions(prefs));
  const hearRef = useRef(hear);
  hearRef.current = hear;
  const hearId = useId();

  // Starts (or restarts, on another microphone or processing) the test; stops it on leaving the screen.
  useEffect(() => {
    if (!testing || calling) return;
    let gone = false;
    setFailed(false);
    const p = voicePrefs();
    void testMicrophone(JSON.parse(constraints), gateSettings(p), setReading, { on: hearRef.current, sinkId: p.output })
      .then(async (h) => {
        if (gone) return h.stop();
        test.current = h;
        await allowDevicesQuietly();
      })
      .catch(() => {
        setFailed(true);
        setTesting(false);
      });
    return () => {
      gone = true;
      void test.current?.stop();
      test.current = null;
      setReading(null);
    };
    // `hear` changes play back without a restart (below).
  }, [testing, calling, constraints]);
  useEffect(() => {
    test.current?.gate.update(gateSettings(prefs));
  }, [prefs]);
  useEffect(() => {
    void test.current?.setHear(hear, voicePrefs().output);
  }, [hear]);

  const shown = calling ? live : reading;
  return (
    <div className="voice-check">
      <Meter reading={shown} prefs={prefs} idle={!calling && !testing} />
      <div className="voice-check__acts">
        {calling ? (
          <span className="voice-check__note">
            {prefs.autoSensitivity ? t("voiceRooms.settings.autoNote") : t("voiceRooms.settings.sensitivityHint")}
          </span>
        ) : (
          <>
            <Button size="sm" variant={testing ? "default" : "primary"} onClick={() => setTesting((v) => !v)}>
              {testing ? t("voiceRooms.settings.stopTest") : t("voiceRooms.settings.testMic")}
            </Button>
            {testing && (
              <span className="voice-check__hear">
                <Switch id={hearId} checked={hear} onCheckedChange={setHear} />
                <label htmlFor={hearId}>{t("voiceRooms.settings.hearMe")}</label>
              </span>
            )}
            {failed && <span className="voice-check__note voice-check__note--bad">{t("voiceRooms.errors.mic")}</span>}
          </>
        )}
      </div>
    </div>
  );
}

/** The browser names the devices once the microphone was allowed: a test or a call gives it. */
const allowDevicesQuietly = async () => {
  if (!deviceLists().named) await allowDevices();
};

function PttKey() {
  const { t } = useTranslation();
  const prefs = useVoicePrefs();
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const pick = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") setVoicePrefs({ pttKey: e.code });
      setListening(false);
    };
    window.addEventListener("keydown", pick, true);
    return () => window.removeEventListener("keydown", pick, true);
  }, [listening]);
  const words = {
    space: t("voiceRooms.settings.keySpace"),
    left: t("voiceRooms.settings.keyLeft"),
    right: t("voiceRooms.settings.keyRight"),
  };
  return (
    <button
      type="button"
      className="voice-key"
      data-listening={listening || undefined}
      aria-label={t("voiceRooms.settings.pttChange")}
      onClick={() => setListening((v) => !v)}
    >
      {listening ? t("voiceRooms.settings.pttPress") : <kbd>{keyName(prefs.pttKey, words)}</kbd>}
    </button>
  );
}

export function VoiceSettingsRows({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const prefs = useVoicePrefs();
  const lists = useDevices();
  const output = canPickOutput();
  return (
    <div className={cx("settings-rows voice-set", compact && "voice-set--compact")}>
      {!lists.named && (
        <PrefRow
          id="voice-names"
          icon="lock"
          label={t("voiceRooms.settings.allowNames")}
          hint={t("voiceRooms.settings.allowNamesHint")}
          control={
            <Button size="sm" variant="default" onClick={() => void allowDevices()}>
              {t("voiceRooms.settings.allow")}
            </Button>
          }
        />
      )}
      <PrefRow
        id="voice-input"
        icon="mic"
        label={t("voiceRooms.settings.input")}
        control={<DeviceSelect kind="input" label={t("voiceRooms.settings.input")} />}
      />
      <PrefRow
        id="voice-input-volume"
        icon="mic"
        label={t("voiceRooms.settings.inputVolume")}
        control={
          <Range
            label={t("voiceRooms.settings.inputVolume")}
            value={prefs.inputVolume}
            min={0}
            max={200}
            step={5}
            onChange={(v) => setVoicePrefs({ inputVolume: v })}
            shown={`${prefs.inputVolume}%`}
          />
        }
      />
      <PrefRow
        id="voice-output"
        icon="volume"
        label={t("voiceRooms.settings.output")}
        status={output ? undefined : t("voiceRooms.settings.outputUnsupported")}
        actions={
          <>
            {output && <DeviceSelect kind="output" label={t("voiceRooms.settings.output")} />}
            <Button size="sm" variant="default" onClick={playTestSound}>
              {t("voiceRooms.settings.testSound")}
            </Button>
          </>
        }
      />
      <PrefRow
        id="voice-output-volume"
        icon="volume"
        label={t("voiceRooms.settings.outputVolume")}
        control={
          <Range
            label={t("voiceRooms.settings.outputVolume")}
            value={prefs.outputVolume}
            min={0}
            max={100}
            step={5}
            onChange={(v) => setVoicePrefs({ outputVolume: v })}
            shown={`${prefs.outputVolume}%`}
          />
        }
      />
      <PrefRow
        id="voice-camera"
        icon="video"
        label={t("voiceRooms.settings.camera")}
        control={<DeviceSelect kind="camera" label={t("voiceRooms.settings.camera")} />}
      />
      <PrefRow
        id="voice-detect"
        icon="sound"
        label={t("voiceRooms.settings.detect")}
        control={
          <Segmented
            size="sm"
            label={t("voiceRooms.settings.detect")}
            value={prefs.detect}
            onValueChange={(v) => setVoicePrefs({ detect: v })}
            options={[
              { value: "voice", label: t("voiceRooms.settings.detectVoice") },
              { value: "ptt", label: t("voiceRooms.settings.detectPtt") },
            ]}
          />
        }
      />
      {prefs.detect === "voice" ? (
        <>
          <PrefRow
            id="voice-auto"
            icon="bolt"
            label={t("voiceRooms.settings.autoSensitivity")}
            hint={t("voiceRooms.settings.autoSensitivityHint")}
            control={
              <Switch
                checked={prefs.autoSensitivity}
                onCheckedChange={(v) => setVoicePrefs({ autoSensitivity: v })}
                aria-label={t("voiceRooms.settings.autoSensitivity")}
              />
            }
          />
          <div className="voice-set__wide">
            <span className="voice-set__wide-label">
              {prefs.autoSensitivity ? t("voiceRooms.settings.meterLabel") : t("voiceRooms.settings.sensitivity")}
            </span>
            <MicCheck />
          </div>
        </>
      ) : (
        <>
          <PrefRow
            id="voice-ptt-key"
            icon="keyboard"
            label={t("voiceRooms.settings.pttKey")}
            hint={t("voiceRooms.settings.pttHint")}
            control={<PttKey />}
          />
          <PrefRow
            id="voice-ptt-release"
            icon="clock"
            label={t("voiceRooms.settings.pttRelease")}
            control={
              <Select
                size="sm"
                aria-label={t("voiceRooms.settings.pttRelease")}
                value={String(prefs.pttRelease)}
                onValueChange={(v) => setVoicePrefs({ pttRelease: Number(v) })}
                options={[0, 100, 250, 500, 1000].map((ms) => ({ value: String(ms), label: `${ms} ms` }))}
              />
            }
          />
          <div className="voice-set__wide">
            <span className="voice-set__wide-label">{t("voiceRooms.settings.meterLabel")}</span>
            <MicCheck />
          </div>
        </>
      )}
      <PrefRow
        id="voice-noise"
        icon="filter"
        label={t("voiceRooms.settings.noiseSuppression")}
        hint={t("voiceRooms.settings.noiseSuppressionHint")}
        control={
          <Switch
            checked={prefs.noiseSuppression}
            onCheckedChange={(v) => setVoicePrefs({ noiseSuppression: v })}
            aria-label={t("voiceRooms.settings.noiseSuppression")}
          />
        }
      />
      <PrefRow
        id="voice-echo"
        icon="repeat"
        label={t("voiceRooms.settings.echoCancellation")}
        control={
          <Switch
            checked={prefs.echoCancellation}
            onCheckedChange={(v) => setVoicePrefs({ echoCancellation: v })}
            aria-label={t("voiceRooms.settings.echoCancellation")}
          />
        }
      />
      <PrefRow
        id="voice-agc"
        icon="chart"
        label={t("voiceRooms.settings.autoGainControl")}
        control={
          <Switch
            checked={prefs.autoGainControl}
            onCheckedChange={(v) => setVoicePrefs({ autoGainControl: v })}
            aria-label={t("voiceRooms.settings.autoGainControl")}
          />
        }
      />
      <PrefRow
        id="voice-screen"
        icon="computer"
        label={t("voiceRooms.screen.default")}
        control={
          <Select
            size="sm"
            aria-label={t("voiceRooms.screen.default")}
            value={prefs.screen.preset}
            onValueChange={(v) => setVoicePrefs({ screen: { ...prefs.screen, preset: v as ScreenPreset } })}
            options={PRESETS.map((p) => ({ value: p, label: t(`voiceRooms.screen.${p}`) }))}
          />
        }
      />
    </div>
  );
}

/** Configurações › Conta. */
export function VoiceVideoSettings() {
  const { t } = useTranslation();
  return (
    <Card aria-labelledby="account-voice">
      <CardHeader id="account-voice" title={t("voiceRooms.settings.title")} />
      <VoiceSettingsRows />
    </Card>
  );
}

/** The call's own gear: the same rows, over the call. */
export function VoiceSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("voiceRooms.settings.title")}
      closeLabel={t("voiceRooms.dismiss")}
      width={560}
    >
      <DialogBody>{open && <VoiceSettingsRows compact />}</DialogBody>
    </Dialog>
  );
}

// ── Quick menus beside the call's buttons ──

const chev = (
  <svg viewBox="0 0 20 20" width={12} height={12} aria-hidden="true" className="voice-caret__icon">
    <path d="m6 12 4-4 4 4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
  </svg>
);

function DeviceList({ kind, title }: { kind: DeviceKind; title: string }) {
  const { options, chosen } = useDeviceOptions(kind);
  return (
    <div className="voice-pop__group" role="radiogroup" aria-label={title}>
      <span className="voice-pop__label">{title}</span>
      {options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: a menu row, not a form's radio
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === chosen}
          className="voice-pop__item"
          onClick={() => setVoicePrefs({ [kind]: o.value } as Partial<VoicePrefs>)}
        >
          <span className="voice-pop__dot" aria-hidden="true" />
          <span className="voice-pop__text">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** ⌃ beside the microphone or the headset: which device, and its volume. */
export function DeviceMenu({
  kind,
  onSettings,
  big,
}: {
  kind: "input" | "output";
  onSettings: () => void;
  big?: boolean;
}) {
  const { t } = useTranslation();
  const prefs = useVoicePrefs();
  const [open, setOpen] = useState(false);
  const label = kind === "input" ? t("voiceRooms.settings.inputMenu") : t("voiceRooms.settings.outputMenu");
  useEffect(() => {
    if (open) void allowDevicesQuietly().catch(() => {});
  }, [open]);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={label}
      side="top"
      align="center"
      className="voice-pop"
      trigger={
        <button type="button" className={cx("voice-caret", big && "voice-caret--big")} aria-label={label} title={label}>
          {chev}
        </button>
      }
    >
      {kind === "input" ? (
        <>
          <DeviceList kind="input" title={t("voiceRooms.settings.input")} />
          <div className="voice-pop__group">
            <span className="voice-pop__label">{t("voiceRooms.settings.inputVolume")}</span>
            <Range
              label={t("voiceRooms.settings.inputVolume")}
              value={prefs.inputVolume}
              min={0}
              max={200}
              step={5}
              onChange={(v) => setVoicePrefs({ inputVolume: v })}
              shown={`${prefs.inputVolume}%`}
            />
          </div>
          <div className="voice-pop__group">
            <span className="voice-pop__label">{t("voiceRooms.settings.detect")}</span>
            <Segmented
              size="sm"
              block
              label={t("voiceRooms.settings.detect")}
              value={prefs.detect}
              onValueChange={(v) => setVoicePrefs({ detect: v })}
              options={[
                { value: "voice", label: t("voiceRooms.settings.detectVoice") },
                { value: "ptt", label: t("voiceRooms.settings.detectPtt") },
              ]}
            />
          </div>
        </>
      ) : (
        <>
          {canPickOutput() ? (
            <DeviceList kind="output" title={t("voiceRooms.settings.output")} />
          ) : (
            <p className="voice-pop__note">{t("voiceRooms.settings.outputUnsupported")}</p>
          )}
          <div className="voice-pop__group">
            <span className="voice-pop__label">{t("voiceRooms.settings.outputVolume")}</span>
            <Range
              label={t("voiceRooms.settings.outputVolume")}
              value={prefs.outputVolume}
              min={0}
              max={100}
              step={5}
              onChange={(v) => setVoicePrefs({ outputVolume: v })}
              shown={`${prefs.outputVolume}%`}
            />
          </div>
        </>
      )}
      <button
        type="button"
        className="voice-pop__item voice-pop__item--foot"
        onClick={() => {
          setOpen(false);
          onSettings();
        }}
      >
        {t("voiceRooms.settings.open")}
      </button>
    </Popover>
  );
}

// ── Screen sharing: a quality first, and live while sharing ──

const PRESETS: ScreenPreset[] = ["text", "balanced", "smooth", "weak", "custom"];
const RESOLUTIONS: ScreenResolution[] = ["480", "720", "1080", "1440", "native"];
const FPS: ScreenFps[] = [5, 10, 15, 30, 60];

const mbps = (bps: number) => (bps / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 });

export function ScreenShareMenu({
  sharing,
  disabled,
  trigger,
}: {
  sharing: boolean;
  disabled?: boolean;
  trigger: (props: { label: string; disabled?: boolean }) => ReactNode;
}) {
  const { t } = useTranslation();
  const prefs = useVoicePrefs();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ScreenPrefs>(prefs.screen);
  const audioId = useId();
  useEffect(() => {
    if (open) setDraft(voicePrefs().screen);
  }, [open]);
  const s = screenSetup(draft);
  const label = sharing ? t("voiceRooms.screen.sharingTitle") : t("voiceRooms.screenOn");
  const resLabel = (r: ScreenResolution) => (r === "native" ? t("voiceRooms.screen.native") : `${r}p`);
  const presetLine = (p: Exclude<ScreenPreset, "custom">) =>
    `${SCREEN_PRESETS[p].height}p · ${SCREEN_PRESETS[p].fps} fps · ${t(`voiceRooms.screen.${p}Hint`)}`;
  const changed = JSON.stringify(draft) !== JSON.stringify(prefs.screen);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={label}
      side="top"
      align="center"
      className="voice-pop voice-pop--screen"
      trigger={trigger({ label, disabled })}
    >
      <div className="voice-pop__group" role="radiogroup" aria-label={t("voiceRooms.screen.quality")}>
        <span className="voice-pop__label">{t("voiceRooms.screen.quality")}</span>
        {PRESETS.map((p) => (
          // biome-ignore lint/a11y/useSemanticElements: a menu row, not a form's radio
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={draft.preset === p}
            className="voice-pop__item voice-pop__item--two"
            onClick={() => setDraft((d) => ({ ...d, preset: p }))}
          >
            <span className="voice-pop__dot" aria-hidden="true" />
            <span className="voice-pop__text">
              <span>{t(`voiceRooms.screen.${p}`)}</span>
              <small>{p === "custom" ? t("voiceRooms.screen.customHint") : presetLine(p)}</small>
            </span>
          </button>
        ))}
      </div>
      {draft.preset === "custom" && (
        <div className="voice-pop__group voice-pop__pair">
          <span className="voice-pop__field">
            <span className="voice-pop__label">{t("voiceRooms.screen.resolution")}</span>
            <Select
              size="sm"
              aria-label={t("voiceRooms.screen.resolution")}
              value={draft.resolution}
              onValueChange={(v) => setDraft((d) => ({ ...d, resolution: v }))}
              options={RESOLUTIONS.map((r) => ({ value: r, label: resLabel(r) }))}
            />
          </span>
          <span className="voice-pop__field">
            <span className="voice-pop__label">{t("voiceRooms.screen.fps")}</span>
            <Select
              size="sm"
              aria-label={t("voiceRooms.screen.fps")}
              value={String(draft.fps)}
              onValueChange={(v) => setDraft((d) => ({ ...d, fps: Number(v) as ScreenFps }))}
              options={FPS.map((f) => ({ value: String(f), label: `${f} fps` }))}
            />
          </span>
        </div>
      )}
      {!sharing && (
        <span className="voice-pop__switch">
          <label htmlFor={audioId}>{t("voiceRooms.screen.audio")}</label>
          <Switch id={audioId} checked={draft.audio} onCheckedChange={(v) => setDraft((d) => ({ ...d, audio: v }))} />
        </span>
      )}
      <p className="voice-pop__note">{t("voiceRooms.screen.upload", { mbps: mbps(s.bitrate) })}</p>
      <div className="voice-pop__acts">
        {sharing ? (
          <>
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                setOpen(false);
                void toggleScreen();
              }}
            >
              {t("voiceRooms.screenOff")}
            </Button>
            <Button
              size="sm"
              disabled={!changed}
              onClick={() => {
                setOpen(false);
                void changeScreenQuality(draft);
              }}
            >
              {t("voiceRooms.screen.apply")}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={() => {
              setOpen(false);
              void toggleScreen(draft);
            }}
          >
            {t("voiceRooms.screen.start")}
          </Button>
        )}
      </div>
    </Popover>
  );
}
