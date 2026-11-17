# 0195. Phone app lock: biometrics or the screen lock, per device

- Status: Accepted
- Date: 2026-11-17
- Amends: 0035 (the phone app)
- Code: `apps/mobile/src/features/lock/logic.ts` (`LOCK_GRACE_MS`, `LOCK_AFTER_CHOICES`, `lockAfterOf`, `availabilityOf`, `locksOnReturn`), `store.ts`
  (`useAppLock`, `watchAppLock`, `unlock`, `turnAppLock`, `setLockAfter`, `whenUnlocked`, `forgetAppLock`, `useLockAvailability`),
  `LockScreen.tsx`, `AppLockRow.tsx` (Você › Preferências); the root `apps/mobile/app/_layout.tsx`; what waits:
  `src/providers/push.tsx` (a tapped push), `app/+native-intent.tsx` (a link), `src/features/share/ShareInbox.tsx`
  (a share); toasts held in `src/ui/Toast.tsx`, a phone's control closed in `src/features/devices/PhoneLive.tsx`;
  `STORED.appLock` (`readValueSyncOrUnknown`) in `src/lib/storage.ts`; sign-out of the last account in
  `src/features/account/index.ts`; `expo-local-authentication` in `app.config.ts`; tests
  `apps/mobile/test/features/app-lock.test.ts`, `app-lock-store.test.ts`

## Context

A phone stays signed in for good (ADR 0035), and what it opens to is people's and agents' conversations. Someone who
picks up an unlocked phone, or one whose owner hands it over, reads them all. Banking and chat apps answer this with an
app lock behind the phone's own biometrics. The server can't help: the risk is the device in someone else's hand,
and the proof has to come from the device.

## Decision

1. **A setting of the phone, off by default.** Você › Preferências has "Bloquear com biometria" ("Lock with
   biometrics"). It is kept on the phone (`STORED.appLock` in SecureStore), not on the account: another phone of the
   same person is not locked, and signing out of one account or switching accounts or servers leaves it as it is.
   Signing out of the last account clears the phone's remembered values (ADR 0154), and the lock with them. A value
   that can't be read (the keystore failed) counts as on: the phone's own proof opens it, and the next step (3) means
   nobody is kept out.
2. **Offered where the phone can prove its owner.** `getEnrolledLevelAsync` says whether biometrics are enrolled
   (weak or strong), only a screen lock (PIN, pattern, passcode) is set, or nothing. With nothing the switch is off
   and disabled, with one line saying what to set up; it is read again whenever the app comes back to the front.
   Turning it on asks for one successful proof first; turning it off doesn't, since the app is already open.
3. **The proof is the system's.** `authenticateAsync` with the device credential allowed: a fingerprint that no
   longer reads, or a face the phone can't see, gives way to the phone's PIN, pattern or passcode, so a person is
   never kept out of their own app. A phone whose screen lock was removed while the lock was on can prove nothing
   any more: Desbloquear turns the lock off and opens, rather than locking the person out for good.
4. **When it asks.** On a cold start, and on coming back from the background after the time the person picked under
   the switch, "Bloquear ao sair": at once, after 1, 5 or 30 minutes, or after an hour (`LOCK_AFTER_CHOICES`, kept
   per device in `STORED.appLockAfter`, one minute, `LOCK_GRACE_MS`, unless changed). Asking on every return is
   tiring for someone who switches apps all day, and an hour is too long for someone who leaves the phone on a desk:
   the person knows which they are. A clock that went backwards while away locks too. The
   system's own prompt takes the app out of the front (Face ID, Android's PIN screen): that time is not counted as
   leaving.
5. **Nothing shows behind it.** The lock screen is the app's mark and Desbloquear on the app's background, drawn in
   TrueSheet's overlay: a native layer the library keeps above every sheet it presents (every sheet of the app is a
   TrueSheet, route sheets and the screens' own), mounted only while the lock shows, so it lands on top of whatever is
   presented at that moment, a screen presented whole and the launch splash included. The navigator stays mounted
   under it; the app, its covers and the splash are hidden from screen readers meanwhile, and no toast shows over it.
   Out of sight (the app switcher, the background) the same screen covers the app without asking anything, so the
   system's picture of the app shows no conversation; back within the grace it goes away by itself. A phone's screen
   in control (`PhoneLive`) is a window of the system's own, above that layer on Android: locking closes it.
   As the lock engages (not as it only covers), every open sheet closes (`TrueSheet.dismissAll`, which each sheet
   hears as a swipe down: a route sheet goes back to its base route), so no screen reader reaches one under the lock.
6. **What the app would open waits.** While locked, and also while out of sight with the lock on (a notification's
   answer reaches the app before it is in front again, so it can't wait for the lock to engage), what a tapped
   notification opens (its screen, or its action button's work: let someone join, allow once, stop), a link the
   system opens the app with (`+native-intent`, the in-app browser included) and a share from another app
   (`ShareInbox`) wait in `whenUnlocked`, and run once the lock is open and the app in front. Back within the grace
   that is at once, as for the rest of the app. Only the latest of them runs: opening the lock goes to one place.

## Consequences

- No server change and no new storage: one more remembered value of the phone.
- iOS shows `NSFaceIDUsageDescription` (each ready language's in `assets/locales`); Android gets
  `USE_BIOMETRIC` from the module's plugin. Both need a new native build.
- On Android a permission prompt, the camera or a file picker takes the app out of the front: the cover shows for a
  moment, and a minute or more there asks for the proof on coming back.
- Known limitation: the grace is measured with the wall clock (`Date.now()`). Someone who can already unlock the
  phone itself could set its clock to within the picked time after the app left, after a long absence, and come back
  without the app asking. A monotonic clock would need a native module of its own.
- Open: Android takes the recents picture as the app pauses, and React may not have drawn the cover by then; the
  sure way is `FLAG_SECURE`, which also blocks screenshots, so it is left out. The lock screen asks only when
  Desbloquear is pressed; asking on its own as it appears is a possible refinement. A link the app opened with while
  locked on a cold start is held and released once the lock opens, which may be before the session and the
  workspace have loaded: not yet tried on a device.
