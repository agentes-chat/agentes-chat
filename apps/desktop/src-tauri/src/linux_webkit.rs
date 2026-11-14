//! Linux: how WebKitGTK draws the windows.
//!
//! WebKitGTK's DMA-BUF renderer leaves the window blank with NVIDIA's driver, in virtual machines and in many
//! AppImage setups, so `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set. Since WebKitGTK 2.44 that leaves no accelerated
//! path: every frame is drawn on the CPU.
//!
//! On Wayland with NVIDIA's driver the blank window is `Error 71 (Protocol error) dispatching to Wayland display`,
//! and it comes from the driver's explicit sync: with `__NV_DISABLE_EXPLICIT_SYNC=1` for this process the
//! DMA-BUF renderer starts and draws (WebKit bug 280210). So there the driver's explicit sync is turned off and
//! the renderer stays on. An AppImage keeps the CPU path, as before: it carries its own WebKitGTK.
//!
//! The person's own `WEBKIT_DISABLE_DMABUF_RENDERER` always wins; one who set `__NV_DISABLE_EXPLICIT_SYNC`
//! themselves keeps the CPU path, as before.

const DISABLE_DMABUF: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
const DISABLE_EXPLICIT_SYNC: &str = "__NV_DISABLE_EXPLICIT_SYNC";

#[derive(Debug, PartialEq)]
pub enum Drawing {
    /// The person set `WEBKIT_DISABLE_DMABUF_RENDERER`: nothing is changed.
    Theirs,
    /// The GPU, with NVIDIA's explicit sync off.
    GpuWithoutExplicitSync,
    /// The CPU, as before.
    Cpu,
}

/// Call first thing in `main`, before any thread starts (`set_var`): WebKitGTK and the driver read the
/// variables once.
pub fn settle() -> Drawing {
    let nvidia = ["/proc/driver/nvidia/version", "/sys/module/nvidia"].iter().any(|p| std::path::Path::new(p).exists());
    let drawing = decide(|name| std::env::var(name).ok(), nvidia);
    match drawing {
        Drawing::GpuWithoutExplicitSync => std::env::set_var(DISABLE_EXPLICIT_SYNC, "1"),
        Drawing::Cpu => std::env::set_var(DISABLE_DMABUF, "1"),
        Drawing::Theirs => {}
    }
    drawing
}

pub fn decide(env: impl Fn(&str) -> Option<String>, nvidia: bool) -> Drawing {
    if env(DISABLE_DMABUF).is_some() {
        return Drawing::Theirs;
    }
    let their_sync = env(DISABLE_EXPLICIT_SYNC).is_some();
    let appimage = env("APPIMAGE").is_some() || env("APPDIR").is_some();
    let wayland = env("WAYLAND_DISPLAY").is_some_and(|display| !display.is_empty());
    // GDK tries the backends of `GDK_BACKEND` in order; on X11 NVIDIA's failure is another one (WebKit bug 303811).
    let gdk_wayland = env("GDK_BACKEND")
        .map_or(true, |backends| matches!(backends.split(',').next().map(str::trim), Some("wayland" | "*" | "")));
    if nvidia && wayland && gdk_wayland && !appimage && !their_sync {
        Drawing::GpuWithoutExplicitSync
    } else {
        Drawing::Cpu
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decide_with(vars: &[(&str, &str)], nvidia: bool) -> Drawing {
        decide(|name| vars.iter().find(|(n, _)| *n == name).map(|(_, value)| value.to_string()), nvidia)
    }

    #[test]
    fn nvidia_on_wayland_draws_on_the_gpu_without_explicit_sync() {
        assert_eq!(decide_with(&[("WAYLAND_DISPLAY", "wayland-1")], true), Drawing::GpuWithoutExplicitSync);
        assert_eq!(
            decide_with(&[("WAYLAND_DISPLAY", "wayland-1"), ("GDK_BACKEND", "wayland,x11")], true),
            Drawing::GpuWithoutExplicitSync
        );
        assert_eq!(
            decide_with(&[("WAYLAND_DISPLAY", "wayland-1"), ("GDK_BACKEND", "*")], true),
            Drawing::GpuWithoutExplicitSync
        );
    }

    #[test]
    fn everything_else_keeps_the_cpu() {
        // Not NVIDIA's driver (nouveau, Mesa, a virtual machine): as before.
        assert_eq!(decide_with(&[("WAYLAND_DISPLAY", "wayland-1")], false), Drawing::Cpu);
        // X11, or GDK asked for it first.
        assert_eq!(decide_with(&[("DISPLAY", ":0")], true), Drawing::Cpu);
        assert_eq!(decide_with(&[("WAYLAND_DISPLAY", "")], true), Drawing::Cpu);
        assert_eq!(decide_with(&[("WAYLAND_DISPLAY", "wayland-1"), ("GDK_BACKEND", "x11")], true), Drawing::Cpu);
        let x11_first = [("WAYLAND_DISPLAY", "wayland-1"), ("GDK_BACKEND", "x11,wayland")];
        assert_eq!(decide_with(&x11_first, true), Drawing::Cpu);
        // An AppImage carries its own WebKitGTK.
        assert_eq!(decide_with(&[("WAYLAND_DISPLAY", "wayland-1"), ("APPIMAGE", "/a.AppImage")], true), Drawing::Cpu);
        assert_eq!(decide_with(&[("WAYLAND_DISPLAY", "wayland-1"), ("APPDIR", "/tmp/.mount")], true), Drawing::Cpu);
    }

    #[test]
    fn keeps_the_persons_own_setting() {
        assert_eq!(decide_with(&[("WAYLAND_DISPLAY", "wayland-1"), (DISABLE_DMABUF, "1")], true), Drawing::Theirs);
        assert_eq!(decide_with(&[("WAYLAND_DISPLAY", "wayland-1"), (DISABLE_DMABUF, "0")], true), Drawing::Theirs);
        // Their own explicit sync setting is left alone, and the CPU kept, as before.
        assert_eq!(decide_with(&[("WAYLAND_DISPLAY", "wayland-1"), (DISABLE_EXPLICIT_SYNC, "0")], true), Drawing::Cpu);
        assert_eq!(decide_with(&[("WAYLAND_DISPLAY", "wayland-1"), (DISABLE_EXPLICIT_SYNC, "1")], true), Drawing::Cpu);
    }
}
