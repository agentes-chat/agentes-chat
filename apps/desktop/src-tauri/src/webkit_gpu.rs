//! Linux: whether WebKitGTK draws the windows with the GPU.
//!
//! `WEBKIT_DISABLE_DMABUF_RENDERER=1` keeps the window from staying blank with NVIDIA's driver, in virtual
//! machines and in many AppImage setups. Since WebKitGTK 2.44 it has no older accelerated path to fall back to:
//! with the variable set it draws every frame on the CPU, and the whole app lags, more the larger the window.
//! So the variable is set unless this computer is one where the GPU path is known to draw: the app came as a
//! package (no AppImage), NVIDIA's driver isn't loaded, every graphics card is driven by `amdgpu`, `i915` or
//! `xe`, and one of them has a render node this person may open. Anything else, or anything that can't be
//! read, keeps the CPU path, as before. The person's own value always wins.

use std::ffi::{CString, OsString};
use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

const VARIABLE: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// The kernel drivers whose GPUs WebKitGTK draws on without trouble (Mesa's AMD and Intel).
const KNOWN_DRIVERS: [&str; 3] = ["amdgpu", "i915", "xe"];

#[derive(Debug, PartialEq)]
pub enum Drawing {
    /// The person set the variable: nothing is changed.
    Theirs,
    /// WebKitGTK's own default, the GPU.
    Gpu,
    /// The variable is set: the CPU draws. With the reason, for the log.
    Cpu(&'static str),
}

/// Call first thing in `main`, before any thread starts: WebKitGTK reads the variable once.
pub fn settle() -> Drawing {
    let drawing = decide(|name| std::env::var_os(name), Path::new("/sys"), Path::new("/dev"));
    if let Drawing::Cpu(_) = drawing {
        std::env::set_var(VARIABLE, "1");
    }
    drawing
}

pub fn decide(env: impl Fn(&str) -> Option<OsString>, sys: &Path, dev: &Path) -> Drawing {
    if env(VARIABLE).is_some() {
        return Drawing::Theirs;
    }
    // An AppImage carries its own WebKitGTK and runs it against this computer's drivers.
    if env("APPIMAGE").is_some() || env("APPDIR").is_some() {
        return Drawing::Cpu("AppImage");
    }
    // NVIDIA's driver shows no card at all when its mode setting is off, so the module is asked too.
    if ["nvidia", "nvidia_drm", "nvidia_modeset"].iter().any(|module| sys.join("module").join(module).exists()) {
        return Drawing::Cpu("NVIDIA's driver");
    }
    let Ok(cards) = fs::read_dir(sys.join("class/drm")) else {
        return Drawing::Cpu("no graphics card found");
    };
    let mut opens = false;
    let mut found = false;
    for card in cards.flatten() {
        // `card0`, never its outputs (`card0-DP-1`) nor `renderD128`.
        let name = card.file_name();
        let Some(number) = name.to_str().and_then(|name| name.strip_prefix("card")) else { continue };
        if number.is_empty() || !number.bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        found = true;
        let device = card.path().join("device");
        let driver = fs::read_link(device.join("driver")).ok();
        let driver = driver.as_deref().and_then(Path::file_name).and_then(|name| name.to_str());
        // A virtual machine's card (virtio_gpu, vmwgfx, qxl…), nouveau, an ARM board's: not known to draw.
        if !driver.is_some_and(|driver| KNOWN_DRIVERS.contains(&driver)) {
            return Drawing::Cpu("a graphics card that isn't AMD's or Intel's");
        }
        opens = opens || render_node_opens(&device, dev);
    }
    if !found {
        return Drawing::Cpu("no graphics card found");
    }
    if !opens {
        return Drawing::Cpu("no render node to open");
    }
    Drawing::Gpu
}

/// Whether this person may open the card's render node (`/dev/dri/renderD128`), as WebKitGTK will: a container
/// often lacks it.
fn render_node_opens(device: &Path, dev: &Path) -> bool {
    let Ok(nodes) = fs::read_dir(device.join("drm")) else { return false };
    nodes.flatten().any(|node| {
        let name = node.file_name();
        name.to_str().is_some_and(|name| name.starts_with("renderD")) && may_open(&dev.join("dri").join(&name))
    })
}

/// Asked, not opened: opening a laptop's second card wakes it.
fn may_open(path: &Path) -> bool {
    let Ok(path) = CString::new(path.as_os_str().as_bytes()) else { return false };
    unsafe { libc::access(path.as_ptr(), libc::R_OK | libc::W_OK) == 0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use std::path::PathBuf;

    /// A computer's `/sys` and `/dev`, made in a folder of its own.
    struct Computer {
        root: PathBuf,
        env: Vec<(&'static str, &'static str)>,
    }

    impl Computer {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!("agentes-gpu-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(root.join("sys/class/drm")).unwrap();
            fs::create_dir_all(root.join("dev/dri")).unwrap();
            Computer { root, env: Vec::new() }
        }
        /// A card driven by `driver` ("" = none bound), with a render node when `render` names one.
        fn card(self, number: u8, driver: &str, render: Option<&str>) -> Self {
            let card = self.root.join(format!("sys/class/drm/card{number}"));
            fs::create_dir_all(card.join("device/drm")).unwrap();
            // Its outputs sit beside it, as on a real computer.
            fs::create_dir_all(self.root.join(format!("sys/class/drm/card{number}-DP-1"))).unwrap();
            if !driver.is_empty() {
                let target = self.root.join("sys/bus/drivers").join(driver);
                fs::create_dir_all(&target).unwrap();
                symlink(&target, card.join("device/driver")).unwrap();
            }
            if let Some(node) = render {
                fs::create_dir_all(card.join("device/drm").join(node)).unwrap();
                fs::create_dir_all(self.root.join("sys/class/drm").join(node)).unwrap();
                fs::write(self.root.join("dev/dri").join(node), b"").unwrap();
            }
            self
        }
        fn module(self, name: &str) -> Self {
            fs::create_dir_all(self.root.join("sys/module").join(name)).unwrap();
            self
        }
        fn env(mut self, name: &'static str, value: &'static str) -> Self {
            self.env.push((name, value));
            self
        }
        fn without_dev(self) -> Self {
            fs::remove_dir_all(self.root.join("dev/dri")).unwrap();
            self
        }
        fn drawing(&self) -> Drawing {
            let env = |name: &str| self.env.iter().find(|(n, _)| *n == name).map(|(_, value)| OsString::from(value));
            decide(env, &self.root.join("sys"), &self.root.join("dev"))
        }
    }

    impl Drop for Computer {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn cpu(drawing: Drawing) -> bool {
        matches!(drawing, Drawing::Cpu(_))
    }

    #[test]
    fn amd_and_intel_draw_with_the_gpu() {
        assert_eq!(Computer::new("amd").card(1, "amdgpu", Some("renderD128")).drawing(), Drawing::Gpu);
        assert_eq!(Computer::new("intel").card(0, "i915", Some("renderD128")).drawing(), Drawing::Gpu);
        assert_eq!(Computer::new("xe").card(0, "xe", Some("renderD128")).drawing(), Drawing::Gpu);
        // A laptop with both.
        let both = Computer::new("both").card(0, "i915", Some("renderD128")).card(1, "amdgpu", Some("renderD129"));
        assert_eq!(both.drawing(), Drawing::Gpu);
    }

    #[test]
    fn the_persons_own_value_wins() {
        let amd = Computer::new("theirs-off").card(0, "amdgpu", Some("renderD128")).env(VARIABLE, "1");
        assert_eq!(amd.drawing(), Drawing::Theirs);
        // Asked for the GPU where the app wouldn't choose it.
        let nvidia = Computer::new("theirs-on").card(0, "nvidia", Some("renderD128")).module("nvidia");
        assert_eq!(nvidia.env(VARIABLE, "0").drawing(), Drawing::Theirs);
    }

    #[test]
    fn an_appimage_keeps_the_cpu() {
        let image = Computer::new("appimage").card(0, "amdgpu", Some("renderD128"));
        assert!(cpu(image.env("APPIMAGE", "/home/ana/agentes.AppImage").drawing()));
        let dir = Computer::new("appdir").card(0, "amdgpu", Some("renderD128"));
        assert!(cpu(dir.env("APPDIR", "/tmp/.mount_agentes").drawing()));
    }

    #[test]
    fn nvidia_keeps_the_cpu() {
        // The driver with its card.
        assert!(cpu(Computer::new("nv").card(0, "nvidia", Some("renderD128")).module("nvidia").drawing()));
        // A laptop with Intel and NVIDIA.
        let laptop = Computer::new("nv-laptop").card(0, "i915", Some("renderD128"));
        let laptop = laptop.card(1, "nvidia", Some("renderD129"));
        assert!(cpu(laptop.module("nvidia").module("nvidia_drm").drawing()));
        // The driver loaded with mode setting off: only Intel's card shows.
        assert!(cpu(Computer::new("nv-hidden").card(0, "i915", Some("renderD128")).module("nvidia").drawing()));
        // nouveau.
        assert!(cpu(Computer::new("nouveau").card(0, "nouveau", Some("renderD128")).drawing()));
    }

    #[test]
    fn a_virtual_machine_or_an_unknown_card_keeps_the_cpu() {
        for driver in ["virtio_gpu", "vmwgfx", "qxl", "bochs-drm", "vboxvideo", "hyperv_drm", "simple-framebuffer"] {
            assert!(cpu(Computer::new(driver).card(0, driver, Some("renderD128")).drawing()), "{driver}");
        }
        // ARM boards and Macs.
        for driver in ["panfrost", "v3d", "msm_dpu", "asahi"] {
            assert!(cpu(Computer::new(driver).card(0, driver, Some("renderD128")).drawing()), "{driver}");
        }
        // A passed-through AMD card beside the machine's own virtual one.
        let passed = Computer::new("passed").card(0, "virtio_gpu", None).card(1, "amdgpu", Some("renderD128"));
        assert!(cpu(passed.drawing()));
        // A card nothing drives.
        assert!(cpu(Computer::new("undriven").card(0, "", None).drawing()));
    }

    #[test]
    fn nothing_to_read_keeps_the_cpu() {
        // No card at all (WSL, a container).
        assert!(cpu(Computer::new("none").drawing()));
        // The card shows but its render node isn't in this container's /dev.
        assert!(cpu(Computer::new("no-dev").card(0, "amdgpu", Some("renderD128")).without_dev().drawing()));
        // A card with no render node.
        assert!(cpu(Computer::new("no-node").card(0, "amdgpu", None).drawing()));
        // No /sys.
        assert!(cpu(decide(|_| None, Path::new("/nonexistent/sys"), Path::new("/nonexistent/dev"))));
    }
}
